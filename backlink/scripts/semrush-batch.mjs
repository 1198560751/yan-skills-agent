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
 * 拿它当**下限测试**是成立的：问的是「这个站有没有可测量的真人流量」，
 * 自然流量为零或查不到，就是没过门槛。
 *
 * 三条铁律同 similarweb-batch：同步前台跑、逐条追加写盘、按已有输出续跑
 * （**error 不算跑过**）。外加连续失败熔断——会话挂掉后每个域名都要付满超时。
 *
 * 用法：node scripts/semrush-batch.mjs --domains-file d.txt --out out.jsonl [--db us] [--node 3]
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { defaultSession, parseFlags, required, validateSession } from './opencli-core.mjs';
import { expiryWarning, gotoInTool, launchTool } from './lib-tools-share.mjs';

const flags = parseFlags(process.argv.slice(2));
const outPath = required(flags, 'out');
const session = flags.session ? validateSession(flags.session) : defaultSession('sem-batch');
const appOrigin = (process.env.TOOLS_SHARE_APP_ORIGIN_SEMRUSH || 'https://sem.3ue.co').replace(/\/+$/, '');
const db = String(flags.db || '').trim().toLowerCase();
const perDomainTimeout = Math.max(10_000, Number(flags['domain-timeout'] || 40) * 1000);
const settle = Number(flags.settle || 5);
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
const evaluate = launched.evalPage;
if (expiryWarning(launched.state)) console.error(`[sem] ${expiryWarning(launched.state)}`);

let n = 0, consecutiveErrors = 0;
for (const domain of todo) {
  n += 1;
  const startedAt = Date.now();
  let row;
  try {
    await gotoInTool(evaluate, `${appOrigin}/analytics/overview/?q=${encodeURIComponent(domain)}&searchType=domain${db ? `&db=${encodeURIComponent(db)}` : ''}`, settle);
    let cap = null;
    while (Date.now() - startedAt < perDomainTimeout) {
      const s = await evaluate(`(() => ({
        url: location.href,
        ready: /Authority Score|权威分数/.test(document.body?.innerText || ''),
        bodyText: (document.body?.innerText || '').slice(0, 20000)
      }))()`);
      if (String(s.url || '').includes(encodeURIComponent(domain)) && s.ready) { cap = s; break; }
      await sleep(2000);
    }
    if (!cap) {
      // **超时记 error，绝不记 below-floor。** 概览页首屏本来就慢，实测一个
      // 自然流量 2.4K 的站在 41 秒超时下被误判成「没流量」。渲染慢和没有数据
      // 在超时那一刻不可区分，而结论相反——所以这里只能说「没测成」。
      row = { domain, verdict: 'error', organicTraffic: null, error: 'timeout: overview never rendered', checkedAt: new Date().toISOString() };
    } else {
      const lines = cap.bodyText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const v = parseCompact(pick(lines, '自然流量', /^[\d.,]+\s*[KMB]?$/i));
      row = {
        domain,
        verdict: v === null ? 'below-floor' : v >= 100 ? 'pass' : 'fail',
        organicTraffic: v,
        authorityScore: Number(pick(lines, 'Authority Score', /^\d+$/)) || null,
        checkedAt: new Date().toISOString(),
      };
    }
  } catch (error) {
    row = { domain, verdict: 'error', organicTraffic: null, error: String(error.message || error), checkedAt: new Date().toISOString() };
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
