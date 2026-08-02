#!/usr/bin/env node
/**
 * harvest-merge.mjs — 合并 harvest.browser.js 抓下来的 TSV，出一张干净的 CSV
 *
 *   node harvest-merge.mjs <dir-or-files...> --out result [--key-col 1] [--min-cols 5]
 *
 * 做三件本地脚本才好做的事：
 *   1. 拦重复文件（浏览器重名产物）—— 内容不同却同名，静默合并 = 数据污染
 *   2. 滤脏行 —— 主键列错位成数值/百分比/徽章时，会有"数字当名称"的垃圾行进最终报告
 *   3. 保字段去重 —— 多来源合并时，别让"数值更大但字段更少"的行抹掉独有字段
 *
 * 字段语义（哪列是量、哪列是难度）随后台而异，不写死在这里：
 * 本脚本只保证行是干净的、去重是安全的，语义解释交给调用方。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const out = flag('out', 'harvest-result');
const keyCol = Number(flag('key-col', 1));
const minCols = Number(flag('min-cols', 5));

const inputs = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out' && argv[i - 1] !== '--key-col' && argv[i - 1] !== '--min-cols');
const files = inputs.flatMap((p) => {
  try {
    return statSync(p).isDirectory()
      ? readdirSync(p).filter((f) => f.endsWith('.tsv')).map((f) => join(p, f))
      : [p];
  } catch {
    return [];
  }
});
if (!files.length) {
  console.error('✗ 没有找到任何 .tsv 输入');
  process.exit(1);
}

// ── 守卫 1：浏览器重名产物 ──────────────────────────────────────────────
const dupes = files.filter((f) => /\(\d+\)\.tsv$/.test(f));
if (dupes.length) {
  console.error(`✗ 检测到浏览器重复下载文件（内容可能与正本不同），先删掉或改名：\n${dupes.map((d) => '  ' + d).join('\n')}`);
  process.exit(1);
}
const seen = new Map();
for (const f of files) {
  const key = basename(f).replace(/\s*\(\d+\)/, '').replace(/\.tsv$/, '');
  if (seen.has(key)) {
    console.error(`✗ 同一目标出现多份文件，无法判定哪份是新的：\n  ${seen.get(key)}\n  ${f}`);
    process.exit(1);
  }
  seen.set(key, f);
}

// ── 解析 ───────────────────────────────────────────────────────────────
const isMagnitude = (s) => /^[\d.,]+\s*[KMB]?$/i.test(s);
const isPercent = (s) => /^[\d.,]+%$/.test(s);
const hasLetters = (s) => /[a-zА-Яа-яЀ-ӿ一-鿿぀-ヿ가-힯]/i.test(s);
const BADGES = /^(NEW|N\/A|-|—|INFO|NAV|LOCAL|TRANS|COMM)$/i;

const records = [];
let dropped = 0;
for (const f of files) {
  const source = basename(f).replace(/^harvest_(\d{8}_)?/, '').replace(/\.tsv$/, '');
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const cells = line.split('\t').map((s) => s.trim());
    if (cells.length < minCols) continue;
    const key = cells[keyCol];
    // ── 守卫 2：主键必须像个名字，不能是数值/百分比/徽章 ──
    if (!key || !hasLetters(key) || isMagnitude(key) || isPercent(key) || BADGES.test(key)) {
      dropped++;
      continue;
    }
    records.push({ key, cells, source });
  }
}

// ── 守卫 3：保字段去重 ──────────────────────────────────────────────────
// 多来源合并时，别让"字段更少但排序靠前"的行抹掉另一来源独有的字段。
// 实测这个 bug 让一张报表的头号条目从 91 项/180 万缩水成 52 项/1.3 万，且毫无异常提示。
const merged = new Map();
for (const r of records) {
  const prev = merged.get(r.key);
  if (!prev) {
    merged.set(r.key, { key: r.key, cells: r.cells, sources: new Set([r.source]) });
    continue;
  }
  prev.sources.add(r.source);
  // 逐列补空：任何一列，先到的为空而后到的有值，就补上
  const width = Math.max(prev.cells.length, r.cells.length);
  const out = [];
  for (let i = 0; i < width; i++) {
    const a = prev.cells[i];
    const b = r.cells[i];
    out[i] = a && a !== '-' && a !== '—' ? a : b || a || '';
  }
  prev.cells = out;
}

const rows = [...merged.values()];
const width = Math.max(...rows.map((r) => r.cells.length));
const header = ['key', ...Array.from({ length: width }, (_, i) => `c${i}`), 'sources'];
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = [
  header.join(','),
  ...rows.map((r) => [r.key, ...Array.from({ length: width }, (_, i) => r.cells[i] ?? ''), [...r.sources].join(';')].map(esc).join(',')),
].join('\n');

mkdirSync(dirname(out) === '.' ? '.' : dirname(out), { recursive: true });
writeFileSync(`${out}.csv`, csv);

console.log(JSON.stringify({ files: files.length, parsed: records.length, dropped, unique: rows.length, out: `${out}.csv` }, null, 1));
