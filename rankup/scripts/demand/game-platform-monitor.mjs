#!/usr/bin/env node
/** 批量运行 sitemap-diff.mjs，把多语种游戏平台的新内页汇成一份候选报告。 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { asList, die, parseArgs, writeOut, initEvidence, saveEvidence, recordSource, writeManifest, evidenceDir } from './_lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = path.resolve(process.cwd(), '.rankup/demand/game-platforms.json');

const HELP = `
game-platform-monitor.mjs — 批量监测多语种游戏平台 sitemap

用法:
  node scripts/demand/game-platform-monitor.mjs [选项]

选项:
  --config <file>       平台清单（默认 .rankup/demand/game-platforms.json）
  --language <code>     按语言筛选，可重复或逗号分隔，如 de,pl,ja,ar,ru
  --market <code>       按市场筛选，可重复或逗号分隔，如 DE,KZ,UA
  --platform <id>       按平台 id 筛选，可重复或逗号分隔
  --state <dir>         快照目录（默认 .rankup/demand/game-sitemap-snapshots）
  --out <file>          报告路径（默认 .rankup/demand/game-review/YYYY-MM-DD.json）
  --concurrency <n>     并发平台数（默认 3）
  --limit <n>           每个平台最多读取多少条变化（默认 1000）
  --max-sitemaps <n>    每个平台最多抓多少个子 sitemap（默认 200）
  --delay <ms>          子 sitemap 抓取间隔（默认 100）
  --timeout <seconds>   单个平台运行时间上限（默认 300 秒）
  --dry-run             校验清单并显示本次选择，不联网、不写快照
  --self-test           运行同日累积合并离线检查
  --json                stdout 输出完整 JSON
  --help
`.trim();

const list = (value) => asList(value).flatMap((v) => String(v).split(',')).map((v) => v.trim()).filter(Boolean);
const positiveInt = (value, fallback, name) => {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < 1) die(`${name} 需要正整数`);
  return n;
};

function loadPlatforms(file) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { die(`平台清单读取失败：${e.message}`); }
  if (!data || !Array.isArray(data.platforms)) die('平台清单需要 platforms 数组');

  const ids = new Set();
  for (const p of data.platforms) {
    if (!p?.id || ids.has(p.id)) die(`平台 id 缺失或重复：${p?.id ?? '(空)'}`);
    ids.add(p.id);
    if (!p.name || !Array.isArray(p.languages) || !p.languages.length || !Array.isArray(p.markets) || !p.markets.length) {
      die(`${p.id} 需要 name、languages、markets`);
    }
    if (!Array.isArray(p.sitemaps) || !p.sitemaps.length) die(`${p.id} 需要至少一个 sitemap`);
    for (const field of ['include', 'exclude', 'excludeSitemaps']) {
      if (p[field] !== undefined && !Array.isArray(p[field])) die(`${p.id} 的 ${field} 需要数组`);
      for (const pattern of p[field] ?? []) {
        try { new RegExp(pattern); } catch { die(`${p.id} 的 ${field} 正则有误：${pattern}`); }
      }
    }
    if (p.timeout !== undefined && (!Number.isInteger(p.timeout) || p.timeout < 1)) die(`${p.id} 的 timeout 需要正整数`);
    for (const url of [p.homepage, ...p.sitemaps]) {
      try { if (!/^https?:$/.test(new URL(url).protocol)) throw new Error(); }
      catch { die(`${p.id} 的 URL 格式有误：${url}`); }
    }
  }
  return data;
}

function runDiff(platform, options) {
  const argv = [
    path.join(HERE, 'sitemap-diff.mjs'),
    ...platform.sitemaps.flatMap((url) => ['--sitemap', url]),
    '--name', platform.id,
    '--state', options.state,
    '--limit', String(options.limit),
    '--max-sitemaps', String(options.maxSitemaps),
    '--delay', String(options.delay),
    '--track-lastmod',
    ...asList(platform.include).flatMap((pattern) => ['--include', String(pattern)]),
    ...asList(platform.exclude).flatMap((pattern) => ['--exclude', String(pattern)]),
    ...asList(platform.excludeSitemaps).flatMap((pattern) => ['--exclude-sitemap', String(pattern)]),
    '--json',
  ];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argv, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    let timedOut = false;
    const timeout = platform.timeout ?? options.timeout;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout * 1000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, error: error.message, stdout, stderr }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return resolve({ ok: false, error: `超过 ${timeout} 秒`, stdout, stderr });
      if (code !== 0) return resolve({ ok: false, error: stderr.trim() || `退出码 ${code}`, stdout, stderr });
      try { resolve({ ok: true, rows: JSON.parse(stdout), notes: stderr.trim(), stdout, stderr }); }
      catch (e) { resolve({ ok: false, error: `输出解析失败：${e.message}`, stdout, stderr }); }
    });
  });
}

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i]);
    }
  }));
  return results;
}

const rowKey = (row) => `${row.status ?? ''}:${row.url ?? row.loc ?? ''}:${row.lastmod ?? ''}`;
const mergeRows = (older, newer) => [...new Map([...(older ?? []), ...(newer ?? [])].map((row) => [rowKey(row), row])).values()];

function mergeSameDay(previous, current, day) {
  if (!previous || String(previous.generatedAt ?? '').slice(0, 10) !== day) return { ...current, runCount: 1, sameDayMerged: false };
  const olderById = new Map((previous.platforms ?? []).map((row) => [row.id, row]));
  const platforms = current.platforms.map((row) => {
    const older = olderById.get(row.id);
    if (!older) return row;
    return {
      ...older,
      ...row,
      added: mergeRows(older.added, row.added),
      changed: mergeRows(older.changed, row.changed),
      removed: mergeRows(older.removed, row.removed),
    };
  });
  const candidates = platforms.flatMap((p) => (p.added ?? []).map((row) => ({
    platformId: p.id, platform: p.name, kind: p.kind ?? 'playable-game',
    languages: p.languages, markets: p.markets, ...row,
  })));
  return {
    ...current,
    runCount: Number(previous.runCount ?? 1) + 1,
    sameDayMerged: true,
    runHistory: [...(previous.runHistory ?? [{ generatedAt: previous.generatedAt, failures: previous.failures ?? 0 }]), { generatedAt: current.generatedAt, failures: current.failures ?? 0 }],
    baselineCreated: platforms.filter((p) => p.status === 'baseline_created').length,
    compared: platforms.filter((p) => p.status === 'compared').length,
    failures: platforms.filter((p) => p.status === 'failed').length,
    candidates,
    platforms,
  };
}

async function main() {
  const args = parseArgs();
  if (args.help || args.h) { console.log(HELP); return; }
  if (args['self-test']) {
    const older = { generatedAt: '2099-01-02T01:00:00Z', selectedPlatforms: 1, failures: 0, platforms: [{ id: 'a', name: 'A', status: 'compared', added: [{ status: 'added', url: 'https://a.test/one' }], changed: [], removed: [] }] };
    const newer = { generatedAt: '2099-01-02T02:00:00Z', selectedPlatforms: 1, failures: 0, platforms: [{ id: 'a', name: 'A', status: 'compared', added: [], changed: [{ status: 'changed', url: 'https://a.test/two', lastmod: '2099-01-02' }], removed: [] }] };
    const merged = mergeSameDay(older, newer, '2099-01-02');
    if (merged.runCount !== 2 || merged.candidates.length !== 1 || merged.platforms[0].changed.length !== 1) die('同日累积合并检查失败');
    console.log('game-platform-monitor self-test passed');
    return;
  }

  const config = path.resolve(process.cwd(), String(args.config ?? DEFAULT_CONFIG));
  const data = loadPlatforms(config);
  const languages = new Set(list(args.language).map((v) => v.toLowerCase()));
  const markets = new Set(list(args.market).map((v) => v.toUpperCase()));
  const ids = new Set(list(args.platform));
  const selected = data.platforms.filter((p) =>
    (!languages.size || p.languages.some((v) => languages.has(v.toLowerCase())))
    && (!markets.size || p.markets.some((v) => markets.has(v.toUpperCase())))
    && (!ids.size || ids.has(p.id)));
  if (!selected.length) die('筛选后没有平台');

  if (args['dry-run']) {
    const report = { config, verifiedAt: data.verifiedAt, selectedPlatforms: selected.length, platforms: selected };
    console.log(args.json ? JSON.stringify(report, null, 2) : selected.map((p) => `${p.id}\t${p.languages.join(',')}\t${p.markets.join(',')}`).join('\n'));
    return;
  }

  const state = path.resolve(process.cwd(), String(args.state ?? '.rankup/demand/game-sitemap-snapshots'));
  const options = {
    state,
    concurrency: positiveInt(args.concurrency, 3, '--concurrency'),
    limit: positiveInt(args.limit, 1000, '--limit'),
    maxSitemaps: positiveInt(args['max-sitemaps'], 200, '--max-sitemaps'),
    delay: positiveInt(args.delay, 100, '--delay'),
    timeout: positiveInt(args.timeout, 300, '--timeout'),
  };

  initEvidence('game-platform-monitor', { dir: args['evidence-dir'] ?? null });

  const platforms = await pool(selected, options.concurrency, async (platform) => {
    const snapshot = path.join(state, `${platform.id}.json`);
    const baseline = !fs.existsSync(snapshot);
    const result = await runDiff(platform, options);
    // 逐平台把子进程 stdout/stderr 原样落证据目录：失败只剩一句 error 时，
    // 「sitemap 403」「超时」「解析崩了」在原始输出里才分得开。
    saveEvidence(`${platform.id}-stdout.txt`, result.stdout ?? '');
    saveEvidence(`${platform.id}-stderr.txt`, result.stderr ?? '');
    if (!result.ok) {
      recordSource({ source: platform.id, status: 'failed', rawCount: 0, error: result.error });
      return { ...platform, status: 'failed', error: result.error };
    }
    recordSource({ source: platform.id, status: 'ok', rawCount: result.rows.length });
    let count = 0;
    try { count = JSON.parse(fs.readFileSync(snapshot, 'utf8')).count ?? 0; } catch { /* 由 rows 兜底 */ }
    const added = baseline ? [] : result.rows.filter((row) => row.status === 'added');
    const changed = baseline ? [] : result.rows.filter((row) => row.status === 'changed');
    const removed = baseline ? [] : result.rows.filter((row) => row.status === 'removed');
    return { ...platform, status: baseline ? 'baseline_created' : 'compared', count, added, changed, removed, notes: result.notes || null };
  });

  const candidates = platforms.flatMap((p) => (p.added ?? []).map((row) => ({
    platformId: p.id,
    platform: p.name,
    kind: p.kind ?? 'playable-game',
    languages: p.languages,
    markets: p.markets,
    ...row,
  })));
  let report = {
    generatedAt: new Date().toISOString(),
    config,
    selectedPlatforms: selected.length,
    baselineCreated: platforms.filter((p) => p.status === 'baseline_created').length,
    compared: platforms.filter((p) => p.status === 'compared').length,
    failures: platforms.filter((p) => p.status === 'failed').length,
    candidates,
    platforms,
  };
  const day = report.generatedAt.slice(0, 10);
  const out = String(args.out ?? `.rankup/demand/game-review/${day}.json`);
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* 首次运行 */ }
  report = mergeSameDay(previous, report, day);
  const written = writeOut(out, report);
  const mf = writeManifest(report.failures ? `completed_with_failures: ${report.failures}` : 'completed');
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(`平台 ${selected.length}｜新 baseline ${report.baselineCreated}｜已对比 ${report.compared}｜候选 ${candidates.length}｜失败 ${report.failures}\n报告 ${written}`);
  if (report.failures) {
    // 「候选 0 + 失败 N」不许被读成「无新游」：失败的平台根本没被看过。
    if (!candidates.length) {
      console.error(`注意：候选 0 条，但 ${report.failures} 个平台采集失败——这不是「没有新游」的证据，` +
        `失败平台的子进程输出在 ${evidenceDir()}。`);
    } else {
      console.error(`注意：${report.failures} 个平台采集失败，候选清单不完整；子进程输出在 ${evidenceDir()}。`);
    }
    process.exitCode = 1;
  }
  if (mf) console.error(`manifest：${mf}`);
}

main().catch((e) => die(e.message));
