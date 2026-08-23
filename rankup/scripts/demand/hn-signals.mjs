#!/usr/bin/env node
/**
 * 用途：从 Hacker News 捞需求信号。
 *   - Show HN：别人刚发布的新产品（看它解决什么问题、评论里骂什么）
 *   - Ask HN：用户原话描述的真实痛点
 *   - 关键词搜索：某个方向最近有没有人在讨论、讨论到什么程度
 *   还可以顺带把某条 story 的评论全文拉下来（--comments），评论区才是痛点的富矿。
 *
 * 示例命令：
 *   node scripts/demand/hn-signals.mjs --mode show --days 3 --min-points 5
 *   node scripts/demand/hn-signals.mjs --mode ask --days 30 --min-comments 20
 *   node scripts/demand/hn-signals.mjs --mode search --q "invoice" --days 90 --min-points 20
 *   node scripts/demand/hn-signals.mjs --mode search --q "screenshot tool" --json --out hits.json
 *   node scripts/demand/hn-signals.mjs --comments <storyId> --max-comments 50
 *
 * 依赖：无 token、无登录态。纯公开 HTTP。
 * 已验证日期：2026-08-23
 *
 * 已知坑：
 *   - 用的是 Algolia HN Search API（https://hn.algolia.com/api/v1/）。官方 Firebase API
 *     （hacker-news.firebaseio.com/v0/）不支持按关键词/时间过滤，只给 id 列表，要按 id
 *     逐条取 item，捞「最近 N 天 + 关键词」要几百次请求，因此本脚本不用它。
 *     Firebase 只适合「实时看当前 topstories 前 N 名」。
 *   - Algolia 限流：约 10000 次/小时/IP，无需 key；超了返回 429。
 *   - `search` 按相关性+热度排，`search_by_date` 按时间倒序排。要「最近的」用 by-date，
 *     要「最有讨论度的」用 search。本脚本用 --sort 控制，默认 points。
 *   - hitsPerPage 上限 1000，但实际一次超过 100 容易超时，脚本内部按 100 分页。
 *   - Ask HN / Show HN 的 tag 是 ask_hn / show_hn，但很多帖子标题写了 "Ask HN:" 却没打上
 *     tag，所以 --mode ask 会同时用 tag 和标题前缀两路取并去重。
 */

import { parseArgs, getJson, emit, die } from './_lib.mjs';

const API = 'https://hn.algolia.com/api/v1';

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** HN 的 text 是 HTML 片段，实体（含 &#x2F; 这类数字实体）必须解码，否则 URL 全是乱码 */
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

const HELP = `
hn-signals.mjs — Hacker News 需求信号（Show HN / Ask HN / 关键词搜索 / 评论）

用法:
  node hn-signals.mjs --mode <show|ask|search|front> [选项]
  node hn-signals.mjs --comments <storyId> [--max-comments N]

选项:
  --mode <m>          show=Show HN, ask=Ask HN, search=关键词搜索, front=最近上首页的 story
                      (默认 show)
  --q <query>         关键词（mode=search 必填；其它 mode 可选，用来在板块内再过滤）
  --days <n>          只看最近 n 天（默认 7）
  --limit <n>         最多返回多少条（默认 30）
  --min-points <n>    最低分数（默认 0）
  --min-comments <n>  最低评论数（默认 0）
  --sort <s>          points | comments | date（默认 points）
  --tags <t>          直接指定 Algolia tags，覆盖 --mode，例如 story,author_pg
  --comments <id>     改为拉取某条 story 的评论全文
  --max-comments <n>  --comments 模式下最多返回多少条（默认 100）
  --json              输出 JSON
  --out <file>        落盘（.jsonl 走 JSON Lines，其它走 JSON）
  --help

产出字段:
  story:   id, title, url, author, points, numComments, createdAt, hnUrl, text
  comment: id, author, createdAt, parentId, text, hnUrl
`.trim();

const MODE_TAGS = {
  show: ['show_hn'],
  ask: ['ask_hn'],
  front: ['front_page'],
  search: ['story'],
};

async function searchPage({ tags, query, since, sortByDate, page }) {
  const u = new URL(`${API}/${sortByDate ? 'search_by_date' : 'search'}`);
  if (query) u.searchParams.set('query', query);
  if (tags) u.searchParams.set('tags', tags);
  u.searchParams.set('numericFilters', `created_at_i>${since}`);
  u.searchParams.set('hitsPerPage', '100');
  u.searchParams.set('page', String(page));
  return getJson(u.toString());
}

