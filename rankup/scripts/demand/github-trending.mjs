#!/usr/bin/env node
/**
 * 用途：看哪些技术方向正在升温 —— 升温的方向背后往往有一批还没被产品化的需求。
 *   两条取数路径都实现了，可用 --source 切换：
 *     trending（默认）= 解析 https://github.com/trending HTML。给「今天/本周新增多少 star」，
 *                       这是 GitHub 唯一公开的「增速」信号，Search API 给不了。
 *     search          = GitHub Search API `stars:>N created:>DATE`，稳定、有 JSON、可分页，
 *                       但只能给「累计 star」，看不出增速；适合「最近 N 天新建的高星仓库」。
 *   配合 --issues 可以把每个仓库最近的 open issue 一起拉下来，专门找
 *   「安装太复杂 / 没有 GUI / 缺某个功能」这类可产品化的抱怨。
 *
 * 示例命令：
 *   node scripts/demand/github-trending.mjs --since daily --limit 15
 *   node scripts/demand/github-trending.mjs --since weekly --lang typescript --json
 *   node scripts/demand/github-trending.mjs --source search --created-days 60 --min-stars 300
 *   node scripts/demand/github-trending.mjs --since weekly --limit 5 --issues 5 --out repos.json
 *
 * 依赖：
 *   - source=trending：无 token、无登录态。
 *   - source=search / --issues：不带 token 也能跑（Search 10 次/分、REST 60 次/小时），
 *     带 token 提到 30 次/分、5000 次/小时。token 读取顺序：环境变量
 *     GITHUB_TOKEN / GH_TOKEN → rankup/.env。也可以 `GITHUB_TOKEN=$(gh auth token)`。
 * 已验证日期：2026-08-23
 *
 * 已知坑：
 *   - /trending 没有官方 API，HTML class 名（Box-row / h3.lh-condensed）会变。
 *     脚本已尽量用结构而非 class 定位，但仍然是「次选方案」，解析失败会明确报错而不是静默返回空。
 *   - /trending 每页固定约 25 条，没有分页，--limit 超过这个数没用。
 *   - /trending 的 `--lang` 是 URL path 段（github.com/trending/rust），大小写不敏感，
 *     多词语言用连字符（如 jupyter-notebook）。
 *   - Search API 单次查询最多返回 1000 条（10 页 × 100），超出会 422。
 *   - Search API 未认证时 10 次/分，跑 --issues 很容易撞限流，建议带 token。
 */

import { parseArgs, getText, getJson, get, emit, die, sleep, readToken } from './_lib.mjs';

const HELP = `
github-trending.mjs — GitHub 升温方向 + issue 里的产品化机会

用法:
  node github-trending.mjs [--source trending|search] [选项]

通用:
  --limit <n>          最多返回多少仓库（默认 25）
  --lang <l>           语言过滤（如 rust / typescript / python）
  --issues <n>         额外为每个仓库拉最近 n 条 open issue（0=不拉，默认 0）
  --issue-labels <l>   issue 标签过滤，逗号分隔（如 enhancement,help wanted）
  --json / --out <f>   输出 JSON / 落盘
  --help

--source trending（默认，解析 HTML）:
  --since <s>          daily | weekly | monthly（默认 daily）
  --spoken <s>         口语语言过滤，如 en / zh

--source search（GitHub Search API）:
  --created-days <n>   只看最近 n 天创建的仓库（默认 90）
  --pushed-days <n>    只看最近 n 天有 push 的仓库（可选）
  --min-stars <n>      最低 star（默认 100）
  --q <extra>          追加原生搜索限定词，如 "topic:cli in:description agent"
  --sort <s>           stars | forks | updated | help-wanted-issues（默认 stars）

产出字段:
  repo, url, description, language, stars, starsInPeriod(仅 trending),
  forks, createdAt/pushedAt(仅 search), issues[]{number,title,labels,comments,url,body}
`.trim();

/* ---------- source=trending：HTML 解析 ---------- */

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&#x27;/g, "'").replace(/\s+/g, ' ').trim();

