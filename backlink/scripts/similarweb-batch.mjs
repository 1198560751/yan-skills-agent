#!/usr/bin/env node
/**
 * similarweb-batch.mjs —— 一次登录，批量测流量。
 *
 * 为什么要有它：`similarweb-query.mjs` 每跑一个域名都要重走一遍「开面板 → 选节点 →
 * 点打开 → 等落地」，实测单域名 27 秒，其中 20 秒是启动。批量筛选外链目标动辄几百个
 * 域名，按单域名脚本跑要三个多小时，而这套面板是**共享订阅、随时会到期**的，
 * 慢就等于拿不到。本脚本把启动做一次，之后只换 hash 路由，单域名摊到 6-10 秒。
 *
 * 三条硬约束，照抄别改：
 *   1. **同步前台跑，不许后台化。** 这是一长串网络调用，后台化之后没有任何东西会叫醒
 *      调用方，任务会在写下零行输出的情况下"完成"。要跑很久就调大超时，不要放后台。
 *   2. **每测完一个域名立刻追加写盘（JSONL）。** 中途挂掉时已测的部分必须留下。
 *   3. **可续跑。** 启动时读一遍输出文件，已有的域名直接跳过。
 *
 * 「查不到数据」本身就是结论，不是失败：Similarweb 有测量下限，落在下限之下的站
 * 就是流量小到不值得为它填表。这类记为 `verdict: "below-floor"`，照样写进输出。
 *
 * **而且必须正面认出它，不能靠超时兜底。** 下限之下的域名页面是**正常渲染完成**的，
 * 只是把指标区换成了「抱歉，未找到与该搜索匹配的内容」+ 一排 N/A。第一版只认
 * 「总访问量」，于是每个这类域名都白等满一整个超时——单域名从 5 秒涨到 45 秒，
 * 而这类域名恰恰是批量筛选里最多的那一档。判据：**「没有数据」几乎总有一个自己的
 * 页面形态，去把那句话找出来，不要用超时代替它。**
 *
 * 用法：
 *   node scripts/similarweb-batch.mjs --domains-file d.txt --out traffic.jsonl [--session x] [--node 3]
 *
 * 已验证：2026-08-20。
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { defaultSession, parseFlags, required, validateSession } from './opencli-core.mjs';
import { expiryWarning, gotoInTool, launchTool } from './lib-tools-share.mjs';

const flags = parseFlags(process.argv.slice(2));
const outPath = required(flags, 'out');
const session = flags.session ? validateSession(flags.session) : defaultSession('sw-batch');
const appOrigin = (process.env.TOOLS_SHARE_APP_ORIGIN || 'https://sim.3ue.co').replace(/\/+$/, '');
const perDomainTimeout = Math.max(10_000, Number(flags['domain-timeout'] || 45) * 1000);
const settle = Number(flags.settle || 4);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeDomain(value) {
  const c = value.includes('://') ? new URL(value).hostname : value.split('/')[0];
  const n = c.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,63}$/.test(n) ? n : null;
}

const wanted = [];
{
  const raw = flags['domains-file']
    ? readFileSync(flags['domains-file'], 'utf8')
    : required(flags, 'domains').split(',').join('\n');
  for (const line of raw.split('\n')) {
    const d = normalizeDomain(line.trim());
    if (d && !wanted.includes(d)) wanted.push(d);
  }
}

// 续跑：已经写过的域名不再测。
const done = new Set();
if (existsSync(outPath)) {
  for (const line of readFileSync(outPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      // **error 不算跑过。** 它是「这次没测成」，不是结论。把它当已完成会让一次会话
      // 挂掉造成的整段空洞永久固化下来，而且完全看不出来——输出行数是齐的。
      if (r.verdict !== 'error') done.add(r.domain);
    } catch { /* 半行，忽略 */ }
  }
}
const todo = wanted.filter((d) => !done.has(d));
console.error(`[batch] ${wanted.length} requested, ${done.size} already done, ${todo.length} to go`);
if (!todo.length) process.exit(0);

