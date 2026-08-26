#!/usr/bin/env node
/** 小游戏机会流水线：复用 Rankup 取数脚本，统一产出每日候选与中文报告。 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const MONITOR = path.join(REPO, 'rankup/scripts/demand/game-platform-monitor.mjs');
const NEW_TITLES = path.join(REPO, 'rankup/scripts/demand/game-newtitles.mjs');
const SEMRUSH_KEYWORD = path.join(REPO, 'backlink/scripts/semrush-keyword.mjs');
const ACTIONS = ['develop', 'research', 'watch'];

const HELP = `game-opportunity.mjs — 每日小游戏机会发现、筛选与报告

用法:
  node game-opportunity/scripts/game-opportunity.mjs <命令> [选项]

命令:
  discover   运行游戏平台 sitemap diff
  radar      聚合 Steam、itch.io、Poki 新标题并做历史 diff
  collect    依次运行 discover + radar，供早间自动任务采集
  collect-checklist  执行早间采集并逐项验收
  dedupe     合并当天 discovery + radar，只保留新增游戏
  plan       生成“全球先查、国家再下钻”的关键词计划
  demand     执行全球量查询，再查询主要国家与英语大市场
  evaluate   合并当天输入、验活 URL、生成候选与最终日报
  decision-checklist 执行需求调查、日报并逐项验收
  render     从已有候选或 --evaluation 文件重新生成日报
  daily      依次运行 collect + demand + evaluate

选项:
  --date YYYY-MM-DD       报告日期（默认今天）
  --limit <n>             每个平台/来源最多读取条数（默认 30）
  --evaluation <file>     人工或外部量化结果；数组或 {candidates:[...]}
  --project-root <dir>    .rankup 所在项目（默认当前目录）
  --no-social             radar 不调用 Reddit、YouTube、X（离线检查用）
  --check-only            只检查已有产物，不重新取数
  --dry-run               只显示将执行的动作，不联网、不写文件
  --self-test             运行内置离线检查
  -h, --help

固定产物：.rankup/demand/game-review/YYYY-MM-DD-{discovery,radar,new-games,demand-plan,demand-results,candidates}.json、
          YYYY-MM-DD-report.md、latest.json、latest.md、latest-new-games.json`;

function parseArgs(argv) {
  const out = { command: null, date: new Date().toISOString().slice(0, 10), limit: 30, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (!argv[i + 1]) throw new Error(`${a} 缺少参数`);
      return argv[++i];
    };
    if (!a.startsWith('-') && !out.command) out.command = a;
    else if (a === '--date') out.date = next();
    else if (a === '--limit') out.limit = Number(next());
    else if (a === '--evaluation') out.evaluation = path.resolve(next());
    else if (a === '--project-root') out.root = path.resolve(next());
    else if (a === '--no-social') out.noSocial = true;
    else if (a === '--check-only') out.checkOnly = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date)) throw new Error('--date 需要 YYYY-MM-DD');
  if (!Number.isInteger(out.limit) || out.limit < 1) throw new Error('--limit 需要正整数');
  out.root = path.resolve(out.root);
  out.reviewDir = path.join(out.root, '.rankup/demand/game-review');
  out.radarState = path.join(out.root, '.rankup/demand/game-radar-snapshots');
  return out;
}

const readJson = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
};
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};
const writeText = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
};
const exists = (file) => fs.existsSync(file);
const nonempty = (v) => v !== null && v !== undefined && v !== '' && (!Array.isArray(v) || v.length > 0);
const arr = (v) => Array.isArray(v) ? v : (nonempty(v) ? [v] : []);
const validUrl = (v) => { try { return /^https?:$/.test(new URL(v).protocol); } catch { return false; } };
const uniq = (xs) => [...new Set(xs.filter(nonempty))];
const normalizeName = (v) => String(v ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const normalizeUrl = (v) => {
  try { const u = new URL(v); u.hash = ''; u.search = ''; return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`.toLowerCase(); }
  catch { return ''; }
};
const slugName = (url) => {
  try { return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || new URL(url).hostname).replace(/[-_]+/g, ' '); }
  catch { return '未命名游戏'; }
};
const decodeHtml = (v) => String(v ?? '').replace(/&(?:amp|#38);/gi, '&').replace(/&(?:quot|#34);/gi, '"').replace(/&(?:apos|#39);/gi, "'").replace(/&(?:lt|#60);/gi, '<').replace(/&(?:gt|#62);/gi, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
function pageMeta(html, baseUrl) {
  const title = decodeHtml(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || null;
  const rawIframe = decodeHtml(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html)?.[1] ?? '').trim();
  let iframeUrl = null;
  try { if (rawIframe) { const u = new URL(rawIframe, baseUrl); if (/^https?:$/.test(u.protocol)) iframeUrl = u.href; } } catch { /* 无效 iframe */ }
  return { title, iframeUrl };
}
function cleanPageTitle(title) {
  return decodeHtml(title).replace(/\s+/g, ' ').trim().split(/\s+(?:\||[-–—])\s+|[：｜]/)[0].replace(/\s*[|｜]\s*$/, '').trim();
}
const errorPageTitle = (title) => /^(?:404|410)\b|\bnot found\b|\bpage not found\b/i.test(String(title ?? '').trim());
const challengePageTitle = (title) => /^just a moment(?:\.\.\.)?$/i.test(String(title ?? '').trim());
function noisyName(candidate) {
  const name = arr(candidate.names)[0] ?? candidate.name ?? '';
  if (!name) return true;
  if (/\.(?:html?|php)(?:\W|$)/i.test(name) || /^[a-z]?\d{5,}$/i.test(name)) return true;
  const slug = arr(candidate.urls)[0] ? slugName(arr(candidate.urls)[0]) : '';
  return normalizeName(name) === normalizeName(slug) && (name === name.toLowerCase() || !/\s/.test(name));
}

function mergeMissing(base, incoming) {
  if (!nonempty(base)) return incoming;
  if (!nonempty(incoming)) return base;
  if (Array.isArray(base) && Array.isArray(incoming)) {
    const seen = new Set();
    return [...base, ...incoming].filter((v) => {
      const key = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  if (typeof base === 'object' && typeof incoming === 'object') {
    const out = { ...base };
    for (const [k, v] of Object.entries(incoming)) out[k] = mergeMissing(out[k], v);
    return out;
  }
  return base;
}

function runProcess(command, argv, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (e) => resolve({ ok: false, error: e.message, stdout, stderr }));
    child.on('close', (code) => resolve({ ok: code === 0, code, stdout, stderr, error: code ? stderr.trim() || `退出码 ${code}` : null }));
  });
}
const runNode = (script, argv, cwd) => runProcess(process.execPath, [script, ...argv], cwd);

function files(o) {
  const base = path.join(o.reviewDir, o.date);
  return {
    discovery: `${base}-discovery.json`, radar: `${base}-radar.json`,
    newGames: `${base}-new-games.json`,
    demandPlan: `${base}-demand-plan.json`, globalKeywords: `${base}-global-keywords.txt`,
    globalSemrush: `${base}-semrush-global.jsonl`, countryPlan: `${base}-country-plan.json`,
    countrySemrush: `${base}-semrush-countries.jsonl`, demandResults: `${base}-demand-results.json`,
    evaluation: `${base}-evaluation.json`,
    candidates: `${base}-candidates.json`, report: `${base}-report.md`,
    latestJson: path.join(o.reviewDir, 'latest.json'), latestMd: path.join(o.reviewDir, 'latest.md'),
    latestNewGames: path.join(o.reviewDir, 'latest-new-games.json'),
    collectChecklist: `${base}-collect-checklist.json`, collectChecklistMd: `${base}-collect-checklist.md`,
    decisionChecklist: `${base}-decision-checklist.json`, decisionChecklistMd: `${base}-decision-checklist.md`,
    latestCollectChecklist: path.join(o.reviewDir, 'latest-collect-checklist.json'),
    latestCollectChecklistMd: path.join(o.reviewDir, 'latest-collect-checklist.md'),
    latestDecisionChecklist: path.join(o.reviewDir, 'latest-decision-checklist.json'),
    latestDecisionChecklistMd: path.join(o.reviewDir, 'latest-decision-checklist.md'),
  };
}

