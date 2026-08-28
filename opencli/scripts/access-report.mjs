#!/usr/bin/env node
/**
 * access-report.mjs — 读 ~/.opencli/logs/site-access.jsonl，回答复盘时最常问的问题。
 *
 * 为什么需要它：OpenCLI 自己的日志答不了这些——它记标签页租约和导航超时，
 * 不记 HTTP 状态、不记响应体、不记谁在调。而复盘要问的恰恰是：
 * 「这一串标签页是谁开的」「哪个路由最费劲」「哪几次取回来是空的」。
 *
 * 用法：
 *   node access-report.mjs                    # 全部
 *   node access-report.mjs --since 2h         # 最近两小时（也支持 30m / 3d）
 *   node access-report.mjs --site sem.3ue.co  # 只看一个站
 *   node access-report.mjs --suspicious       # 只列可疑行（失败 / payload 异常小）
 *   node access-report.mjs -f json            # 机器可读
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
/** 参数解析内联在这里，让这个脚本零依赖、单文件可拷走。 */
function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--help' || t === '-h') { flags.help = true; continue; }
    if (!t.startsWith('-')) continue;
    const key = t.replace(/^-+/, '');
    const next = argv[i + 1];
    if (next && !next.startsWith('-')) { flags[key] = next; i += 1; } else flags[key] = true;
  }
  return flags;
}

const flags = parseFlags(process.argv.slice(2));
if (flags.help) {
  console.log(readFileSync(new URL(import.meta.url).pathname, 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1]
    .split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim());
  process.exit(0);
}
const path = flags.file || join(homedir(), '.opencli', 'logs', 'site-access.jsonl');
if (!existsSync(path)) {
  console.error(`没有访问日志：${path}\n跑过任何 opencli 调用之后才会有（OPENCLI_ACCESS_LOG=0 会关掉记账）。`);
  process.exit(1);
}

const rows = readFileSync(path, 'utf8').split('\n')
  .filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } })
  .filter(Boolean);

const since = (() => {
  if (!flags.since) return 0;
  const m = String(flags.since).match(/^(\d+)([mhd])$/);
  if (!m) throw new Error('--since 形如 30m / 2h / 3d');
  return Date.now() - Number(m[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[m[2]];
})();

let data = rows.filter((r) => Date.parse(r.ts) >= since);
if (flags.site) data = data.filter((r) => r.site === flags.site);

const pct = (arr, p) => {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

/**
 * 「可疑」不等于「限流」——本脚本不判限流，只把值得肉眼看一眼的行捞出来。
 * 限流在 Semrush 上是 HTTP 200 + 页面里写着已达上限，自动判据需要样本，
 * 而样本正是要从这里挑。判据：调用失败，或成功但 payload 小得不像有数据。
 */
const suspicious = data.filter((r) => !r.ok || (r.bytes !== null && r.bytes < 200 && r.action === 'eval'));

if (flags.suspicious) {
  for (const r of suspicious) {
    console.log(`${r.ts}  ${r.ok ? 'ok ' : 'ERR'}  ${String(r.bytes ?? '-').padStart(6)}B  ${r.session || '-'}  ${r.site || '-'}${r.route || ''}${r.error ? `\n        ${r.error}` : ''}`);
  }
  console.log(`\n共 ${suspicious.length} 行可疑 / 总 ${data.length} 行`);
  process.exit(0);
}

const byRoute = new Map();
for (const r of data) {
  const key = `${r.site || '-'}${r.route || ''}`;
  if (!byRoute.has(key)) byRoute.set(key, { n: 0, fail: 0, ms: [], quota: r.quota });
  const g = byRoute.get(key);
  g.n += 1; if (!r.ok) g.fail += 1; if (typeof r.ms === 'number') g.ms.push(r.ms);
}
const routes = [...byRoute.entries()].sort((a, b) => b[1].n - a[1].n);

const byWho = new Map();
for (const r of data) {
  const key = r.tag || r.session || '-';
  byWho.set(key, (byWho.get(key) || 0) + 1);
}

if (flags.format === 'json' || flags.f === 'json') {
  console.log(JSON.stringify({
    total: data.length, suspicious: suspicious.length,
    routes: routes.map(([k, g]) => ({ route: k, n: g.n, fail: g.fail, quota: g.quota, p50: pct(g.ms, 0.5), p95: pct(g.ms, 0.95) })),
    byWho: Object.fromEntries(byWho),
  }, null, 2));
  process.exit(0);
}

console.log(`访问日志 ${path}\n范围 ${data.length} 行${flags.since ? ` (最近 ${flags.since})` : ''}${flags.site ? ` site=${flags.site}` : ''}\n`);
console.log('按路由（决定哪些值得封 adapter）');
console.log('   次数   失败    p50     p95  配额站  路由');
for (const [key, g] of routes.slice(0, Number(flags.top || 20))) {
  console.log(`${String(g.n).padStart(7)}${String(g.fail).padStart(7)}${String(pct(g.ms, 0.5) ?? '-').padStart(7)}ms${String(pct(g.ms, 0.95) ?? '-').padStart(7)}ms${(g.quota ? '   是  ' : '   -   ').padStart(7)}  ${key}`);
}
console.log('\n按调用方（复盘「这串标签页是谁开的」）');
for (const [key, n] of [...byWho].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`${String(n).padStart(7)}  ${key}`);
}
console.log(`\n可疑行 ${suspicious.length} 条——用 --suspicious 看明细（失败，或成功但 payload 小得不像有数据）`);