function normStory(h) {
  return {
    id: Number(h.objectID),
    title: h.title ?? h.story_title ?? '',
    url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
    author: h.author,
    points: h.points ?? 0,
    numComments: h.num_comments ?? 0,
    createdAt: h.created_at,
    hnUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
    text: decodeEntities((h.story_text ?? h.comment_text ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 800),
  };
}

async function collect(opts) {
  const seen = new Map();
  for (const tags of opts.tagSets) {
    for (let page = 0; page < opts.maxPages; page++) {
      const data = await searchPage({ ...opts, tags, page });
      for (const h of data.hits ?? []) {
        const s = normStory(h);
        if (!s.title) continue;
        if (!seen.has(s.id)) seen.set(s.id, s);
      }
      if (page + 1 >= (data.nbPages ?? 1)) break;
    }
  }
  return [...seen.values()];
}

async function fetchComments(storyId, max) {
  const data = await getJson(`${API}/items/${storyId}`);
  const out = [];
  const walk = (n, depth) => {
    if (out.length >= max) return;
    if (n.type === 'comment' && n.text) {
      out.push({
        id: n.id,
        author: n.author,
        createdAt: n.created_at,
        parentId: n.parent_id,
        depth,
        text: decodeEntities(n.text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(),
        hnUrl: `https://news.ycombinator.com/item?id=${n.id}`,
      });
    }
    for (const c of n.children ?? []) walk(c, depth + 1);
  };
  walk(data, 0);
  return { root: normStory({ ...data, objectID: data.id, num_comments: out.length }), comments: out };
}

async function main() {
  const args = parseArgs();
  if (args.help || args.h) { console.log(HELP); return; }

  if (args.comments) {
    const id = String(args.comments);
    if (!/^\d+$/.test(id)) die('--comments 需要一个数字 story id');
    const max = Number(args['max-comments'] ?? 100);
    const { root, comments } = await fetchComments(id, max);
    if (!args.json) console.error(`# ${root.title}\n# ${root.hnUrl}\n`);
    emit(comments, args, [
      { key: 'author', label: '作者', max: 16 },
      { key: 'createdAt', label: '时间', max: 20 },
      { key: 'text', label: '评论', max: 110 },
    ]);
    return;
  }

  const mode = String(args.mode ?? 'show');
  if (!MODE_TAGS[mode] && !args.tags) die(`未知 --mode ${mode}（可用 ${Object.keys(MODE_TAGS).join('/')}）`);
  const query = args.q ? String(args.q) : '';
  if (mode === 'search' && !query) die('--mode search 必须给 --q');

  const days = Number(args.days ?? 7);
  const limit = Number(args.limit ?? 30);
  const minPoints = Number(args['min-points'] ?? 0);
  const minComments = Number(args['min-comments'] ?? 0);
  const sort = String(args.sort ?? 'points');
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  const tagSets = args.tags ? [String(args.tags)] : MODE_TAGS[mode].map((t) => t);
  const opts = {
    tagSets, query, since,
    sortByDate: sort === 'date',
    maxPages: Math.max(1, Math.ceil(limit / 100) + 1),
  };

  let rows = await collect(opts);

  // ask/show 模式补一路标题前缀搜索，捞回没打 tag 的帖子
  if ((mode === 'ask' || mode === 'show') && !args.tags) {
    const prefix = mode === 'ask' ? 'Ask HN' : 'Show HN';
    const extra = await collect({ ...opts, tagSets: ['story'], query: query ? `${prefix} ${query}` : prefix });
    const known = new Set(rows.map((r) => r.id));
    for (const s of extra) {
      if (!known.has(s.id) && s.title.toLowerCase().startsWith(prefix.toLowerCase())) rows.push(s);
    }
  }

  if (query && mode !== 'search') {
    const q = query.toLowerCase();
    rows = rows.filter((r) => (r.title + ' ' + r.text).toLowerCase().includes(q));
  }
  rows = rows.filter((r) => r.points >= minPoints && r.numComments >= minComments);

  const cmp = {
    points: (a, b) => b.points - a.points,
    comments: (a, b) => b.numComments - a.numComments,
    date: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  }[sort] ?? ((a, b) => b.points - a.points);
  rows.sort(cmp);
  rows = rows.slice(0, limit);

  emit(rows, args, [
    { key: 'points', label: '分', max: 5 },
    { key: 'numComments', label: '评论', max: 5 },
    { key: 'createdAt', label: '时间', max: 20 },
    { key: 'title', label: '标题', max: 70 },
    { key: 'url', label: 'URL', max: 46 },
  ]);
}

main().catch((e) => die(e.message));
