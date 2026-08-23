#!/usr/bin/env node
/**
 * chrome-ext-gap.mjs —— Chrome Web Store 需求缺口挖掘
 *
 * 用途：
 *   从 Chrome Web Store 的分类页 / 搜索页批量取扩展的 **用户数 + 评分 + 评分人数**，
 *   筛出「用户很多但评分不高」的组合（市场已验证 + 现有执行差 = 机会），
 *   再顺手把这些扩展的**低星评论原文**拉下来，直接读出用户在骂什么、缺什么功能。
 *   评论里的 "doesn't work with X" / "please add Y" / "stopped working" 就是可做的关键词与需求。
 *
 * 示例命令：
 *   node chrome-ext-gap.mjs --list-categories
 *   node chrome-ext-gap.mjs --category productivity/workflow --min-users 100000 --max-rating 4.3
 *   node chrome-ext-gap.mjs --search "<keyword>" --reviews 10 --max-stars 3
 *   node chrome-ext-gap.mjs --category lifestyle/shopping --reviews 10 --json --out out.json
 *   node chrome-ext-gap.mjs --detail <extensionId> --reviews 10
 *
 * 依赖：无。纯公开 HTTP，**不需要 token、不需要登录态**。
 *
 * 已验证日期：2026-08-23
 *
 * 已知坑：
 *   - 数据来自页面里的 `AF_initDataCallback({key:'ds:N', data:[...]})` 内联 JSON。
 *     字段是**位置数组**，没有名字；Google 改版会位移。本脚本用「结构指纹」定位记录
 *     （[0] 是 32 位 a-p 扩展 ID、[2] 是字符串名、[3] 是浮点评分），比写死路径耐改版，
 *     但 users/rating 的下标（14 / 3 / 4）仍可能变，出数明显异常时先跑 --raw 看一眼。
 *   - 分类页一次只给 32 条，搜索页一次只给 10 条，没有公开的翻页参数
 *     （深翻页要走 batchexecute RPC + token，未实现）。想扩大样本就多跑几个分类。
 *   - 评论页一次只给 **10 条最新评论**，且带一个下一页 token（同样要 batchexecute，未实现）。
 *     10 条最新评论对「最近坏了什么 / 最近在要什么」已经够用，但不是全量。
 *   - 评论是按时间倒序，不是按低星排序；--max-stars 是在这 10 条里过滤，
 *     所以低星评论可能一条都没有，属正常。
 *   - users 是 Google 自己四舍五入过的（10,000+ / 60,000,000），不是精确值。
 *   - 请求节流：默认每次请求间隔 700ms。加大 --reviews 覆盖面时不要把 --sleep 调到 0。
 */

import { writeFileSync } from 'node:fs';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const HELP = `chrome-ext-gap.mjs — Chrome Web Store 用户多/评分低 缺口挖掘 + 差评抓取

用法:
  node chrome-ext-gap.mjs --category <cat> [选项]
  node chrome-ext-gap.mjs --search <query> [选项]
  node chrome-ext-gap.mjs --detail <extensionId> [选项]
  node chrome-ext-gap.mjs --list-categories

来源选择 (三选一):
  --category <cat>     分类路径，如 productivity/workflow。可逗号分隔或重复传入
  --search <query>     商店搜索词。可逗号分隔或重复传入
  --detail <id>        单个扩展 ID (32 位 a-p)。可逗号分隔或重复传入

筛选:
  --min-users <n>      最少用户数            (默认 100000)
  --max-users <n>      最多用户数            (默认 不限)
  --min-rating <x>     最低评分              (默认 0)
  --max-rating <x>     最高评分              (默认 5，缺口挖掘建议 4.3)
  --min-ratings <n>    最少评分人数          (默认 0)
  --no-filter          忽略以上全部筛选，输出全量

评论:
  --reviews <n>        对每个通过筛选的扩展抓最近 n 条评论 (0=不抓, 上限 10, 默认 0)
  --max-stars <n>      只保留 <= n 星的评论   (默认 5，即不过滤；挖痛点用 3)
  --review-lang <lc>   评论/页面语言 hl 参数  (默认 en)

输出:
  --json               输出 JSON 数组
  --jsonl              输出 JSON Lines
  --out <file>         落盘 (按 --jsonl 决定 JSONL 还是 JSON)
  --limit <n>          最多输出 n 条          (默认 不限)
  --raw                连同原始位置数组一起输出 (排查改版用)

其它:
  --sleep <ms>         请求间隔               (默认 700)
  --gl <cc>            国家/地区参数          (默认 US)
  -h, --help           显示本帮助

输出字段: {source, name, url, domain, users, rating, ratingCount, date, extra}
  extra: {id, category, summary, ratingLabel, reviews:[{stars, text, author, date}]}
`;