async function fromTrending(args) {
  const since = String(args.since ?? 'daily');
  if (!['daily', 'weekly', 'monthly'].includes(since)) die('--since 只能是 daily/weekly/monthly');
  const lang = args.lang ? '/' + encodeURIComponent(String(args.lang).toLowerCase()) : '';
  const u = new URL(`https://github.com/trending${lang}`);
  u.searchParams.set('since', since);
  if (args.spoken) u.searchParams.set('spoken_language_code', String(args.spoken));

  const html = await getText(u.toString(), { headers: { accept: 'text/html' } });
  const blocks = html.split(/<article\b[^>]*>/).slice(1).map((b) => b.split('</article>')[0]);
  if (!blocks.length) die(`没能从 ${u} 解析出任何仓库块 —— /trending 的 HTML 结构可能又改了，改用 --source search`);

  const rows = [];
  for (const block of blocks) {
    // 仓库名只认标题里的那个链接：article 开头还有 Star / Sponsor 按钮，直接取第一个 <a> 会拿错
    const hIdx = block.search(/<h[123]\b/);
    const b = hIdx === -1 ? block : block.slice(hIdx);
    const m = b.match(/<a[^>]+href="\/([^"\/]+)\/([^"\/?#]+)"[^>]*>/);
    if (!m) continue;
    const repo = `${m[1]}/${m[2]}`;
    const afterH = b.slice(b.search(/<\/h[123]>/) + 1);
    const desc = (afterH.match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1];
    const language = (b.match(/itemprop="programmingLanguage"[^>]*>([\s\S]*?)</) || [])[1];
    const nums = [...b.matchAll(/href="\/[^"]+\/(stargazers|forks|network\/members)"[^>]*>([\s\S]*?)<\/a>/g)];
    const num = (kind) => {
      const hit = nums.find((x) => x[1] === kind || (kind === 'forks' && x[1] === 'network/members'));
      return hit ? Number(strip(hit[2]).replace(/,/g, '')) || 0 : 0;
    };
    const period = (b.match(/([\d,]+)\s*stars?\s+(today|this week|this month)/i) || [])[1];
    rows.push({
      repo,
      url: `https://github.com/${repo}`,
      description: desc ? strip(desc) : '',
      language: language ? strip(language) : '',
      stars: num('stargazers'),
      starsInPeriod: period ? Number(period.replace(/,/g, '')) : 0,
      forks: num('forks'),
      period: since,
    });
  }
  return rows.slice(0, Number(args.limit ?? 25));
}

/* ---------- source=search：Search API ---------- */

function ghHeaders(token) {
  const h = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

const isoDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function fromSearch(args, token) {
  const parts = [`stars:>${Number(args['min-stars'] ?? 100)}`];
  parts.push(`created:>${isoDaysAgo(Number(args['created-days'] ?? 90))}`);
  if (args['pushed-days']) parts.push(`pushed:>${isoDaysAgo(Number(args['pushed-days']))}`);
  if (args.lang) parts.push(`language:${String(args.lang)}`);
  if (args.q) parts.push(String(args.q));

  const limit = Number(args.limit ?? 25);
  const rows = [];
  for (let page = 1; rows.length < limit && page <= 10; page++) {
    const u = new URL('https://api.github.com/search/repositories');
    u.searchParams.set('q', parts.join(' '));
    u.searchParams.set('sort', String(args.sort ?? 'stars'));
    u.searchParams.set('order', 'desc');
    u.searchParams.set('per_page', String(Math.min(100, limit - rows.length)));
    u.searchParams.set('page', String(page));
    const d = await getJson(u.toString(), { headers: ghHeaders(token) });
    for (const r of d.items ?? []) {
      rows.push({
        repo: r.full_name,
        url: r.html_url,
        description: r.description ?? '',
        language: r.language ?? '',
        stars: r.stargazers_count,
        forks: r.forks_count,
        openIssues: r.open_issues_count,
        createdAt: r.created_at,
        pushedAt: r.pushed_at,
        topics: r.topics ?? [],
      });
    }
    if ((d.items ?? []).length === 0 || rows.length >= (d.total_count ?? 0)) break;
  }
  return rows.slice(0, limit);
}

/* ---------- issues ---------- */

async function attachIssues(rows, n, labels, token) {
  for (const r of rows) {
    const u = new URL(`https://api.github.com/repos/${r.repo}/issues`);
    u.searchParams.set('state', 'open');
    u.searchParams.set('sort', 'comments');
    u.searchParams.set('direction', 'desc');
    u.searchParams.set('per_page', String(n));
    if (labels) u.searchParams.set('labels', labels);
    try {
      const res = await get(u.toString(), { headers: ghHeaders(token) });
      if (!res.ok) { r.issues = []; r.issuesError = `HTTP ${res.status}`; continue; }
      const list = await res.json();
      r.issues = (Array.isArray(list) ? list : [])
        .filter((i) => !i.pull_request)
        .map((i) => ({
          number: i.number,
          title: i.title,
          labels: (i.labels ?? []).map((l) => l.name ?? l),
          comments: i.comments,
          url: i.html_url,
          body: String(i.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
        }));
    } catch (e) { r.issues = []; r.issuesError = e.message; }
    if (!token) await sleep(1200); // 未认证 REST 60 次/小时，慢一点
  }
}

async function main() {
  const args = parseArgs();
  if (args.help || args.h) { console.log(HELP); return; }

  const token = readToken('GITHUB_TOKEN', 'GH_TOKEN');
  const source = String(args.source ?? 'trending');
  let rows;
  if (source === 'trending') rows = await fromTrending(args);
  else if (source === 'search') rows = await fromSearch(args, token);
  else die('--source 只能是 trending 或 search');

  const nIssues = Number(args.issues ?? 0);
  if (nIssues > 0) {
    if (!token) console.error('提示：未找到 GITHUB_TOKEN，拉 issue 会很慢且容易撞 60 次/小时限流');
    await attachIssues(rows, nIssues, args['issue-labels'] ? String(args['issue-labels']) : '', token);
  }

  emit(rows, args, source === 'trending'
    ? [
      { key: 'starsInPeriod', label: '期内★', max: 7 },
      { key: 'stars', label: '总★', max: 8 },
      { key: 'language', label: '语言', max: 12 },
      { key: 'repo', label: '仓库', max: 34 },
      { key: 'description', label: '简介', max: 62 },
    ]
    : [
      { key: 'stars', label: '★', max: 8 },
      { key: 'createdAt', label: '创建', max: 10 },
      { key: 'language', label: '语言', max: 12 },
      { key: 'repo', label: '仓库', max: 34 },
      { key: 'description', label: '简介', max: 62 },
    ]);
}

main().catch((e) => die(e.message));
