#!/usr/bin/env node
/**
 * semrush-batch.mjs —— similarweb-batch.mjs 的 Semrush 版，同样是「登录做一次，
 * 之后只换路由」。存在的理由是**配额**：两张卡片的每日配额是分开的，
 * 一张打满了另一张往往还满着，批量筛选不该因为其中一张见底就整个停下。
 *
 * **口径不同，别混着比。** 这里给的是 `organicTraffic`（自然搜索流量估算），
 * Similarweb 给的是总访问量（含直接、社交、买量）。同一个站两个数字差几倍是正常的。
 * 所以写回目标表时 `traffic.source` 必须标明是哪一个——两个数字并列进同一列，
 * 比没有数字更糟。
 *
 * **`organicTraffic` 永远是一个国家库的估算，不传 `--db` 也不会给全球合计**——
 * 本脚本和 semrush-overview.mjs 一样没有全球选项，落到哪个国家取决于 Semrush 自己的
 * 默认值。批量跑一批域名时如果目标市场不是同一个国家，务必显式传 `--db`，
 * 否则同一份 jsonl 里的数字实际上不可比。
 *
 * 拿它当**下限测试**是成立的：问的是「这个站有没有可测量的真人流量」，
 * 自然流量为零或查不到，就是没过门槛。**但下限测试也要固定 `--db`**——同一个站换个
 * 国家库，「零」和「几千」都可能出现，下限判定跟着口径一起变了。
 *
 * 三条铁律同 similarweb-batch：同步前台跑、逐条追加写盘、按已有输出续跑
 * （**error 不算跑过**）。外加连续失败熔断——会话挂掉后每个域名都要付满超时。
 *
 * 用法：node scripts/semrush-batch.mjs --domains-file d.txt --out out.jsonl --db us [--node 3]
 *   # --db 建议总是显式传；省略会打印警告并落到 Semrush 自己的默认库，不是全球
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { defaultSession, parseFlags, showHelpIfRequested, required, validateSession } from './opencli-core.mjs';
import { captureStable, expiryWarning, gotoInTool, launchTool, redactSecrets } from './lib-tools-share.mjs';

const flags = parseFlags(process.argv.slice(2));
showHelpIfRequested(flags, import.meta.url);
const outPath = required(flags, 'out');
const session = flags.session ? validateSession(flags.session) : defaultSession('sem-batch');
const appOrigin = (process.env.TOOLS_SHARE_APP_ORIGIN_SEMRUSH || 'https://sem.3ue.co').replace(/\/+$/, '');
const dbGiven = flags.db !== undefined && String(flags.db).trim() !== '';
const db = String(flags.db || '').trim().toLowerCase();
if (!dbGiven) {
  console.error(`⚠ --db not given. organicTraffic will be whatever country Semrush defaults to for every domain in this run — not a global total. Pass --db explicitly, especially when comparing rows.`);
}
// 超时与 settle 在 2026-08-24 调大过一次，**不要为了快再调回去**：
// 旧默认（settle 5s / 轮询间隔 2s / 超时 40s）下，占位值能安安稳稳撑过两次读，
// 「连读两次一致」这条判据整个失效——实测 4 个域名，1 个 AS 读成 0，3 个被判 below-floor，
// 而它们的真值是 22 / 29 / 38 / 22。慢十几秒换一个不会骗人的数，这笔账是划算的。
const perDomainTimeout = Math.max(10_000, Number(flags['domain-timeout'] || 75) * 1000);
const settle = Number(flags.settle || 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeDomain(v) {
  const c = v.includes('://') ? new URL(v).hostname : v.split('/')[0];
  const n = c.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,63}$/.test(n) ? n : null;
}
function parseCompact(v) {
  const m = String(v || '').replace(/,/g, '').trim().match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  return Math.round(Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1));
}
function pick(lines, label, pattern) {
  const i = lines.findIndex((l) => l === label);
  if (i < 0) return null;
  return lines.slice(i + 1, i + 6).find((l) => pattern.test(l)) || null;
}

/**
 * 一次读出这一屏要用到的全部数值。**解析和「是否稳定」的指纹共用同一个函数**，
 * 否则指纹盯着 A、写出去的是 B，稳定性检查等于没做。
 * authorityScore 不能写 `Number(x) || null`：AS=0 是真实值（新站常见），与「没数据」相反。
 */
function readMetrics(bodyText) {
  const lines = String(bodyText || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const as = pick(lines, 'Authority Score', /^\d+$/);
  return {
    organicTraffic: parseCompact(pick(lines, '自然流量', /^[\d.,]+\s*[KMB]?$/i)),
    authorityScore: as === null ? null : Number(as),
  };
}

const wanted = [];
for (const line of readFileSync(required(flags, 'domains-file'), 'utf8').split('\n')) {
  const d = normalizeDomain(line.trim());
  if (d && !wanted.includes(d)) wanted.push(d);
}
const done = new Set();
if (existsSync(outPath)) {
  for (const line of readFileSync(outPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.verdict !== 'error') done.add(r.domain); } catch { /* 半行 */ }
  }
}
const todo = wanted.filter((d) => !done.has(d));
console.error(`[sem] ${wanted.length} requested, ${done.size} already done, ${todo.length} to go`);
if (!todo.length) process.exit(0);