// ---------- args ----------
function parseArgs(argv) {
  const o = {
    category: [], search: [], detail: [],
    minUsers: 100000, maxUsers: Infinity,
    minRating: 0, maxRating: 5, minRatings: 0,
    noFilter: false, reviews: 0, maxStars: 5, reviewLang: 'en',
    json: false, jsonl: false, out: null, limit: Infinity,
    raw: false, sleep: 700, gl: 'US',
    listCategories: false, help: false,
  };
  const multi = (v, arr) => { for (const p of String(v).split(',')) { const t = p.trim(); if (t) arr.push(t); } };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '--list-categories': o.listCategories = true; break;
      case '--category': multi(next(), o.category); break;
      case '--search': multi(next(), o.search); break;
      case '--detail': multi(next(), o.detail); break;
      case '--min-users': o.minUsers = Number(next()); break;
      case '--max-users': o.maxUsers = Number(next()); break;
      case '--min-rating': o.minRating = Number(next()); break;
      case '--max-rating': o.maxRating = Number(next()); break;
      case '--min-ratings': o.minRatings = Number(next()); break;
      case '--no-filter': o.noFilter = true; break;
      case '--reviews': o.reviews = Math.min(10, Number(next())); break;
      case '--max-stars': o.maxStars = Number(next()); break;
      case '--review-lang': o.reviewLang = next(); break;
      case '--json': o.json = true; break;
      case '--jsonl': o.jsonl = true; break;
      case '--out': o.out = next(); break;
      case '--limit': o.limit = Number(next()); break;
      case '--raw': o.raw = true; break;
      case '--sleep': o.sleep = Number(next()); break;
      case '--gl': o.gl = next(); break;
      default:
        if (a.startsWith('-')) { console.error(`未知参数: ${a}\n`); console.error(HELP); process.exit(2); }
    }
  }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.text();
}

// ---------- 内联 JSON 提取 ----------
// 页面里形如: AF_initDataCallback({key: 'ds:0', hash: '..', data:[...], sideChannel: {}});
function extractDataBlobs(html) {
  const out = [];
  const re = /AF_initDataCallback\((\{key:\s*'ds:\d+'[\s\S]*?)\);<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const body = m[1];
    const d = /data:(\[[\s\S]*\]), sideChannel/.exec(body);
    if (!d) continue;
    try { out.push(JSON.parse(d[1])); } catch { /* 忽略解析不了的块 */ }
  }
  return out;
}

function walk(node, visit) {
  if (!Array.isArray(node)) return;
  visit(node);
  for (const c of node) if (Array.isArray(c)) walk(c, visit);
}

const EXT_ID = /^[a-p]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// 扩展记录指纹: [0]=extId, [2]=name(string), [3]=rating(number), [4]=ratingCount(number)
function looksLikeExtRecord(a) {
  return a.length >= 15
    && typeof a[0] === 'string' && EXT_ID.test(a[0])
    && typeof a[2] === 'string' && a[2].length > 0
    && typeof a[3] === 'number'
    && typeof a[4] === 'number';
}

// 评论记录指纹: [0]=uuid, [1]=[作者,头像], [2]=星级(1-5), [3]=正文
function looksLikeReview(a) {
  return a.length >= 6
    && typeof a[0] === 'string' && UUID.test(a[0])
    && Array.isArray(a[1])
    && typeof a[2] === 'number' && a[2] >= 1 && a[2] <= 5
    && typeof a[3] === 'string';
}

function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; }
}