function discoveryHealth(data) {
  const usable = Number(data?.compared ?? 0) + Number(data?.baselineCreated ?? 0);
  const warnings = arr(data?.platforms).filter((p) => p.status === 'failed').map((p) => `${p.id ?? p.name ?? 'unknown-platform'}: ${p.error ?? '抓取失败'}`);
  return { usable, partial: usable > 0 && warnings.length > 0, warnings };
}

async function discover(o) {
  const f = files(o);
  if (o.dryRun) return { ok: true, dryRun: true, command: `${process.execPath} ${MONITOR} --limit ${o.limit} --out ${f.discovery}` };
  fs.mkdirSync(o.reviewDir, { recursive: true });
  const r = await runNode(MONITOR, ['--limit', String(o.limit), '--out', f.discovery], o.root);
  if (!exists(f.discovery)) {
    writeJson(f.discovery, { date: o.date, generatedAt: new Date().toISOString(), candidates: [], platforms: [], errors: [r.error] });
    return { ...r, ok: false, partial: false, file: f.discovery };
  }
  const data = readJson(f.discovery);
  if (!data) return { ...r, ok: false, partial: false, error: 'discovery JSON 无法读取', file: f.discovery };
  const health = discoveryHealth(data);
  if (health.usable > 0) {
    data.warnings = uniq([...arr(data.warnings), ...health.warnings]);
    data.errors = [];
    writeJson(f.discovery, data);
    return { ...r, ok: true, partial: health.partial, warnings: health.warnings, error: null, file: f.discovery };
  }
  data.errors = uniq([...arr(data.errors), ...health.warnings, r.error]);
  writeJson(f.discovery, data);
  return { ...r, ok: false, partial: false, error: data.errors.join('; ') || '没有可用平台结果', file: f.discovery };
}

function itemKeys(item) {
  return uniq([validUrl(item.url) ? `u:${normalizeUrl(item.url)}` : '', normalizeName(item.name) ? `n:${normalizeName(item.name)}` : '']);
}

const campaignKeys = (item) => uniq([
  ...arr(item.urls).filter(validUrl).map((v) => `u:${normalizeUrl(v)}`),
  validUrl(item.url) ? `u:${normalizeUrl(item.url)}` : '',
  normalizeName(item.author) ? `a:${normalizeName(item.author)}` : '',
  normalizeName(item.title ?? item.name ?? item.text) ? `t:${normalizeName(item.title ?? item.name ?? item.text)}` : '',
]);

function mergeCampaigns(items) {
  const groups = [];
  for (const item of items) {
    const keys = campaignKeys(item);
    const hits = groups.map((g, i) => g.keys.some((k) => keys.includes(k)) ? i : -1).filter((i) => i >= 0);
    if (!hits.length) { groups.push({ keys, items: [item] }); continue; }
    const first = hits[0];
    groups[first].items.push(item);
    groups[first].keys = uniq([...groups[first].keys, ...keys]);
    for (const i of hits.slice(1).reverse()) {
      groups[first].items.push(...groups[i].items);
      groups[first].keys = uniq([...groups[first].keys, ...groups[i].keys]);
      groups.splice(i, 1);
    }
  }
  return groups.map((group, i) => {
    const rows = group.items;
    const names = uniq(rows.map((v) => v.title ?? v.name ?? v.text).filter(Boolean));
    const urls = uniq(rows.flatMap((v) => [...arr(v.urls), v.url, v.destinationUrl]).filter(validUrl));
    return {
      campaignId: `campaign-${String(i + 1).padStart(3, '0')}-${normalizeName(names[0]).replace(/ /g, '-').slice(0, 50)}`,
      name: names[0] ?? '未命名游戏线索', names, urls, sourceLinks: urls,
      evidenceLinks: urls, authors: uniq(rows.map((v) => v.author).filter(Boolean)),
      platforms: uniq(rows.map((v) => v.source)), campaignCount: 1, mentions: rows.length,
      firstSeen: rows.map((v) => v.publishedAt).filter(Boolean).sort()[0] ?? new Date().toISOString(),
      socialEvidence: rows,
    };
  });
}

function socialRows(source, rows) {
  return rows.map((row) => ({
    source,
    title: row.title ?? row.text ?? row.name,
    author: row.author ?? row.channel,
    url: row.url,
    destinationUrl: row.url_overridden_by_dest,
    publishedAt: row.created_utc ? new Date(Number(row.created_utc) * 1000).toISOString() : (row.created_at ?? row.published ?? null),
    engagement: {
      score: row.score ?? null, comments: row.comments ?? null, likes: row.likes ?? null,
      views: row.views ?? null,
    },
  })).filter((row) => row.title || row.url);
}

