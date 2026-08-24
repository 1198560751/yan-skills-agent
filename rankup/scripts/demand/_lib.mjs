/**
 * 用途：demand/ 下各脚本共用的小工具（参数解析、token 读取、输出、表格打印）。
 *       不是可执行脚本，只被同目录的 *.mjs import。
 * 依赖：无（Node 22 内置 fetch / node:fs / node:path）
 * 已验证日期：2026-08-24
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** 解析 argv：--key value / --key=value / --flag / 位置参数 */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const body = a.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) { pushVal(out, body.slice(0, eq), body.slice(eq + 1)); continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[body] = true;
    else { pushVal(out, body, next); i++; }
  }
  return out;
}
function pushVal(o, k, v) {
  if (k in o) o[k] = Array.isArray(o[k]) ? [...o[k], v] : [o[k], v];
  else o[k] = v;
}
export const asList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/**
 * token 读取顺序：环境变量 → rankup/.env（KEY=value 每行一个）。
 * 永远不要把真实 token 写进脚本或文档。
 */
export function readToken(...names) {
  for (const n of names) if (process.env[n]) return process.env[n];
  const envFile = path.resolve(new URL('../../.env', import.meta.url).pathname);
  try {
    const txt = fs.readFileSync(envFile, 'utf8');
    for (const line of txt.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      if (names.includes(k)) return t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* .env 不存在就算了 */ }
  return null;
}

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 带重试与超时的 fetch；默认带浏览器 UA（多数公开榜单会挡默认 UA） */
export async function get(url, { headers = {}, retries = 2, timeout = 25000, ua = DEFAULT_UA } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: ctl.signal,
        headers: { 'user-agent': ua, 'accept-language': 'en-US,en;q=0.9', ...headers },
      });
      clearTimeout(t);
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status} ${url}`);
        if (i < retries) { await sleep(800 * (i + 1)); continue; }
      }
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (i < retries) await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

export async function getJson(url, opts = {}) {
  const res = await get(url, { headers: { accept: 'application/json' }, ...opts });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url} :: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch {
    throw new Error(`响应不是 JSON（${res.status}，可能被反爬挡了）：${url} :: ${text.slice(0, 200)}`);
  }
}

export async function getText(url, opts = {}) {
  const res = await get(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url} :: ${text.slice(0, 200)}`);
  return text;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 落盘：.jsonl 走 JSON Lines，其它走 pretty JSON */
export function writeOut(file, rows) {
  const p = path.resolve(process.cwd(), file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (p.endsWith('.jsonl')) fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  else fs.writeFileSync(p, JSON.stringify(rows, null, 2) + '\n');
  return p;
}

const width = (s) => [...String(s)].reduce((n, c) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(c) ? 2 : 1), 0);
const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - width(s)));
const clip = (s, max) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (width(s) <= max) return s;
  let out = '', w = 0;
  for (const c of s) { const cw = width(c); if (w + cw > max - 1) break; out += c; w += cw; }
  return out + '…';
};

/** 人类可读表格；cols = [{key, label, max}] */
export function printTable(rows, cols) {
  if (!rows.length) { console.log('(无结果)'); return; }
  const cells = rows.map((r) => cols.map((c) => clip(r[c.key], c.max ?? 40)));
  const ws = cols.map((c, i) => Math.max(width(c.label), ...cells.map((row) => width(row[i]))));
  console.log(cols.map((c, i) => pad(c.label, ws[i])).join('  '));
  console.log(ws.map((w) => '-'.repeat(w)).join('  '));
  for (const row of cells) console.log(row.map((v, i) => pad(v, ws[i])).join('  '));
}

/** 统一收尾：--json / --out / 表格 */
export function emit(rows, args, cols) {
  if (args.out) {
    const p = writeOut(args.out, rows);
    if (!args.json) console.error(`已写入 ${p}（${rows.length} 条）`);
  }
  if (args.json) { console.log(JSON.stringify(rows, null, 2)); return; }
  printTable(rows, cols);
  console.error(`\n共 ${rows.length} 条`);
}

/**
 * 会话名就是标签页的所有权声明：两个任务挑同一个名字就共用同一个标签页，
 * 各自读回对方打开的页面——导航报成功、数据是别人的、全程不报错。
 * 所以任何脚本都不许把会话名的默认值写成字面常量。
 *
 * 后缀取「真正会并发的那个单位」：一次对话 = 一个 CLAUDE_CODE_SESSION_ID。
 * HOST_SESSION_ID 是整个桌面端共用的，拿它当第一顺位等于把同一个标签页
 * 发给两个并行任务，只能垫底。node 脚本里 pid 全程不变所以可以兜底，
 * 但 Bash tool 里的 `$$` 每次调用都变，绝不能用。
 */
export function sessionName(base) {
  const suffix = (
    process.env.OPENCLI_SESSION_SUFFIX ||
    process.env.CLAUDE_CODE_SESSION_ID ||
    process.env.CLAUDE_CODE_HOST_SESSION_ID ||
    String(process.ppid)
  ).replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "local";
  return `${base}-${suffix}`;
}

export function die(msg) { console.error(`错误：${msg}`); process.exit(1); }

/**
 * 探测 OpenCLI 浏览器桥是否连上，短超时，三种判定：
 *   - true  ：doctor 明确说连上了
 *   - false ：doctor 明确说没连上
 *   - null  ：探测本身不可信（opencli 不存在、超时、输出格式认不出）——
 *             调用方必须把 null 当「放行」处理，绝不能因为探测器自己的问题
 *             挡住一个本来可能能跑的调用。
 *
 * 判据只认 `[OK] Connectivity`，不认 "Everything looks good"：doctor 只要有
 * 任何一条 Issue（哪怕只是「扩展版本比 yan-labs 构建旧」这种纯建议）就不再
 * 打印那句话，但桥其实完全可用。这个坑 reddit-wishes.mjs 已经踩过一次
 * （2026-08-23），这里直接复用同一条判据，不再各写各的。
 */
export function probeBrowserBridge(bin = 'opencli', timeoutMs = 4000) {
  const r = spawnSync(bin, ['doctor'], { encoding: 'utf8', timeout: timeoutMs });
  if (r.error || r.status === null) return null; // 调不起来 / 超时
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (/\[OK\]\s*Connectivity/i.test(out)) return true;
  if (/Connectivity/i.test(out)) return false;
  return null; // 有输出但读不懂，别当成「没连上」
}

/**
 * 挡在「真的要发浏览器调用」之前的硬检查：明确没连上就 fail fast 并说清楚
 * 原因（不是「查无结果」，是桥没通），别的情况一律放行（fail open）。
 *
 * 为什么要 fail open：探测器本身也可能坏（opencli 升级改了 doctor 的文案、
 * 二进制暂时不在 PATH、这次探测恰好超时），一个会误报「没连上」的检查
 * 比它要防的那个静默卡死更糟——会把每一个原本能跑的环境都挡下来。
 */
export function requireBrowserBridge(bin = 'opencli') {
  if (probeBrowserBridge(bin) === false) {
    die(
      'OpenCLI 浏览器桥没连上——这不是「查无结果」，是根本没取到数据。\n' +
      '  修复：打开 Chrome → 确认 OpenCLI 扩展已安装并启用 → 跑 `opencli doctor`，' +
      '看到 Connectivity 那行是 [OK] 再重跑本脚本。'
    );
  }
}