function parseNumber(value) {
  const n = String(value || '').replace(/,/g, '').trim();
  const m = n.match(/^([\d.]+)\s*([KMB万亿])?$/i);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9, 万: 1e4, 亿: 1e8 };
  return Number(m[1]) * (mult[(m[2] || '').toLowerCase()] || 1);
}
const parseRank = (v) => { const m = String(v || '').replace(/,/g, '').match(/#?\s*(\d+)/); return m ? Number(m[1]) : null; };

function deriveMetrics(lines) {
  const nextValue = (labels, pattern = /./) => {
    for (const label of [].concat(labels)) {
      const i = lines.findIndex((l) => l === label || l.includes(label));
      if (i < 0) continue;
      const hit = lines.slice(i + 1, i + 8).find((l) => pattern.test(l));
      if (hit) return hit;
    }
    return null;
  };
  return {
    totalVisits: parseNumber(nextValue('总访问量', /^[\d,.]+\s*[KMB万亿]?$/i)),
    globalRank: parseRank(nextValue('全球排名', /#?\s*[\d,]+/)),
    countryRank: parseRank(nextValue('国家/地区排名', /#?\s*[\d,]+/)),
  };
}

const launched = await launchTool({
  session,
  tool: 'similarweb',
  node: flags.node,
  window: flags.window === 'foreground' ? 'foreground' : 'background',
  wait: Number(flags.wait || 7),
  timeout: Number(flags.launchTimeout || 60),
});
const evaluate = launched.evalPage;
const subscription = {
  expiry: launched.state.expiry,
  daysLeft: launched.state.daysLeft,
  warning: expiryWarning(launched.state),
};
if (subscription.warning) console.error(`[batch] ${subscription.warning}`);

const ROUTE = '/#/digitalsuite/websiteanalysis/overview/website-performance/*/999/28d?webSource=Total&key=';

let n = 0;
let consecutiveErrors = 0;
for (const domain of todo) {
  n += 1;
  const startedAt = Date.now();
  let row;
  try {
    await gotoInTool(evaluate, `${appOrigin}${ROUTE}${encodeURIComponent(domain)}`, settle);
    // 轮询认「总访问量」——那是只有数据渲染完才出现的内容词。左侧导航里的「网站表现」
    // 是骨架挂载就有的菜单项，认它会秒过并读到空指标。
    let captured = null;
    while (Date.now() - startedAt < perDomainTimeout) {
      const s = await evaluate(`(() => ({
        url: location.href,
        ready: /总访问量/.test(document.body?.innerText || ''),
        noData: /抱歉，未找到与该搜索匹配的内容|没有足够的数据|Not enough data|我们没有此网站的数据/.test(document.body?.innerText || ''),
        bodyText: (document.body?.innerText || '').slice(0, 20000)
      }))()`);
      const onTarget = String(s.url || '').includes(`key=${encodeURIComponent(domain)}`);
      if (onTarget && (s.ready || s.noData)) { captured = s; break; }
      await sleep(2000);
    }
    if (!captured) {
      // **超时不是结论，是这次没测成。** 记 error，下次续跑会重测。
      // 曾经把它记成 below-floor，结果一个自然流量 2.4K 的站被判成「没流量」——
      // 渲染慢和没有数据在超时这一刻长得一模一样，而两者的结论正好相反。
      // 只有数据源**明说**「未找到匹配内容」才算 below-floor。
      row = { domain, verdict: 'error', totalVisits: null, error: 'timeout: neither the metric nor the empty-state marker appeared', checkedAt: new Date().toISOString() };
    } else {
      const lines = captured.bodyText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const m = deriveMetrics(lines);
      const v = m.totalVisits;
      // 到这里说明页面已渲染完：要么有指标，要么明确写着「未找到匹配内容」。
      // 后者才是 below-floor。
      row = {
        domain,
        verdict: v === null ? 'below-floor' : v >= 100 ? 'pass' : 'fail',
        totalVisits: v,
        globalRank: m.globalRank,
        countryRank: m.countryRank,
        checkedAt: new Date().toISOString(),
      };
    }
  } catch (error) {
    row = { domain, verdict: 'error', totalVisits: null, error: String(error.message || error), checkedAt: new Date().toISOString() };
  }
  appendFileSync(outPath, `${JSON.stringify(row)}\n`, 'utf8');
  // 熔断：会话一旦挂了，后面每一个域名都要付满一整个超时，而且全部记成 error。
  // 实测挂过一次，连烧 48 个域名 60 秒。**连续失败就停下换新会话，不要跑完整张表。**
  if (row.verdict === 'error') {
    consecutiveErrors += 1;
    if (consecutiveErrors >= 5) {
      console.error(`[batch] ABORT: ${consecutiveErrors} consecutive errors — the browser session is dead, not the domains. Rerun with a fresh --session; error rows are retried automatically.`);
      process.exit(3);
    }
  } else consecutiveErrors = 0;
  console.error(`[batch] ${n}/${todo.length} ${domain} → ${row.verdict}${row.totalVisits !== null && row.totalVisits !== undefined ? ` (${row.totalVisits})` : ''} ${Math.round((Date.now() - startedAt) / 1000)}s`);
}
console.error('[batch] done');