function tsOf(v) {
  // [秒, 纳秒] 形式的时间戳
  if (Array.isArray(v) && typeof v[0] === 'number' && v[0] > 1e9 && v[0] < 4e9) {
    return new Date(v[0] * 1000).toISOString().slice(0, 10);
  }
  return null;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'x';
}

function toRecord(a, opts) {
  const id = a[0];
  const name = a[2];
  const rating = typeof a[3] === 'number' ? Math.round(a[3] * 100) / 100 : null;
  const ratingCount = a[4] ?? null;
  const summary = typeof a[6] === 'string' ? a[6] : null;
  const website = typeof a[7] === 'string' && /^https?:/.test(a[7]) ? a[7] : null;
  // 分类是形如 ["productivity/workflow", null, 4] 的数组，用它定位 users
  let catIdx = a.findIndex((x) => Array.isArray(x) && typeof x[0] === 'string' && /^[a-z_]+\/[a-z_]+$/.test(x[0]));
  const category = catIdx >= 0 ? a[catIdx][0] : null;
  let users = null;
  if (catIdx >= 0 && typeof a[catIdx + 3] === 'number') users = a[catIdx + 3];
  else if (typeof a[14] === 'number') users = a[14];
  let date = null;
  for (const v of a) { const d = tsOf(v); if (d) { date = d; break; } }
  const rec = {
    source: 'chrome-web-store',
    name,
    url: `https://chromewebstore.google.com/detail/${slugify(name)}/${id}`,
    domain: domainOf(website),
    users,
    rating,
    ratingCount,
    date,
    extra: { id, category, summary, website, reviews: [] },
  };
  if (opts.raw) rec.extra.raw = a;
  return rec;
}

function harvestExtensions(html, opts) {
  const seen = new Map();
  for (const blob of extractDataBlobs(html)) {
    walk(blob, (a) => {
      if (!looksLikeExtRecord(a)) return;
      const r = toRecord(a, opts);
      const prev = seen.get(r.extra.id);
      // 同一 id 可能出现多次，保留信息更全的那条
      if (!prev || (r.users != null && prev.users == null)) seen.set(r.extra.id, r);
    });
  }
  return [...seen.values()];
}

function harvestCategories(html) {
  const out = new Set();
  for (const blob of extractDataBlobs(html)) {
    walk(blob, (a) => {
      for (const v of a) {
        if (typeof v === 'string' && /^[a-z_]+\/[a-z_]+$/.test(v)) out.add(v);
      }
    });
  }
  return [...out].sort();
}

function harvestReviews(html, opts) {
  const out = [];
  const seen = new Set();
  for (const blob of extractDataBlobs(html)) {
    walk(blob, (a) => {
      if (!looksLikeReview(a) || seen.has(a[0])) return;
      seen.add(a[0]);
      out.push({
        stars: a[2],
        text: a[3],
        author: Array.isArray(a[1]) && typeof a[1][0] === 'string' ? a[1][0] : null,
        date: tsOf(a[4]),
        version: typeof a[12] === 'string' ? a[12] : null,
      });
    });
  }
  return out
    .filter((r) => r.stars <= opts.maxStars && r.text.trim())
    .slice(0, opts.reviews);
}

// ---------- 抓取 ----------
async function fetchCategory(cat, opts) {
  const u = `https://chromewebstore.google.com/category/extensions/${cat}?hl=${encodeURIComponent(opts.reviewLang)}&gl=${encodeURIComponent(opts.gl)}`;
  return harvestExtensions(await get(u), opts);
}
async function fetchSearch(q, opts) {
  const u = `https://chromewebstore.google.com/search/${encodeURIComponent(q)}?hl=${encodeURIComponent(opts.reviewLang)}&gl=${encodeURIComponent(opts.gl)}`;
  return harvestExtensions(await get(u), opts);
}
async function fetchDetail(id, opts) {
  const u = `https://chromewebstore.google.com/detail/x/${id}?hl=${encodeURIComponent(opts.reviewLang)}&gl=${encodeURIComponent(opts.gl)}`;
  return harvestExtensions(await get(u), opts).filter((r) => r.extra.id === id);
}
async function fetchReviews(id, opts) {
  const u = `https://chromewebstore.google.com/detail/x/${id}/reviews?hl=${encodeURIComponent(opts.reviewLang)}&gl=${encodeURIComponent(opts.gl)}`;
  return harvestReviews(await get(u), opts);
}

