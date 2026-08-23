#!/usr/bin/env node
/**
 * game-newtitles.mjs —— 「持续涌现新词」的游戏源取数
 *
 * 用途：
 *   新游戏 = 新词 = 新需求。游戏标题在发布当天基本没有竞争页面，对新站极友好
 *   （攻略 / 兑换码 / 是否免费 / unblocked / 类似游戏 / 能不能联机……都是现成长尾）。
 *   本脚本从多个源批量拉「新上架 / 即将发布 / 最近新增」的游戏标题，
 *   下游再交给 KD / Trends 脚本验证词的热度与难度。
 *
 * 支持的源 (--source)：
 *   steam    Steam 商店搜索的 infinite JSON 端点（公开、无 token）—— 首选
 *   itch     itch.io 列表页的 ?format=json 端点（公开、无 token）
 *   poki     poki.com 列表页 HTML 解析（公开、无 token）
 *   igdb     IGDB 官方 API，走 Twitch OAuth（需要 IGDB_CLIENT_ID / IGDB_CLIENT_SECRET）
 *   steamdb  steamdb.info —— 纯 HTTP 403，必须走 OpenCLI 真浏览器；独有「Follows
 *            关注人数 + 7 日增量」= 发售前的需求强度排序（Steam 官方端点没有这个）
 *
 * 示例命令：
 *   node game-newtitles.mjs --source steam --count 40
 *   node game-newtitles.mjs --source steam --sort Released_DESC --details --count 10
 *   node game-newtitles.mjs --source steam --upcoming --count 40
 *   node game-newtitles.mjs --source itch --pages 2 --json
 *   node game-newtitles.mjs --source poki --path /en/new
 *   node game-newtitles.mjs --source igdb --days 7 --count 50 --out games.jsonl --jsonl
 *   node game-newtitles.mjs --source steamdb --sdb-path /upcoming/ --session demand-x-sdb
 *
 * 依赖：
 *   - steam / itch / poki：无 token、无登录态
 *   - igdb：IGDB_CLIENT_ID + IGDB_CLIENT_SECRET
 *     读取顺序：环境变量 → rankup/.env（每行 KEY=value）
 *
 * 已验证日期：2026-08-23
 *
 * 已知坑：
 *   - steam：用的是 /search/results/?infinite=1，返回 {success, total_count, results_html}，
 *     里面是 HTML 片段，靠 class 选择器解析（search_result_row / .title / .search_released）。
 *     Valve 改版会断。返回里混着 DLC、原声带、软件；用 --details 调 appdetails 拿 type
 *     再过滤（appdetails 有速率限制，约每分钟 200 次，脚本默认串行 + sleep）。
 *   - steam --upcoming：未定档的作品 Steam 会填占位日期（"To be announced" / "Coming soon"
 *     或 2099/9998 这类假年份），别把 date 当真，判定用 extra.releasedRaw。
 *   - steam --details 每个 appid 一次请求，count 开大会很慢，且 429 后要等几分钟。
 *   - itch：?format=json 返回的是 {page, num_items, content:"<html片段>"}，仍要解析 HTML。
 *     未登录时列表按站点默认排序，没有下载量/评分字段（itch 不公开这些）。
 *   - poki：页面 class 名是构建期哈希（每次发版都变），所以只用 data-tile-* 属性定位，
 *     相对稳；但 Poki 完全不公开游戏数量/播放量，只能拿到标题 + URL。
 *   - igdb：Twitch token 有效期约 60 天，脚本每次现取不缓存。APICalypse 是自定义查询语言，
 *     不是 JSON；速率限制 4 请求/秒。
 *   - steamdb：https://steamdb.info/ 全站 Cloudflare 托管挑战，curl / fetch 一律 403
 *     （返回 "Just a moment..." 页，2026-08-23 实测 /upcoming/ 与站点根路径均 403）。
 *     所以 --source steamdb 走 OpenCLI 驱动用户本机真实 Chrome（不需要 SteamDB 账号，
 *     只是需要真浏览器过挑战）。列名随页面变（/upcoming/ 是 Name/%/Price/Rating/
 *     Release/Follows/7d Gain），脚本按表头名映射，换页面就换字段。
 *     价格按浏览器所在区服显示，不是美元。
 *     会话纪律：默认跑完自动 close；并行时用 --session 传带自己前缀的**字面常量**，
 *     绝不要用 $$，也绝不要跑 `opencli browser cleanup`。
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const HELP = `game-newtitles.mjs — 新游戏标题批量取数（新游戏 = 新词 = 新需求）

用法:
  node game-newtitles.mjs --source <steam|itch|poki|igdb|steamdb> [选项]

通用:
  --count <n>        拉多少条            (默认 30)
  --json             输出 JSON 数组
  --jsonl            输出 JSON Lines
  --out <file>       落盘
  --sleep <ms>       请求间隔            (默认 500)
  -h, --help         本帮助

steam:
  --term <q>         搜索词              (默认 空 = 全部)
  --sort <key>       Released_DESC | Name_ASC | Price_ASC | Reviews_DESC ...
                                         (默认 Released_DESC)
  --upcoming         只看即将发布        (等价于 filter=comingsoon)
  --start <n>        偏移                (默认 0)
  --cc <cc>          区服                (默认 us)
  --lang <l>         语言                (默认 english)
  --details          对每条调 appdetails 补 type/genres/release (慢，有限流)
  --only-games       配合 --details，过滤掉 DLC / 原声带 / 软件

itch:
  --path <p>         列表路径            (默认 /games/newest)
  --pages <n>        翻几页              (默认 1，每页约 36 条)

poki:
  --path <p>         列表路径            (默认 /en/new)
  --tile-list <n>    只要某个板块的磁贴，如 basic-game（主列表）/ popularWeekGames
                     不传则全要。板块名见输出的 extra.list

igdb:
  --days <n>         最近 n 天内首发      (默认 7)
  --platform <id>    IGDB platform id 过滤，可逗号分隔 (默认 不限)

steamdb (需要 OpenCLI 真浏览器，Cloudflare 挡纯 HTTP):
  --sdb-path <p>     SteamDB 列表路径     (默认 /upcoming/)
  --session <s>      OpenCLI 会话名，带你自己前缀的字面常量 (默认 demand-steamdb)
  --keep-open        跑完不关标签页
  --timeout <ms>     页面加载等待         (默认 9000)

输出字段: {source, name, url, domain, users, rating, ratingCount, date, extra}
`;

// ---------- env ----------
const __dir = dirname(fileURLToPath(import.meta.url));
function loadEnv(key) {
  if (process.env[key]) return process.env[key];
  const envPath = resolve(__dir, '../../.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

// ---------- args ----------
function parseArgs(argv) {
  const o = {
    source: null, count: 30, json: false, jsonl: false, out: null, sleep: 500,
    term: '', sort: 'Released_DESC', upcoming: false, start: 0, cc: 'us', lang: 'english',
    details: false, onlyGames: false,
    path: null, pages: 1, tileList: null,
    days: 7, platform: null,
    sdbPath: '/upcoming/', session: 'demand-steamdb', keepOpen: false, timeout: 9000,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '--source': o.source = next(); break;
      case '--count': o.count = Number(next()); break;
      case '--json': o.json = true; break;
      case '--jsonl': o.jsonl = true; break;
      case '--out': o.out = next(); break;
      case '--sleep': o.sleep = Number(next()); break;
      case '--term': o.term = next(); break;
      case '--sort': o.sort = next(); break;
      case '--upcoming': o.upcoming = true; break;
      case '--start': o.start = Number(next()); break;
      case '--cc': o.cc = next(); break;
      case '--lang': o.lang = next(); break;
      case '--details': o.details = true; break;
      case '--only-games': o.onlyGames = true; o.details = true; break;
      case '--path': o.path = next(); break;
      case '--pages': o.pages = Number(next()); break;
      case '--tile-list': o.tileList = next(); break;
      case '--days': o.days = Number(next()); break;
      case '--platform': o.platform = next(); break;
      case '--sdb-path': o.sdbPath = next(); break;
      case '--session': o.session = next(); break;
      case '--keep-open': o.keepOpen = true; break;
      case '--timeout': o.timeout = Number(next()); break;
      default:
        if (a.startsWith('-')) { console.error(`未知参数: ${a}\n${HELP}`); process.exit(2); }
    }
  }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => s
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
const strip = (s) => decode(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

async function get(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res;
}

function rec(source, name, url, extra = {}, over = {}) {
  return {
    source, name, url, domain: domainOf(url),
    users: null, rating: null, ratingCount: null, date: null,
    ...over, extra,
  };
}

// ---------- steam ----------
function parseSteamRows(html) {
  const out = [];
  const re = /<a href="(https:\/\/store\.steampowered\.com\/app\/(\d+)\/[^"]*)"[\s\S]*?data-ds-appid="\d+"[\s\S]*?<span class="title">([\s\S]*?)<\/span>[\s\S]*?<div class="search_released[^"]*">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({
      url: m[1].split('?')[0],
      appid: Number(m[2]),
      name: strip(m[3]),
      released: strip(m[4]) || null,
    });
  }
  return out;
}

async function sourceSteam(o) {
  const rows = [];
  let start = o.start;
  while (rows.length < o.count) {
    const want = Math.min(100, o.count - rows.length);
    const p = new URLSearchParams({
      start: String(start), count: String(want), sort_by: o.sort,
      infinite: '1', cc: o.cc, l: o.lang,
    });
    if (o.term) p.set('term', o.term);
    if (o.upcoming) p.set('filter', 'comingsoon');
    const res = await get(`https://store.steampowered.com/search/results/?query&${p}`);
    const data = await res.json();
    const batch = parseSteamRows(data.results_html || '');
    if (!batch.length) break;
    rows.push(...batch);
    start += want;
    await sleep(o.sleep);
  }
  const out = rows.slice(0, o.count).map((r) =>
    rec('steam', r.name, r.url, { appid: r.appid, releasedRaw: r.released }, { date: normDate(r.released) }));

  if (o.details) {
    for (const r of out) {
      try {
        const res = await get(`https://store.steampowered.com/api/appdetails?appids=${r.extra.appid}&cc=${o.cc}&l=${o.lang}&filters=basic,genres,release_date,price_overview`);
        const j = await res.json();
        const d = j?.[r.extra.appid]?.data;
        if (d) {
          r.extra.type = d.type;
          r.extra.genres = (d.genres || []).map((g) => g.description);
          r.extra.isFree = d.is_free;
          r.extra.price = d.price_overview?.final_formatted ?? null;
          if (d.release_date?.date) r.date = normDate(d.release_date.date) ?? r.date;
        }
      } catch (e) { r.extra.detailError = e.message; }
      await sleep(o.sleep);
    }
  }
  return o.onlyGames ? out.filter((r) => r.extra.type === 'game') : out;
}

function normDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ---------- itch ----------
function parseItchCells(html) {
  const out = [];
  const re = /data-game_id="(\d+)"[\s\S]*?<a class="title game_link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<div class="game_author">[\s\S]*?>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tail = m[4];
    const price = /<div class="price_value">([^<]*)<\/div>/.exec(tail)?.[1] ?? null;
    const desc = /<div class="game_text">([\s\S]*?)<\/div>/.exec(tail)?.[1] ?? null;
    out.push({
      gameId: Number(m[1]), url: m[2], name: strip(m[3]),
      author: strip(m[5]), price: price ? decode(price) : null,
      summary: desc ? strip(desc) : null,
    });
  }
  return out;
}

async function sourceItch(o) {
  const path = o.path || '/games/newest';
  const out = [];
  for (let p = 1; p <= o.pages && out.length < o.count; p++) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await get(`https://itch.io${path}${sep}page=${p}&format=json`, { Accept: 'application/json' });
    const j = await res.json();
    const html = typeof j === 'string' ? j : (j.content || '');
    for (const c of parseItchCells(html)) {
      // itch 也有 genre 字段，抓不到就算了
      out.push(rec('itch.io', c.name, c.url,
        { gameId: c.gameId, author: c.author, price: c.price, summary: c.summary }));
      if (out.length >= o.count) break;
    }
    await sleep(o.sleep);
  }
  return out;
}

// ---------- poki ----------
async function sourcePoki(o) {
  const path = o.path || '/en/new';
  const res = await get(`https://poki.com${path}`);
  const html = await res.text();
  const out = [];
  const seen = new Set();
  const re = /<a[^>]*data-tile-url="([^"]+)"[^>]*data-tile-list="([^"]+)"[\s\S]{0,1600}?<span class="summaryTile__title[^"]*">([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html)) !== null && out.length < o.count) {
    const url = `https://poki.com${m[1]}`;
    if (seen.has(url)) continue;
    if (o.tileList && m[2] !== o.tileList) continue;
    seen.add(url);
    out.push(rec('poki', strip(m[3]), url, { list: m[2], slug: m[1].split('/').pop() }));
  }
  return out;
}

// ---------- igdb ----------
async function igdbToken() {
  const id = loadEnv('IGDB_CLIENT_ID');
  const secret = loadEnv('IGDB_CLIENT_SECRET');
  if (!id || !secret) {
    throw new Error(
      'IGDB 需要 IGDB_CLIENT_ID 和 IGDB_CLIENT_SECRET。\n' +
      '  取得方式：在 Twitch 开发者后台注册一个应用，拿 Client ID / Client Secret。\n' +
      '  设置方式：导出为环境变量，或写进 rankup/.env（每行 KEY=value）。');
  }
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`,
    { method: 'POST' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`Twitch OAuth 失败 (HTTP ${res.status}): ${JSON.stringify(j)}`);
  }
  return { clientId: id, token: j.access_token };
}

async function sourceIgdb(o) {
  const { clientId, token } = await igdbToken();
  const since = Math.floor(Date.now() / 1000) - o.days * 86400;
  const now = Math.floor(Date.now() / 1000);
  const where = [`first_release_date > ${since}`, `first_release_date < ${now + 86400 * 400}`];
  if (o.platform) where.push(`platforms = (${o.platform})`);
  const body =
    `fields name,slug,url,first_release_date,total_rating,total_rating_count,` +
    `genres.name,platforms.abbreviation,summary;\n` +
    `where ${where.join(' & ')};\n` +
    `sort first_release_date desc;\nlimit ${Math.min(500, o.count)};`;
  const res = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}`, Accept: 'application/json' },
    body,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`IGDB HTTP ${res.status}: ${txt.slice(0, 300)}`);
  const list = JSON.parse(txt);
  return list.map((g) => rec('igdb', g.name, g.url || `https://www.igdb.com/games/${g.slug}`, {
    id: g.id, slug: g.slug, summary: g.summary ?? null,
    genres: (g.genres || []).map((x) => x.name),
    platforms: (g.platforms || []).map((x) => x.abbreviation).filter(Boolean),
  }, {
    rating: g.total_rating != null ? Math.round(g.total_rating * 10) / 10 : null,
    ratingCount: g.total_rating_count ?? null,
    date: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
  }));
}

// ---------- steamdb (OpenCLI 真浏览器) ----------
const SDB_EXTRACTOR = `(()=>{
  const t = document.querySelector('table');
  if (!t) return { count: 0, text: document.body.innerText.slice(0, 400), title: document.title };
  const hdr = [...t.querySelectorAll('thead th')].map((e) => e.innerText.trim());
  const rows = [...t.querySelectorAll('tbody tr')].map((tr) => {
    const cells = [...tr.querySelectorAll('td')];
    const o = { appid: tr.getAttribute('data-appid') };
    const link = tr.querySelector('a.b') || [...tr.querySelectorAll('a[href^="/app/"]')].find((a) => a.innerText.trim());
    o.name = link ? link.innerText.trim() : null;
    cells.forEach((td, i) => {
      const key = hdr[i] || ('col' + i);
      if (!key) return;
      const sort = td.getAttribute('data-sort');
      o[key] = { text: td.innerText.trim().replace(/\\s+/g, ' '), sort: sort === null ? null : sort };
    });
    return o;
  });
  return { count: rows.length, hdr, rows, title: document.title, url: location.href };
})()`;

async function sourceSteamdb(o) {
  const url = `https://steamdb.info${o.sdbPath}`;
  const run = async (args) => (await execFileP('opencli', args, { maxBuffer: 32 * 1024 * 1024 })).stdout;
  try { await run(['doctor']); }
  catch { throw new Error('opencli doctor 失败：steamdb 源需要可用的 OpenCLI + 真浏览器。'); }

  let payload;
  try {
    await run(['browser', o.session, '--window', 'background', 'open', url]);
    await sleep(o.timeout);
    const out = await run(['browser', o.session, 'eval', SDB_EXTRACTOR]);
    const i = out.indexOf('{'), j = out.lastIndexOf('}');
    if (i < 0) throw new Error(`OpenCLI 未返回 JSON:\n${out.slice(0, 300)}`);
    payload = JSON.parse(out.slice(i, j + 1));
  } finally {
    if (!o.keepOpen) { try { await run(['browser', o.session, 'close']); } catch { /* 已关 */ } }
  }
  if (!payload.count) {
    throw new Error('SteamDB 页面没解析到表格。可能 Cloudflare 挑战没过完（加大 --timeout）或站点改版。\n'
      + (payload.text || ''));
  }
  const num = (v) => { if (v == null) return null; const n = Number(String(v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : null; };
  return payload.rows.slice(0, o.count).map((r) => {
    const rel = r['Release'];
    const relTs = rel && rel.sort ? Number(rel.sort) : null;
    const follows = r['Follows'];
    const gain = r['7d Gain'];
    const rating = r['Rating'];
    const price = r['Price'];
    const raw = {};
    for (const [k, v] of Object.entries(r)) if (v && typeof v === 'object') raw[k] = v.text;
    const name = r.name || (r['Name'] ? r['Name'].text : null);
    return rec('steamdb', name, `https://steamdb.info/app/${r.appid}/`, {
      appid: r.appid ? Number(r.appid) : null,
      storeUrl: r.appid ? `https://store.steampowered.com/app/${r.appid}/` : null,
      follows: follows ? num(follows.sort ?? follows.text) : null,
      gain7d: gain ? num(gain.sort ?? gain.text) : null,
      price: price ? price.text : null,
      list: o.sdbPath,
      cells: raw,
    }, {
      rating: (() => { const v = rating ? num(rating.sort ?? rating.text) : null; return v == null || v < 0 ? null : v; })(),
      date: relTs && relTs > 1e9 && relTs < 4e9
        ? new Date(relTs * 1000).toISOString().slice(0, 10)
        : (rel ? normDate(rel.text) : null),
    });
  });
}

// ---------- output ----------
function printTable(rows) {
  if (!rows.length) { console.log('(无结果)'); return; }
  const head = ['date', 'source', 'name', 'url'];
  const body = rows.map((r) => [r.date || '-', r.source, (r.name || '').slice(0, 52), r.url]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  console.log(head.map((h, i) => h.padEnd(w[i])).join('  '));
  console.log(w.map((n) => '-'.repeat(n)).join('  '));
  for (const b of body) console.log(b.map((v, i) => (i === 3 ? v : v.padEnd(w[i]))).join('  '));
  console.log(`\n共 ${rows.length} 条`);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.source) { console.log(HELP); if (!o.source && !o.help) process.exit(2); return; }

  const fn = {
    steam: sourceSteam, itch: sourceItch, poki: sourcePoki,
    igdb: sourceIgdb, steamdb: sourceSteamdb,
  }[o.source];
  if (!fn) { console.error(`未知 --source ${o.source}\n${HELP}`); process.exit(2); }

  const rows = await fn(o);
  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n');
  if (o.out) {
    writeFileSync(o.out, o.jsonl ? jsonl + '\n' : JSON.stringify(rows, null, 2));
    console.error(`已写入 ${o.out} (${rows.length} 条)`);
  }
  if (o.jsonl) console.log(jsonl);
  else if (o.json) console.log(JSON.stringify(rows, null, 2));
  else printTable(rows);
}

main().catch((e) => { console.error(`错误: ${e.message}`); process.exit(1); });