async function socialRadar(o) {
  if (o.noSocial) return { sources: [], candidates: [], errors: [] };
  const yesterday = new Date(`${o.date}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const since = yesterday.toISOString().slice(0, 10);
  const specs = [
    ['reddit', ['reddit', 'search', 'new browser game', '--sort', 'new', '--time', 'day', '--limit', String(o.limit), '-f', 'json']],
    ['youtube', ['youtube', 'search', 'new browser game', '--upload', 'today', '--sort', 'date', '--limit', String(o.limit), '-f', 'json']],
    ['x', ['twitter', 'search', `"browser game" since:${since}`, '--product', 'live', '--limit', String(o.limit), '-f', 'json']],
  ];
  const sources = [], rows = [], errors = [];
  for (const [source, argv] of specs) {
    const r = await runProcess('opencli', argv, o.root);
    if (!r.ok) { const error = `${source}: ${r.error}`; errors.push(error); sources.push({ source, kind: 'social-24h', status: 'failed', count: 0, error }); continue; }
    try {
      const items = socialRows(source, JSON.parse(r.stdout));
      rows.push(...items);
      sources.push({ source, kind: 'social-24h', status: 'collected', count: items.length });
    } catch (e) {
      const error = `${source}: 输出解析失败 ${e.message}`;
      errors.push(error); sources.push({ source, kind: 'social-24h', status: 'failed', count: 0, error });
    }
  }
  return { sources, candidates: mergeCampaigns(rows), errors };
}

async function radar(o) {
  const f = files(o);
  if (o.dryRun) return { ok: true, dryRun: true, sources: ['steam', 'itch', 'poki', ...(o.noSocial ? [] : ['reddit', 'youtube', 'x'])], file: f.radar };
  fs.mkdirSync(o.radarState, { recursive: true });
  const sources = [];
  const errors = [];
  for (const source of ['steam', 'itch', 'poki']) {
    const stateFile = path.join(o.radarState, `${source}.json`);
    const previous = readJson(stateFile, { seenKeys: [] });
    const seen = new Set(previous.seenKeys ?? []);
    const r = await runNode(NEW_TITLES, ['--source', source, '--count', String(o.limit), '--json'], o.root);
    if (!r.ok) { errors.push(`${source}: ${r.error}`); sources.push({ source, status: 'failed', count: 0, added: [], error: r.error }); continue; }
    let items;
    try { items = JSON.parse(r.stdout); }
    catch (e) { errors.push(`${source}: 输出解析失败 ${e.message}`); sources.push({ source, status: 'failed', count: 0, added: [], error: e.message }); continue; }
    const added = previous.seenKeys?.length ? items.filter((item) => !itemKeys(item).some((key) => seen.has(key))) : [];
    const nextKeys = uniq([...seen, ...items.flatMap(itemKeys)]);
    writeJson(stateFile, { source, updatedAt: new Date().toISOString(), seenKeys: nextKeys, items });
    sources.push({ source, status: previous.seenKeys?.length ? 'compared' : 'baseline_created', count: items.length, addedCount: added.length, added });
  }
  const coreErrors = [...errors];
  const social = await socialRadar(o);
  sources.push(...social.sources);
  errors.push(...social.errors);
  const candidates = [...sources.flatMap((s) => s.added ?? []), ...social.candidates];
  const report = { date: o.date, generatedAt: new Date().toISOString(), window: '24h-and-since-last-snapshot', sources, candidates, queue: candidates, coreErrors, errors };
  writeJson(f.radar, report);
  return { ok: !coreErrors.length, file: f.radar, errors, candidates: candidates.length };
}

function inputCandidates(data, origin) {
  if (!data) return [];
  const rows = [
    ...arr(data.candidates), ...arr(data.queue), ...arr(data.entities),
    ...arr(data.platforms).flatMap((p) => arr(p.added).map((v) => ({ ...v, platform: v.platform ?? p.name, languages: v.languages ?? p.languages, markets: v.markets ?? p.markets }))),
    ...arr(data.sources).flatMap((s) => arr(s.added).map((v) => ({ ...v, source: v.source ?? s.source }))),
  ];
  return rows.map((row) => {
    const urls = uniq([...arr(row.urls), row.url, row.link].filter(validUrl));
    const names = uniq([...arr(row.names), row.name, row.title, urls[0] ? slugName(urls[0]) : ''].filter(nonempty));
    const sourceLinks = uniq([...arr(row.sourceLinks), ...urls]);
    return {
      entityId: row.entityId ?? (normalizeName(names[0]).replace(/ /g, '-') || normalizeUrl(urls[0]).replace(/[^a-z0-9]+/g, '-')),
      names, urls, sourceLinks,
      playLinks: uniq([...arr(row.playLinks), row.playUrl, row.embed?.url].filter(validUrl)),
      evidenceLinks: uniq([...arr(row.evidenceLinks), ...sourceLinks]),
      platforms: uniq([...arr(row.platforms), row.platform, row.source]),
      languages: arr(row.languages), markets: arr(row.markets),
      firstSeen: row.firstSeen ?? data.generatedAt ?? data.date ?? null,
      pageType: row.pageType ?? row.kind ?? 'new-on-platform',
      reachable: row.reachable ?? null, playable: row.playable ?? arr(row.playLinks).length > 0,
      keywords: arr(row.keywords), trend: row.trend ?? {}, demandProof: row.demandProof ?? {},
      promotionRisk: row.promotionRisk ?? {}, reasons: arr(row.reasons),
      origin: uniq([...arr(row.origin), origin]),
      ...(row.decision ? { decision: row.decision } : {}),
      ...(row.action ? { action: row.action } : {}),
      ...(row.nextAction ? { nextAction: row.nextAction } : {}),
    };
  }).filter((row) => row.names.length || row.urls.length);
}

function sameCandidate(a, b) {
  const names = new Set(arr(a.names).map(normalizeName).filter(Boolean));
  const urls = new Set(arr(a.urls).map(normalizeUrl).filter(Boolean));
  return arr(b.names).some((v) => names.has(normalizeName(v))) || arr(b.urls).some((v) => urls.has(normalizeUrl(v)));
}

function mergeCandidates(rows) {
  const out = [];
  for (const row of rows) {
    const i = out.findIndex((v) => sameCandidate(v, row));
    if (i < 0) out.push(row); else out[i] = mergeMissing(out[i], row);
  }
  return out;
}

function mergeRichIntoOrdered(ordered, richerRows) {
  const out = [...ordered];
  for (const row of richerRows) {
    const i = out.findIndex((v) => sameCandidate(v, row));
    if (i < 0) out.push(row); else out[i] = mergeMissing(row, out[i]);
  }
  return out;
}

function isQuantified(c) {
  return arr(c.keywords).some((k) => ['semrushVolume', 'volume', 'localVolume', 'semrushGlobalVolume', 'globalVolume', 'semrushKd', 'webcafeKd', 'kd'].some((key) => nonempty(k?.[key])));
}

function rankCandidates(candidates, todayRows) {
  const rank = (c) => {
    const action = finishCandidate(c).action;
    if (isQuantified(c) && action === 'develop') return 0;
    if (c.demandCoverage?.globalChecked && isQuantified(c)) return 1;
    if (todayRows.some((v) => sameCandidate(v, c))) return 2;
    if (isQuantified(c) && action === 'research') return 3;
    if (c.carryForward?.recheckDue) return 4;
    return 5;
  };
  return candidates.map((c, i) => ({ c, i, rank: rank(c) })).sort((a, b) => a.rank - b.rank || a.i - b.i).map((v) => v.c);
}

function carryForward(latest, date) {
  if (!latest?.date || latest.date >= date) return [];
  return arr(latest.candidates).filter((c) => ['research', 'watch'].includes(finishCandidate(c).action)).map((c) => {
    const first = String(c.firstSeen ?? latest.date).slice(0, 10);
    const ageDays = Math.max(0, Math.round((new Date(`${date}T00:00:00Z`) - new Date(`${first}T00:00:00Z`)) / 86_400_000));
    return { ...c, firstSeen: c.firstSeen ?? latest.date, carryForward: { from: latest.date, ageDays, recheckDue: [3, 7, 14, 28].includes(ageDays) } };
  });
}

async function checkUrl(url) {
  if (!validUrl(url)) return { url, ok: false, status: null, error: 'URL 格式无效' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 GameOpportunityMonitor/1.0', Range: 'bytes=0-65535' } });
    const chunks = [];
    let size = 0;
    const reader = res.body?.getReader();
    while (reader && size < 65_536) {
      const { done, value } = await reader.read();
      if (done) break;
      const keep = value.subarray(0, 65_536 - size);
      chunks.push(keep); size += keep.length;
    }
    await reader?.cancel().catch(() => {});
    const html = Buffer.concat(chunks.map((v) => Buffer.from(v))).toString('utf8');
    const meta = pageMeta(html, res.url);
    const result = { url, ok: res.ok, status: res.status, finalUrl: res.url, ...meta };
    return result;
  } catch (e) { return { url, ok: false, status: null, error: e.name === 'AbortError' ? 'timeout' : e.message }; }
  finally { clearTimeout(timer); }
}

function keywordSignal(c) {
  const keywords = arr(c.keywords);
  const volume = Math.max(0, ...keywords.map((k) => Number(k.semrushVolume ?? k.volume ?? k.localVolume ?? 0) || 0));
  const globalVolume = Math.max(0, ...keywords.map((k) => Number(k.semrushGlobalVolume ?? k.globalVolume ?? 0) || 0));
  const top = keywords.map((k) => ({ row: k, volume: Number(k.semrushVolume ?? k.volume ?? k.localVolume ?? 0) || 0 })).sort((a, b) => b.volume - a.volume)[0]?.row;
  const topKd = [top?.semrushKd, top?.webcafeKd, top?.kd].filter(nonempty).map(Number).find(Number.isFinite);
  const kdValues = keywords.flatMap((k) => [k.semrushKd, k.webcafeKd, k.kd]).filter(nonempty).map(Number).filter(Number.isFinite);
  return { volume, globalVolume, kd: topKd ?? (kdValues.length ? Math.min(...kdValues) : null), trend: c.trend ?? {} };
}

function buildReadiness(c) {
  const k = keywordSignal(c);
  const intentValidated = c.demandProof?.intentValidated === true;
  const independentDemand = c.demandProof?.independentDemand === true || Number(c.promotionRisk?.independentPublishers ?? 0) >= 2;
  const checks = {
    playable: c.playable === true,
    volume: k.globalVolume >= 10_000 && k.volume >= 2_000,
    kd: k.kd !== null && k.kd <= 30,
    intentValidated,
    independentDemand,
  };
  return { ready: Object.values(checks).every(Boolean), checks };
}

function decide(c) {
  const explicit = c.action ?? ({ 'quick-ship': 'develop', 'priority-research': 'research', watch: 'watch', develop: 'develop', research: 'research' }[c.decision]);
  if (explicit === 'develop') return buildReadiness(c).ready ? 'develop' : 'research';
  if (['research', 'watch'].includes(explicit)) return explicit;
  const k = keywordSignal(c);
  if (buildReadiness(c).ready) return 'develop';
  if (c.reachable || c.playable || k.volume > 0 || k.globalVolume > 0 || arr(c.evidenceLinks).length > 1) return 'research';
  return 'watch';
}

function finishCandidate(c) {
  const urls = uniq(arr(c.urls).filter(validUrl));
  const sourceLinks = uniq([...arr(c.sourceLinks), ...urls].filter(validUrl));
  const playLinks = uniq([...arr(c.playLinks), c.playUrl, c.embed?.url].filter(validUrl));
  const evidenceLinks = uniq([...arr(c.evidenceLinks), ...sourceLinks].filter(validUrl));
  c = { ...c, urls, sourceLinks, playLinks, evidenceLinks };
  const action = decide(c);
  const decision = ({ develop: 'quick-ship', research: 'priority-research', watch: 'watch' })[action];
  const nextAction = c.nextAction ?? ({
    develop: '确认目标市场 SERP 与可玩供给后，直接建立网站开发任务。',
    research: '补查目标国家搜索量、KD、趋势与 SERP，再决定是否开发。',
    watch: '保留链接，等待下一次平台或搜索需求信号。',
  }[action]);
  return { ...c, action, decision, buildGate: buildReadiness(c), keywordMetrics: keywordSignal(c), trend: c.trend ?? {}, nextAction };
}

function staleReason(c) {
  const checks = arr(c.urlChecks);
  if (!checks.length || !checks.every((v) => v.status === 404 || v.status === 410)) return null;
  const playLinks = arr(c.playLinks);
  const hasUsablePlay = checks.some((v) => playLinks.includes(v.url) && v.ok);
  const hasUnverifiedPlay = playLinks.some((url) => !checks.some((v) => v.url === url));
  return !hasUsablePlay && !hasUnverifiedPlay ? '所有已响应 URL 均明确返回 404/410，且没有可用游戏链接' : null;
}

function overlayCandidates(current, overlay) {
  if (!overlay) return current;
  const rows = Array.isArray(overlay) ? overlay : arr(overlay.candidates);
  const out = [...current];
  for (const row of rows) {
    const normalized = inputCandidates({ candidates: [row] }, 'evaluation')[0] ?? row;
    const i = out.findIndex((v) => sameCandidate(v, normalized));
    if (i < 0) out.push(row); else out[i] = mergeMissing(row, out[i]);
  }
  return out;
}

const md = (v) => String(v ?? '').replace(/([|[\]])/g, '\\$1').replace(/\n/g, ' ');
const link = (label, url) => validUrl(url) ? `[${md(label)}](${url})` : md(label);
const metric = (c) => {
  const k = c.keywordMetrics ?? keywordSignal(c);
  const rows = arr(c.keywords).map((row) => ({ row, volume: Number(row.semrushVolume ?? row.volume ?? row.localVolume ?? 0) || 0 }));
  const top = rows.sort((a, b) => b.volume - a.volume)[0];
  const discovery = new Set(arr(c.discoveryMarkets).map((market) => String(market).toUpperCase()));
  const discoveryTop = rows.filter(({ row }) => discovery.has(String(row.market ?? row.gl ?? '').toUpperCase())).sort((a, b) => b.volume - a.volume)[0];
  const parts = [];
  if (k.globalVolume) parts.push(`全球 ${k.globalVolume.toLocaleString('en-US')}`);
  if (top?.volume) parts.push(`最高 ${String(top.row.market ?? top.row.gl).toUpperCase()} ${top.volume.toLocaleString('en-US')}`);
  if (discoveryTop?.volume && discoveryTop.row !== top?.row) parts.push(`发现市场 ${String(discoveryTop.row.market ?? discoveryTop.row.gl).toUpperCase()} ${discoveryTop.volume.toLocaleString('en-US')}`);
  if (k.kd !== null) parts.push(`KD ${k.kd}`);
  return parts.join('；') || '待查';
};

function renderMarkdown(report) {
  const labels = { develop: '建议开发', research: '继续调研', watch: '继续观察' };
  const lines = [`# 小游戏机会日报 · ${report.date}`, '', `共 ${report.candidates.length} 个候选：建议开发 ${report.stats.develop} 个，继续调研 ${report.stats.research} 个，继续观察 ${report.stats.watch} 个。`, '', `结论：${report.verdict.text}`, ''];
  for (const action of ACTIONS) {
    lines.push(`## ${labels[action]}`, '');
    const rows = report.candidates.filter((c) => c.action === action);
    if (!rows.length) { lines.push('本组暂无候选。', ''); continue; }
    lines.push('| 候选 | 来源 | 市场 / 搜索量 / KD | 可玩 | 下一步 |', '|---|---|---|---|---|');
    for (const c of rows) {
      const name = arr(c.names)[0] ?? c.name ?? '未命名游戏';
      const primary = arr(c.playLinks)[0] ?? arr(c.urls)[0] ?? arr(c.sourceLinks)[0];
      const sources = uniq([...arr(c.sourceLinks), ...arr(c.evidenceLinks), ...arr(c.urls)]).slice(0, 4);
      const sourceMd = sources.length ? sources.map((url, i) => link(`来源${i + 1}`, url)).join(' · ') : '无链接';
      const markets = arr(c.markets).join('/') || arr(c.keywords).map((k) => k.market).filter(Boolean).join('/') || '待定';
      lines.push(`| ${link(name, primary)} | ${sourceMd} | ${md(markets)}；${metric(c)} | ${c.playable ? '是' : '待确认'} | ${md(c.nextAction)} |`);
    }
    lines.push('');
  }
  if (report.errors.length) lines.push('## 本次异常', '', ...report.errors.map((e) => `- ${md(e)}`), '');
  lines.push(`机器可读清单：\`${report.date}-candidates.json\`。`);
  return `${lines.join('\n')}\n`;
}

function saveReport(o, candidates, errors = [], excluded = []) {
  const f = files(o);
  const done = candidates.map(finishCandidate);
  const stats = Object.fromEntries(ACTIONS.map((a) => [a, done.filter((c) => c.action === a).length]));
  const report = {
    date: o.date, generatedAt: new Date().toISOString(), errors: uniq(errors.filter(Boolean)),
    stats,
    verdict: stats.develop > 0
      ? { action: 'act', text: `有 ${stats.develop} 个候选达到开发门槛，进入建站决策。` }
      : { action: 'wait', text: '今天没有达到开发门槛的机会，静候下一轮。' },
    candidates: done, excluded: excluded.map(finishCandidate),
  };
  writeJson(f.candidates, report);
  const markdown = renderMarkdown(report);
  writeText(f.report, markdown);
  fs.copyFileSync(f.candidates, f.latestJson);
  fs.copyFileSync(f.report, f.latestMd);
  return { report, files: f };
}

const SOCIAL_PLATFORMS = new Set(['reddit', 'youtube', 'x']);
const cleanKeyword = (value) => String(value ?? '')
  .replace(/\s+(?:demo|play online|online game)$/i, '')
  .replace(/\s+/g, ' ').trim();
const usefulKeyword = (value) => {
  const v = cleanKeyword(value);
  return v.length >= 2 && v.length <= 80
    && !/^just a moment/i.test(v)
    && !/^reddit$/i.test(v)
    && !/^https?:/i.test(v)
    && !/\b(?:launch date trailer|looking for|need advice|until a new game comes out)\b/i.test(v);
};
const latinKeyword = (value) => /[a-z]/i.test(value) && !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(value);
const marketDbs = (candidate) => uniq([
  ...arr(candidate.markets),
  ...arr(candidate.keywords).flatMap((k) => [k.gl, k.market]),
]).flatMap((value) => String(value).toLowerCase().split(/[^a-z]+/)).filter((v) => /^[a-z]{2}$/.test(v));

function demandKeywords(candidate) {
  const existing = arr(candidate.keywords).map((k) => k.keyword);
  const names = [...existing, ...arr(candidate.names), candidate.name].map(cleanKeyword).filter(usefulKeyword);
  const seen = new Set();
  return names.filter((keyword) => {
    const key = normalizeName(keyword);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

function demandCandidate(candidate) {
  if (candidate.pageType === 'game-adjacent') return false;
  if (arr(candidate.platforms).some((p) => SOCIAL_PLATFORMS.has(String(p).toLowerCase()))) return false;
  return demandKeywords(candidate).length > 0 && arr(candidate.urls).some(validUrl);
}

function demandPriority(candidate) {
  const action = finishCandidate(candidate).action;
  if (action === 'develop') return 0;
  if (action === 'research' && isQuantified(candidate)) return 1;
  if (candidate.playable) return 2;
  if (arr(candidate.platforms).some((p) => /poki|itch/i.test(p))) return 3;
  if (arr(candidate.platforms).some((p) => /steam/i.test(p))) return 5;
  return 4;
}

function buildDemandPlan(o) {
  const f = files(o);
  const newGames = readJson(f.newGames);
  const latest = readJson(f.latestJson);
  const evaluation = readJson(f.evaluation);
  const pool = mergeCandidates([
    ...inputCandidates({ candidates: arr(evaluation?.candidates) }, 'verified-evaluation'),
    ...inputCandidates({ candidates: arr(latest?.candidates) }, 'previous-report'),
    ...inputCandidates({ candidates: arr(newGames?.games) }, 'new-games'),
  ]).filter(demandCandidate)
    .map((candidate, index) => ({ candidate, index, priority: demandPriority(candidate) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .slice(0, Math.min(o.limit, 6))
    .map((row) => row.candidate);
  const candidates = pool.map((candidate) => {
    const keywords = demandKeywords(candidate);
    return {
      entityId: candidate.entityId,
      names: candidate.names,
      urls: candidate.urls,
      sourceLinks: candidate.sourceLinks,
      evidenceLinks: candidate.evidenceLinks,
      playLinks: candidate.playLinks,
      platforms: candidate.platforms,
      languages: candidate.languages,
      markets: candidate.markets,
      playable: candidate.playable,
      reachable: candidate.reachable,
      action: candidate.action,
      decision: candidate.decision,
      nextAction: candidate.nextAction,
      discoveryMarkets: candidate.markets,
      keywords,
      latinKeywords: keywords.filter(latinKeyword),
      mandatoryCountryDbs: uniq(marketDbs(candidate)),
    };
  });
  const globalKeywords = uniq(candidates.flatMap((candidate) => candidate.keywords));
  const planData = {
    date: o.date,
    generatedAt: new Date().toISOString(),
    rule: '先查每个原名、英文名和已有本地名的 globalVolume/byCountry，再查主要国家、发现市场和英语大市场。',
    sourceFiles: { verifiedEvaluation: f.evaluation, newGames: f.newGames, previousReport: f.latestJson },
    candidates,
    globalKeywords,
  };
  if (!o.dryRun) {
    writeJson(f.demandPlan, planData);
    writeText(f.globalKeywords, globalKeywords.join('\n'));
  }
  return { ok: true, plan: planData, files: { plan: f.demandPlan, keywords: f.globalKeywords } };
}

function readJsonLines(file) {
  if (!exists(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function demandOverlay(o, planData, globalRows, countryRows) {
  const f = files(o);
  const globalByKeyword = new Map(globalRows.map((row) => [normalizeName(row.keyword), row]));
  const localByKey = new Map(countryRows.map((row) => [`${normalizeName(row.keyword)}:${row.db}`, row]));
  const candidates = planData.candidates.map((candidate) => ({
    entityId: candidate.entityId,
    names: candidate.names,
    urls: candidate.urls,
    sourceLinks: candidate.sourceLinks,
    evidenceLinks: candidate.evidenceLinks,
    playLinks: candidate.playLinks,
    platforms: candidate.platforms,
    languages: candidate.languages,
    markets: candidate.markets,
    playable: candidate.playable,
    reachable: candidate.reachable,
    action: candidate.action,
    decision: candidate.decision,
    nextAction: candidate.nextAction,
    discoveryMarkets: candidate.discoveryMarkets,
    demandCoverage: {
      globalChecked: true,
      keywordsChecked: candidate.keywords,
      countriesChecked: uniq(countryRows.filter((row) => candidate.keywords.some((kw) => normalizeName(kw) === normalizeName(row.keyword))).map((row) => row.db.toUpperCase())),
    },
    keywords: candidate.keywords.flatMap((keyword) => {
      const global = globalByKeyword.get(normalizeName(keyword)) ?? {};
      const dbs = uniq([
        ...candidate.mandatoryCountryDbs,
        ...Object.entries(global.byCountry ?? {}).filter(([, volume]) => Number(volume) > 0).map(([db]) => db.toLowerCase()),
      ]);
      return dbs.map((db) => {
        const local = localByKey.get(`${normalizeName(keyword)}:${db}`) ?? (db === 'us' ? global : {});
        return {
          keyword, market: db.toUpperCase(), gl: db,
          semrushVolume: local.volume ?? 0,
          semrushGlobalVolume: global.globalVolume ?? 0,
          semrushByCountry: global.byCountry ?? null,
          semrushKd: local.kd ?? null,
          cpc: local.cpc ?? null,
          competition: local.competition ?? null,
          intent: local.intent ?? global.intent ?? null,
          noData: local.noData ?? true,
          status: local.status ?? 'not-queried',
          queryTime: o.date,
          rawResultFiles: [f.globalSemrush, f.countrySemrush],
        };
      });
    }),
  }));
  return { date: o.date, generatedAt: new Date().toISOString(), candidates };
}

async function plan(o) {
  return buildDemandPlan(o);
}

async function demand(o) {
  const f = files(o);
  const planned = buildDemandPlan(o);
  if (!planned.plan.globalKeywords.length) return { ok: false, error: '没有可查询的真实游戏关键词' };
  if (o.dryRun) return { ok: true, dryRun: true, plan: planned.plan, outputs: [f.globalSemrush, f.demandResults] };
  let globalRows = readJsonLines(f.globalSemrush);
  const globalKeys = new Set(globalRows.filter((row) => row.status !== 'error').map((row) => normalizeName(row.keyword)));
  const canReuseGlobal = planned.plan.globalKeywords.every((keyword) => globalKeys.has(normalizeName(keyword)));
  if (!canReuseGlobal) {
    const globalRun = await runNode(SEMRUSH_KEYWORD, ['--kw-file', f.globalKeywords, '--db', 'us', '--out', f.globalSemrush], o.root);
    if (!globalRun.ok) return { ok: false, stage: 'global', error: globalRun.error, stderr: globalRun.stderr, plan: planned.plan };
    globalRows = readJsonLines(f.globalSemrush);
  }
  const countryKeywords = new Map();
  for (const candidate of planned.plan.candidates) {
    for (const keyword of candidate.keywords) {
      const global = globalRows.find((row) => normalizeName(row.keyword) === normalizeName(keyword));
      const dbs = uniq([
        ...candidate.mandatoryCountryDbs,
        ...Object.entries(global?.byCountry ?? {}).filter(([, volume]) => Number(volume) > 0).map(([db]) => db.toLowerCase()),
      ]).slice(0, 8);
      for (const db of dbs) {
        if (db === 'us') continue;
        if (!countryKeywords.has(db)) countryKeywords.set(db, new Set());
        countryKeywords.get(db).add(keyword);
      }
    }
  }
  const countryRows = globalRows.map((row) => ({ ...row, db: 'us' }));
  const countryPlan = Object.fromEntries([...countryKeywords].map(([db, words]) => [db, [...words]]));
  const cachedCountryRows = readJsonLines(f.countrySemrush);
  const cachedCountryKeys = new Set(cachedCountryRows.map((row) => `${row.db}:${normalizeName(row.keyword)}`));
  const canReuseCountries = Object.entries(countryPlan).every(([db, words]) => words.every((word) => cachedCountryKeys.has(`${db}:${normalizeName(word)}`)));
  let countries = { ok: true, count: 0, reused: canReuseCountries, plan: f.countryPlan, output: f.countrySemrush };
  for (const [db, words] of countryKeywords) {
    const input = path.join(o.reviewDir, `${o.date}-keywords-country-${db}.txt`);
    writeText(input, [...words].join('\n'));
  }
  if (Object.keys(countryPlan).length) {
    writeJson(f.countryPlan, countryPlan);
    if (canReuseCountries) {
      countryRows.push(...cachedCountryRows);
      countries.count = cachedCountryRows.length;
    } else {
      const run = await runNode(SEMRUSH_KEYWORD, ['--bulk-plan', f.countryPlan, '--out', f.countrySemrush], o.root);
      countries = { ...countries, ok: run.ok, error: run.error };
      if (run.ok) {
        const rows = readJsonLines(f.countrySemrush);
        countryRows.push(...rows);
        countries.count = rows.length;
      }
    }
  }
  const overlay = demandOverlay(o, planned.plan, globalRows, countryRows);
  writeJson(f.demandResults, overlay);
  return { ok: countries.ok, plan: planned.plan, global: { file: f.globalSemrush, count: globalRows.length, reused: canReuseGlobal }, countries, results: f.demandResults };
}

async function evaluate(o, inheritedErrors = []) {
  const f = files(o);
  if (o.dryRun) return { ok: true, dryRun: true, inputs: [f.discovery, f.radar, o.evaluation].filter(Boolean), outputs: [f.candidates, f.report, f.latestJson, f.latestMd] };
  const discovery = readJson(f.discovery);
  const radarData = readJson(f.radar);
  const old = readJson(f.candidates);
  const latest = readJson(f.latestJson);
  const errors = [...inheritedErrors];
  const fatalErrors = [...inheritedErrors];
  if (!discovery) { const e = `缺少 ${path.basename(f.discovery)}`; errors.push(e); fatalErrors.push(e); }
  if (!radarData) { const e = `缺少 ${path.basename(f.radar)}`; errors.push(e); fatalErrors.push(e); }
  const health = discoveryHealth(discovery);
  errors.push(...arr(discovery?.warnings), ...health.warnings, ...(health.usable > 0 ? [] : arr(discovery?.errors)), ...arr(radarData?.errors));
  if (discovery && health.usable === 0) fatalErrors.push(...arr(discovery.errors), ...health.warnings, 'discovery 没有可用平台结果');
  fatalErrors.push(...arr(radarData?.coreErrors));
  const newGames = readJson(f.newGames);
  const todayRows = (newGames?.games?.length
    ? mergeCandidates(inputCandidates({ candidates: newGames.games }, 'new-games'))
    : mergeCandidates([...inputCandidates(discovery, 'discovery'), ...inputCandidates(radarData, 'radar')]))
    .filter((candidate) => candidate.pageType !== 'game-adjacent' && !arr(candidate.platforms).some((p) => SOCIAL_PLATFORMS.has(String(p).toLowerCase())));
  let candidates = [...todayRows];
  if (old?.candidates?.length) candidates = mergeRichIntoOrdered(candidates, old.candidates.filter((row) => todayRows.some((today) => sameCandidate(today, row))));
  candidates = mergeRichIntoOrdered(candidates, carryForward(latest, o.date));
  const automaticDemand = readJson(f.demandResults);
  if (automaticDemand) candidates = overlayCandidates(candidates, automaticDemand);
  if (o.evaluation) {
    const overlay = readJson(o.evaluation);
    if (!overlay) errors.push(`无法读取 --evaluation ${o.evaluation}`);
    else candidates = overlayCandidates(candidates, overlay);
  }
  candidates = rankCandidates(candidates, todayRows).slice(0, o.limit);
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i] = finishCandidate(candidates[i]);
    const checks = [];
    const primary = arr(c.urls)[0] ?? arr(c.sourceLinks)[0] ?? arr(c.playLinks)[0];
    if (primary) checks.push(await checkUrl(primary));
    const first = checks[0];
    if (first?.title && (errorPageTitle(first.title) || challengePageTitle(first.title))) c.names = arr(c.names).filter((name) => normalizeName(name) !== normalizeName(first.title));
    if (first?.title && !errorPageTitle(first.title) && !challengePageTitle(first.title) && (noisyName(c) || normalizeName(arr(c.names)[0]) === normalizeName(first.title))) {
      const title = cleanPageTitle(first.title);
      if (title) c.names = uniq([title, ...arr(c.names)]);
    }
    if (first?.iframeUrl) c.playLinks = uniq([first.iframeUrl, ...arr(c.playLinks)]);
    const remaining = uniq([...arr(c.playLinks), ...arr(c.urls)]).filter((url) => url !== primary).slice(0, 3 - checks.length);
    for (const url of remaining) checks.push(await checkUrl(url));
    c.urlChecks = checks;
    if (checks.length) c.reachable = c.reachable === true || checks.some((v) => v.ok);
    if (arr(c.playLinks).length) c.playable = c.playable === true || checks.filter((v) => arr(c.playLinks).includes(v.url)).some((v) => v.ok);
  }
  const excluded = [];
  candidates = candidates.filter((c) => {
    if (arr(c.urlChecks).some((check) => challengePageTitle(check.title))) {
      excluded.push({ ...c, excludedReason: '页面返回 Cloudflare 验证页，保留原始线索但不进入今日候选' });
      return false;
    }
    const reason = staleReason(c);
    if (!reason) return true;
    excluded.push({ ...c, pageType: 'stale-url', excludedReason: reason, excludedLinks: uniq([...arr(c.urls), ...arr(c.playLinks)]) });
    return false;
  });
  const saved = saveReport(o, candidates, errors, excluded);
  return { ok: !uniq(fatalErrors.filter(Boolean)).length, ...saved };
}

function render(o) {
  const f = files(o);
  if (o.dryRun) return { ok: true, dryRun: true, input: o.evaluation ?? f.candidates, outputs: [f.report, f.latestJson, f.latestMd] };
  const current = readJson(f.candidates);
  const supplied = o.evaluation ? readJson(o.evaluation) : null;
  if (!current && !supplied) throw new Error(`没有可渲染的候选：${f.candidates}`);
  let candidates = arr(current?.candidates);
  if (supplied) candidates = overlayCandidates(candidates, supplied);
  return { ok: true, ...saveReport(o, candidates, arr(current?.errors), arr(current?.excluded)) };
}

function saveNewGames(o, discovery, radar) {
  const f = files(o);
  const discoveryRows = mergeCandidates(inputCandidates(discovery, 'discovery'));
  const radarTitles = arr(radar?.candidates).filter((row) => !row.campaignId);
  const radarRows = mergeCandidates(inputCandidates({ candidates: radarTitles }, 'radar'));
  const games = mergeCandidates([...radarRows, ...discoveryRows])
    .filter((candidate) => candidate.pageType !== 'game-adjacent')
    .map(finishCandidate);
  const discoveryUrls = uniq(arr(discovery?.candidates).map((row) => row.url).filter(validUrl)).length;
  const report = {
    date: o.date,
    generatedAt: new Date().toISOString(),
    sourceFiles: { discovery: f.discovery, radar: f.radar },
    stats: {
      discoveryUrls,
      radarTitleRecords: radarTitles.length,
      ignoredCampaigns: arr(radar?.candidates).filter((row) => row.campaignId).length,
      dedupedGames: games.length,
      duplicatesRemoved: discoveryUrls + radarTitles.length - games.length,
    },
    errors: uniq([...arr(discovery?.errors), ...arr(discovery?.warnings), ...arr(radar?.errors)]),
    games,
  };
  writeJson(f.newGames, report);
  fs.copyFileSync(f.newGames, f.latestNewGames);
  return { file: f.newGames, latestFile: f.latestNewGames, count: games.length, stats: report.stats };
}

function dedupe(o) {
  const f = files(o);
  if (o.dryRun) return { ok: true, dryRun: true, inputs: [f.discovery, f.radar], outputs: [f.newGames, f.latestNewGames] };
  const discovery = readJson(f.discovery);
  const radarData = readJson(f.radar);
  const missing = [!discovery && path.basename(f.discovery), !radarData && path.basename(f.radar)].filter(Boolean);
  if (missing.length) return { ok: false, error: `缺少 ${missing.join('、')}` };
  return { ok: true, ...saveNewGames(o, discovery, radarData) };
}

async function collect(o) {
  if (o.dryRun) return { ok: true, dryRun: true, stages: [await discover(o), await radar(o)], newGames: { file: files(o).newGames } };
  const stages = [];
  const d = await discover(o); stages.push({ stage: 'discover', ok: d.ok, error: d.error, file: d.file });
  const r = await radar(o); stages.push({ stage: 'radar', ok: r.ok, errors: r.errors, file: r.file });
  const merged = saveNewGames(o, readJson(files(o).discovery), readJson(files(o).radar));
  return { ok: stages.every((s) => s.ok), stages, newGames: merged };
}

async function daily(o) {
  if (o.dryRun) return { ok: true, dryRun: true, collect: await collect(o), demand: await demand(o), evaluate: await evaluate(o) };
  const gathered = await collect(o);
  const errors = gathered.stages.flatMap((s) => s.ok ? [] : [s.error, ...arr(s.errors)].filter(Boolean).map((e) => `${s.stage}: ${e}`));
  const demandResult = await demand(o);
  if (!demandResult.ok) errors.push(`demand: ${demandResult.error ?? demandResult.stage ?? '查询失败'}`);
  const result = await evaluate(o, errors);
  return { ok: gathered.ok && demandResult.ok && result.ok, collect: gathered, demand: demandResult, evaluate: result };
}

const checkItem = (id, text, passed, evidence) => ({ id, text, passed: Boolean(passed), evidence: String(evidence ?? '') });
const dated = (data, date) => String(data?.date ?? data?.generatedAt ?? '').startsWith(date);

function saveChecklist(o, kind, checks, summary = {}) {
  const f = files(o);
  const isCollect = kind === 'collect';
  const file = isCollect ? f.collectChecklist : f.decisionChecklist;
  const markdownFile = isCollect ? f.collectChecklistMd : f.decisionChecklistMd;
  const latestFile = isCollect ? f.latestCollectChecklist : f.latestDecisionChecklist;
  const latestMarkdown = isCollect ? f.latestCollectChecklistMd : f.latestDecisionChecklistMd;
  const result = { date: o.date, generatedAt: new Date().toISOString(), kind, ok: checks.every((item) => item.passed), checks, summary };
  const title = isCollect ? '小游戏每日采集 Checklist' : '小游戏每日决策 Checklist';
  const markdown = [`# ${title} · ${o.date}`, '', `状态：${result.ok ? '全部通过' : '未通过'}`, '', ...checks.flatMap((item) => [`- [${item.passed ? 'x' : ' '}] ${item.id} ${item.text}`, `  - ${item.evidence}`]), ''].join('\n');
  writeJson(file, result); writeText(markdownFile, markdown);
  fs.copyFileSync(file, latestFile); fs.copyFileSync(markdownFile, latestMarkdown);
  return { ...result, file, markdownFile, latestFile, latestMarkdown };
}

function inspectCollect(o) {
  const f = files(o);
  const discovery = readJson(f.discovery);
  const radarData = readJson(f.radar);
  const newGames = readJson(f.newGames);
  const config = readJson(discovery?.config ?? path.join(o.root, '.rankup/demand/game-platforms.json'));
  const platforms = arr(discovery?.platforms);
  const radarSources = arr(radarData?.sources);
  const games = arr(newGames?.games);
  const failedPlatforms = platforms.filter((row) => row.status === 'failed');
  const failedRadar = radarSources.filter((row) => row.status === 'failed');
  const gameKeys = games.map((game) => normalizeName(arr(game.names)[0] ?? game.name) || normalizeUrl(arr(game.urls)[0]));
  const expectedRadar = o.noSocial ? 3 : 6;
  const ignored = fs.readFileSync(path.join(o.root, '.gitignore'), 'utf8').split(/\r?\n/).some((line) => line.trim() === '.rankup/');
  const checks = [
    checkItem('C01', '平台配置已读取且本次覆盖全部配置平台。', arr(config?.platforms).length > 0 && Number(discovery?.selectedPlatforms) === arr(config?.platforms).length, `${discovery?.selectedPlatforms ?? 0}/${arr(config?.platforms).length} 个平台`),
    checkItem('C02', '每个平台都有 compared、baseline 或 failed 的明确结果。', platforms.length === Number(discovery?.selectedPlatforms) && platforms.every((row) => ['compared', 'baseline_created', 'failed'].includes(row.status)), `${platforms.length} 条平台结果`),
    checkItem('C03', '全部 sitemap 抓取成功且没有平台失败。', failedPlatforms.length === 0, failedPlatforms.length ? failedPlatforms.map((row) => row.id).join('、') : '0 个失败'),
    checkItem('C04', '每个平台都分别记录 added、changed 和 removed。', platforms.filter((row) => row.status !== 'failed').every((row) => ['added', 'changed', 'removed'].every((key) => Array.isArray(row[key]))), '三类 diff 字段已核对'),
    checkItem('C05', 'Steam、itch、Poki 与启用的社区雷达全部执行成功。', radarSources.length >= expectedRadar && failedRadar.length === 0, `${radarSources.length} 个来源，失败 ${failedRadar.length}`),
    checkItem('C06', 'discovery、radar 与 new-games 均属于当天。', [discovery, radarData, newGames].every((data) => dated(data, o.date)), o.date),
    checkItem('C07', 'discovery 与 radar 已合并且统计数量和实体数量一致。', Number(newGames?.stats?.dedupedGames) === games.length && Number(newGames?.stats?.duplicatesRemoved) >= 0, `${games.length} 个去重游戏`),
    checkItem('C08', '社交 campaign 与非游戏记录没有混入新增游戏。', games.every((game) => !game.campaignId && game.pageType !== 'game-adjacent'), `${newGames?.stats?.ignoredCampaigns ?? 0} 个 campaign 已隔离`),
    checkItem('C09', '新增游戏按名称或 URL 去重且没有重复实体。', gameKeys.every(Boolean) && new Set(gameKeys).size === gameKeys.length, `${new Set(gameKeys).size}/${games.length} 个唯一实体`),
    checkItem('C10', '采集产物、名称、来源链接和 Git 忽略边界全部完整。', [f.discovery, f.radar, f.newGames, f.latestNewGames].every(exists) && games.every((game) => arr(game.names).length && [...arr(game.sourceLinks), ...arr(game.urls)].some(validUrl)) && ignored, '4 个产物与 .rankup/ 忽略规则已核对'),
  ];
  return saveChecklist(o, 'collect', checks, { platforms: platforms.length, games: games.length, failedPlatforms: failedPlatforms.map((row) => row.id), failedRadar: failedRadar.map((row) => row.source) });
}

async function collectChecklist(o) {
  if (!o.checkOnly) await collect(o);
  return inspectCollect(o);
}

function inspectDecision(o) {
  const f = files(o);
  const collectResult = readJson(f.collectChecklist);
  const planData = readJson(f.demandPlan);
  const globalRows = readJsonLines(f.globalSemrush);
  const countryPlan = readJson(f.countryPlan, {});
  const countryRows = readJsonLines(f.countrySemrush);
  const demandData = readJson(f.demandResults);
  const report = readJson(f.candidates);
  const latest = readJson(f.latestJson);
  const markdown = exists(f.report) ? fs.readFileSync(f.report, 'utf8') : '';
  const globalKeys = new Set(globalRows.filter((row) => row.status !== 'error').map((row) => normalizeName(row.keyword)));
  const countryKeys = new Set(countryRows.map((row) => `${String(row.db).toLowerCase()}:${normalizeName(row.keyword)}`));
  const priority = arr(planData?.candidates);
  const finalPriority = priority.map((candidate) => arr(report?.candidates).find((row) => row.entityId === candidate.entityId || sameCandidate(row, candidate))).filter(Boolean);
  const plannedCountryRows = Object.entries(countryPlan).flatMap(([db, words]) => arr(words).map((word) => `${db}:${normalizeName(word)}`));
  const stats = report?.stats ?? {};
  const statsMatch = ACTIONS.every((action) => Number(stats[action] ?? 0) === arr(report?.candidates).filter((row) => row.action === action).length);
  const latestMatch = JSON.stringify(latest?.stats) === JSON.stringify(report?.stats) && arr(latest?.candidates).map((row) => row.entityId).join('|') === arr(report?.candidates).map((row) => row.entityId).join('|');
  const checks = [
    checkItem('D01', '当天采集 Checklist 已全部通过。', collectResult?.ok === true && collectResult?.date === o.date, collectResult?.ok ? '采集通过' : '采集未通过或缺失'),
    checkItem('D02', '已按优先级选出不超过 6 个真实游戏进入深查。', priority.length > 0 && priority.length <= 6 && priority.every((row) => row.entityId && arr(row.urls).some(validUrl)), `${priority.length} 个深查游戏`),
    checkItem('D03', '每个深查游戏都有 1–3 个去重后的原名、英文名或本地名关键词。', priority.every((row) => arr(row.keywords).length >= 1 && arr(row.keywords).length <= 3 && new Set(arr(row.keywords).map(normalizeName)).size === arr(row.keywords).length && (!arr(row.names).some(latinKeyword) || arr(row.latinKeywords).length > 0)), `${arr(planData?.globalKeywords).length} 个全球关键词`),
    checkItem('D04', '每个计划关键词都有全球量与主要国家结果或明确无数据状态。', arr(planData?.globalKeywords).length > 0 && arr(planData?.globalKeywords).every((word) => globalKeys.has(normalizeName(word))), `${globalRows.length}/${arr(planData?.globalKeywords).length} 条全球结果`),
    checkItem('D05', '国家计划已在同一批次取完且没有缺少国家关键词组合。', plannedCountryRows.every((key) => countryKeys.has(key)), `${countryRows.length}/${plannedCountryRows.length} 条国家结果`),
    checkItem('D06', '每个深查游戏都记录已查关键词、国家和 demandCoverage。', arr(demandData?.candidates).length === priority.length && arr(demandData?.candidates).every((row) => row.demandCoverage?.globalChecked && arr(row.demandCoverage?.keywordsChecked).length && arr(row.demandCoverage?.countriesChecked).length), `${arr(demandData?.candidates).length} 个需求结果`),
    checkItem('D07', '每个深查游戏都完成页面可达性与可玩供给核对。', finalPriority.length === priority.length && finalPriority.every((row) => arr(row.urlChecks).length > 0 && typeof row.reachable === 'boolean' && typeof row.playable === 'boolean'), `${finalPriority.length}/${priority.length} 个页面已核对`),
    checkItem('D08', '所有建议开发候选都通过流量、KD、意图、独立需求和可玩性硬门槛。', arr(report?.candidates).filter((row) => row.action === 'develop').every((row) => row.buildGate?.ready === true), `${stats.develop ?? 0} 个达到开发门槛`),
    checkItem('D09', '最终结论与建议开发数量一致并允许明确选择静候。', report?.verdict?.action === (Number(stats.develop ?? 0) > 0 ? 'act' : 'wait') && Boolean(report?.verdict?.text), report?.verdict?.text ?? '缺少结论'),
    checkItem('D10', 'JSON、Markdown、latest、分组数量、链接和异常信息彼此一致。', statsMatch && latestMatch && markdown.includes(report?.verdict?.text ?? '') && arr(report?.candidates).every((row) => [...arr(row.sourceLinks), ...arr(row.urls)].some(validUrl)) && (!arr(report?.errors).length || markdown.includes('本次异常')), `${arr(report?.candidates).length} 个候选，异常 ${arr(report?.errors).length}`),
  ];
  return saveChecklist(o, 'decision', checks, { verdict: report?.verdict, stats, priority: priority.length, errors: arr(report?.errors) });
}

async function decisionChecklist(o) {
  if (!o.checkOnly) {
    const demandResult = await demand(o);
    await evaluate(o, demandResult.ok ? [] : [`demand: ${demandResult.error ?? demandResult.stage ?? '查询失败'}`]);
  }
  return inspectDecision(o);
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'game-opportunity-'));
  try {
    const o = parseArgs(['render', '--date', '2099-01-02', '--project-root', tmp]);
    const merged = mergeCandidates([
      { names: ['Foo Game'], urls: ['https://example.com/foo'], keywords: [{ keyword: 'foo', semrushVolume: 5000, semrushGlobalVolume: 12000, semrushKd: 22 }], playable: true, demandProof: { intentValidated: true, independentDemand: true } },
      { names: ['foo-game'], urls: ['https://example.com/foo/'], evidenceLinks: ['https://reddit.com/r/games/foo'] },
    ]);
    if (merged.length !== 1 || decide(merged[0]) !== 'develop') throw new Error('实体合并或分组失败');
    if (decide({ names: ['Small Game'], urls: ['https://example.com/small'], action: 'develop', playable: true, keywords: [{ semrushVolume: 4400, semrushGlobalVolume: 4400, semrushKd: 35 }] }) !== 'research') throw new Error('严格开发门槛失败');
    const carried = mergeRichIntoOrdered(
      [{ names: ['New Game'], urls: ['https://example.com/new'] }],
      carryForward({ date: '2099-01-01', candidates: [{ names: ['Old Game'], firstSeen: '2098-12-30', sourceLinks: ['https://example.com/old'], action: 'research' }] }, o.date),
    );
    if (carried[0].names[0] !== 'New Game' || carried[1].firstSeen !== '2098-12-30' || carried[1].sourceLinks[0] !== 'https://example.com/old' || carried[1].carryForward.recheckDue !== true) throw new Error('旧候选续查或新词顺序失败');
    const campaigns = mergeCampaigns([
      { source: 'reddit', title: 'Try My Browser Game', author: 'same-maker', url: 'https://reddit.com/r/games/1' },
      { source: 'youtube', title: 'Browser Game Trailer', author: 'same-maker', url: 'https://youtube.com/watch?v=1' },
    ]);
    if (campaigns.length !== 1 || campaigns[0].mentions !== 2) throw new Error('campaign 去重失败');
    const fresh = { names: ['Fresh Game'], urls: ['https://example.com/fresh'] };
    const ranked = rankCandidates([
      { names: ['Old Watch'], urls: ['https://example.com/watch'], action: 'watch' },
      fresh,
      { names: ['Verified Winner'], urls: ['https://example.com/winner'], action: 'develop', playable: true, demandProof: { intentValidated: true, independentDemand: true }, keywords: [{ semrushVolume: 5000, semrushGlobalVolume: 12000, semrushKd: 20 }] },
    ], [fresh]);
    if (ranked.map((v) => v.names[0]).join('|') !== 'Verified Winner|Fresh Game|Old Watch') throw new Error('候选优先级排序失败');
    const partial = discoveryHealth({ compared: 45, baselineCreated: 0, platforms: [{ id: 'bad-a', status: 'failed', error: 'timeout' }] });
    if (partial.usable !== 45 || !partial.partial || !partial.warnings[0].includes('bad-a')) throw new Error('部分 discovery 判定失败');
    if (!staleReason({ urlChecks: [{ url: 'https://example.com/gone', status: 404, ok: false }], playLinks: [] })) throw new Error('明确 404 未排除');
    if (staleReason({ urlChecks: [{ url: 'https://example.com/slow', status: null, ok: false, error: 'timeout' }], playLinks: [] })) throw new Error('timeout 被错误排除');
    if (!errorPageTitle('404 Not Found')) throw new Error('404 title 判定失败');
    const meta = pageMeta('<title>Cute Mahjong Connect - Play Free</title><iframe src="../play/index.html"></iframe>', 'https://games.example/catalog/item/');
    if (cleanPageTitle(meta.title) !== 'Cute Mahjong Connect' || meta.iframeUrl !== 'https://games.example/catalog/play/index.html') throw new Error('title 清洗或 iframe 相对地址解析失败');
    if (cleanPageTitle('スネークデュエル｜対戦バトル｜無料ゲームならワウゲーム') !== 'スネークデュエル') throw new Error('全角站点后缀清洗失败');
    saveReport(o, merged, []);
    const f = files(o);
    const checklist = saveChecklist(o, 'collect', [checkItem('C01', '测试检查。', true, 'ok')]);
    if (!checklist.ok || !exists(f.collectChecklistMd) || !fs.readFileSync(f.collectChecklistMd, 'utf8').includes('- [x] C01')) throw new Error('Checklist 产物失败');
    const newGames = saveNewGames(o,
      { date: o.date, candidates: [{ url: 'https://example.com/foo' }] },
      { date: o.date, candidates: [
        { source: 'steam', name: 'Foo', url: 'https://store.steampowered.com/app/1/Foo/' },
        { campaignId: 'campaign-001', name: 'Foo campaign', urls: ['https://reddit.com/r/games/1'] },
      ] },
    );
    if (newGames.count !== 1 || newGames.stats.ignoredCampaigns !== 1 || !exists(f.newGames) || !exists(f.latestNewGames)) throw new Error('新增游戏去重失败');
    writeJson(f.newGames, { games: Array.from({ length: 7 }, (_, i) => ({ names: [`New Game ${i}`], urls: [`https://example.com/new-${i}`] })) });
    const demandPlan = buildDemandPlan(o).plan;
    if (demandPlan.candidates.length !== 6 || !demandPlan.globalKeywords.includes('foo') || !demandPlan.candidates[0].latinKeywords.includes('Foo Game')) throw new Error('全球优先关键词计划失败');
    if (!challengePageTitle('Just a moment...')) throw new Error('Cloudflare 验证页过滤失败');
    if (![f.candidates, f.report, f.latestJson, f.latestMd].every(exists)) throw new Error('报告产物不完整');
    if (!fs.readFileSync(f.report, 'utf8').includes('[Foo Game](https://example.com/foo)')) throw new Error('Markdown 链接缺失');
    return { ok: true, checks: ['normalize-and-merge', 'decision', 'strict-build-gate', 'checklist-output', 'carry-forward-order', 'candidate-priority', 'partial-discovery', 'stale-vs-timeout', 'title-and-iframe', 'campaign-dedupe', 'new-games-dedupe', 'global-demand-plan', 'challenge-filter', 'markdown-links', 'stable-latest'] };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return; }
  if (o.selfTest) { console.log(JSON.stringify(selfTest(), null, 2)); return; }
  if (!['discover', 'radar', 'collect', 'collect-checklist', 'dedupe', 'plan', 'demand', 'evaluate', 'decision-checklist', 'render', 'daily'].includes(o.command)) {
    console.log(HELP); process.exitCode = 2; return;
  }
  const result = await ({ discover, radar, collect, 'collect-checklist': collectChecklist, dedupe, plan, demand, evaluate, 'decision-checklist': decisionChecklist, render, daily })[o.command](o);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((e) => { console.error(`错误：${e.message}`); process.exit(1); });