const launched = await launchTool({
  session, tool: 'semrush', node: flags.node,
  window: flags.window === 'foreground' ? 'foreground' : 'background',
  wait: Number(flags.wait || 7), timeout: Number(flags.launchTimeout || 60),
});
try {
const evaluate = launched.evalPage;
if (expiryWarning(launched.state)) console.error(`[sem] ${expiryWarning(launched.state)}`);

let n = 0, consecutiveErrors = 0;
for (const domain of todo) {
  n += 1;
  const startedAt = Date.now();
  let row;
  try {
    await gotoInTool(evaluate, `${appOrigin}/analytics/overview/?q=${encodeURIComponent(domain)}&searchType=domain${db ? `&db=${encodeURIComponent(db)}` : ''}`, settle);
    // 就绪判据认「Authority Score」而不是标题；**但认到标签也还不算数**——
    // 标签挂上来时数值区还停在占位上，晚几秒才水合出真值。
    // **而且「连读两次一致」也不够**（2026-08-24 实测打脸）：占位值本身是稳定的，
    // 两次快读之间它根本没变。所以这里再加两条，都是从实测的错法反推出来的：
    //
    //   1. **一个字段都没解析出来 = 还没渲染，永远不收。** 旧代码把它当 below-floor，
    //      于是 na.whatismymmr.com（AS 29）、saveeditonline.com（AS 38）、
    //      vgcmulticalc.com（AS 22）三个站被判成「没流量」。超时了就记 error，
    //      让续跑重测——**渲染慢和没有数据在超时那一刻不可区分，而结论相反**。
    //   2. **自然流量 > 0 却 AS = 0 是矛盾的**，说明 AS 还停在占位（AS 比流量晚水合）。
    //      这种指纹要连读六次才认（约 18 秒）——真的是 0 就该一直是 0；
    //      是占位就会在这段时间里翻成真值。
    const suspicious = (print) => {
      const m = JSON.parse(print);
      return m.organicTraffic !== null && m.organicTraffic > 0 && m.authorityScore === 0;
    };
    const settled = await captureStable({
      read: () => evaluate(`(() => ({
        url: location.href,
        ready: /Authority Score|权威分数/.test(document.body?.innerText || ''),
        bodyText: (document.body?.innerText || '').slice(0, 20000)
      }))()`),
      fingerprint: (s) => {
        if (!s?.ready || !String(s.url || '').includes(encodeURIComponent(domain))) return null;
        const m = readMetrics(s.bodyText);
        if (m.organicTraffic === null && m.authorityScore === null) return null;   // 一个都没解析出来
        return JSON.stringify(m);
      },
      needed: (print) => (suspicious(print) ? 6 : 2),
      timeoutMs: perDomainTimeout - (Date.now() - startedAt),
      intervalMs: Number(flags['stable-interval'] || 3) * 1000,
    });
    if (!settled.stable) {
      // **超时记 error，绝不记 below-floor。** 两种成因分开写，因为后续动作不同：
      // 「什么都没解析出来」多半是慢/节点，重跑即可；「AS 一直是 0」要么这个站真是 0，
      // 要么这个节点水合特别慢——两次都这样就该换 --node 或调大 --domain-timeout。
      row = {
        domain,
        db: db || null,
        verdict: 'error',
        organicTraffic: null,
        error: settled.fingerprint
          ? `unstable: ${settled.fingerprint} held for ${settled.reads} reads but looks like a placeholder (traffic > 0 with AS 0)`
          : 'timeout: overview rendered no parseable metric',
        checkedAt: new Date().toISOString(),
      };
    } else {
      const m = readMetrics(settled.capture.bodyText);
      const v = m.organicTraffic;
      row = {
        domain,
        db: db || null,
        // 到这里至少有一个字段解析出来了。流量没解析出来而 AS 有值，才是真的「没有自然流量」。
        verdict: v === null ? 'below-floor' : v >= 100 ? 'pass' : 'fail',
        organicTraffic: v,
        authorityScore: m.authorityScore,
        checkedAt: new Date().toISOString(),
      };
    }
  } catch (error) {
    row = { domain, db: db || null, verdict: 'error', organicTraffic: null, error: redactSecrets(error.message || error), checkedAt: new Date().toISOString() };
  }
  appendFileSync(outPath, `${JSON.stringify(row)}\n`, 'utf8');
  if (row.verdict === 'error') {
    consecutiveErrors += 1;
    if (consecutiveErrors >= 5) {
      console.error(`[sem] ABORT: ${consecutiveErrors} consecutive errors — session dead or quota exhausted, not the domains. Check the panel's 今日配额 before rerunning.`);
      process.exit(3);
    }
  } else consecutiveErrors = 0;
  console.error(`[sem] ${n}/${todo.length} ${domain} → ${row.verdict}${row.organicTraffic != null ? ` (${row.organicTraffic})` : ''} ${Math.round((Date.now() - startedAt) / 1000)}s`);
}
console.error('[sem] done');
} finally {
  await launched.releaseBrowserLocks?.();
}
