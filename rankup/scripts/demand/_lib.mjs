/**
 * 用途：demand/ 下各脚本共用的小工具（参数解析、token 读取、输出、表格打印）。
 *       不是可执行脚本，只被同目录的 *.mjs import。
 * 依赖：无（Node 22 内置 fetch / node:fs / node:path）
 * 已验证日期：2026-08-23
 */

import fs from 'node:fs';
import path from 'node:path';

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

export function die(msg) { console.error(`错误：${msg}`); process.exit(1); }