function fmtNum(n) {
  if (n == null) return '-';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(n);
}

function printTable(rows) {
  if (!rows.length) { console.log('(无结果)'); return; }
  const head = ['users', 'rating', '#rat', 'name', 'category', 'url'];
  const body = rows.map((r) => [
    fmtNum(r.users), r.rating == null ? '-' : r.rating.toFixed(2),
    fmtNum(r.ratingCount), r.name.slice(0, 44),
    r.extra.category || '-', r.url,
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (c) => c.map((v, i) => (i >= 4 ? v : v.padStart(w[i]))).join('  ');
  console.log(line(head));
  console.log(w.map((n) => '-'.repeat(n)).join('  '));
  for (const b of body) console.log(line(b));
  for (const r of rows) {
    if (!r.extra.reviews?.length) continue;
    console.log(`\n  ▼ ${r.name} — ${r.extra.reviews.length} 条评论`);
    for (const rv of r.extra.reviews) {
      const t = rv.text.replace(/\s+/g, ' ').slice(0, 220);
      console.log(`    ${'★'.repeat(rv.stars)}${'☆'.repeat(5 - rv.stars)} [${rv.date || '?'}] ${t}`);
    }
  }
  console.log(`\n共 ${rows.length} 条`);
}

// ---------- main ----------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return; }

  if (opts.listCategories) {
    // 任意一个分类页都会内联全站分类表
    const html = await get('https://chromewebstore.google.com/category/extensions/productivity/workflow');
    const cats = harvestCategories(html);
    if (opts.json) console.log(JSON.stringify(cats, null, 2));
    else cats.forEach((c) => console.log(c));
    return;
  }

  if (!opts.category.length && !opts.search.length && !opts.detail.length) {
    console.error('需要 --category / --search / --detail 之一。--help 看用法。');
    process.exit(2);
  }

  let rows = [];
  const seen = new Set();
  const push = (list) => { for (const r of list) if (!seen.has(r.extra.id)) { seen.add(r.extra.id); rows.push(r); } };

  for (const c of opts.category) {
    try { push(await fetchCategory(c, opts)); }
    catch (e) { console.error(`[warn] category ${c}: ${e.message}`); }
    await sleep(opts.sleep);
  }
  for (const q of opts.search) {
    try { push(await fetchSearch(q, opts)); }
    catch (e) { console.error(`[warn] search ${q}: ${e.message}`); }
    await sleep(opts.sleep);
  }
  for (const id of opts.detail) {
    try { push(await fetchDetail(id, opts)); }
    catch (e) { console.error(`[warn] detail ${id}: ${e.message}`); }
    await sleep(opts.sleep);
  }

  if (!opts.noFilter) {
    rows = rows.filter((r) =>
      (r.users ?? 0) >= opts.minUsers &&
      (r.users ?? 0) <= opts.maxUsers &&
      (r.rating ?? 0) >= opts.minRating &&
      (r.rating ?? 0) <= opts.maxRating &&
      (r.ratingCount ?? 0) >= opts.minRatings);
  }
  // 用户多的排前面（机会体量优先）
  rows.sort((a, b) => (b.users ?? 0) - (a.users ?? 0));
  if (Number.isFinite(opts.limit)) rows = rows.slice(0, opts.limit);

  if (opts.reviews > 0) {
    for (const r of rows) {
      try { r.extra.reviews = await fetchReviews(r.extra.id, opts); }
      catch (e) { console.error(`[warn] reviews ${r.extra.id}: ${e.message}`); }
      await sleep(opts.sleep);
    }
  }

  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n');
  if (opts.out) {
    writeFileSync(opts.out, opts.jsonl ? jsonl + '\n' : JSON.stringify(rows, null, 2));
    console.error(`已写入 ${opts.out} (${rows.length} 条)`);
  }
  if (opts.jsonl) console.log(jsonl);
  else if (opts.json) console.log(JSON.stringify(rows, null, 2));
  else printTable(rows);
}

main().catch((e) => { console.error(`错误: ${e.message}`); process.exit(1); });
