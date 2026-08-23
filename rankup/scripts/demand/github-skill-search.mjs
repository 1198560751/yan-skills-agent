#!/usr/bin/env node
/**
 * 用途：反查「别人已经沉淀成 SKILL.md / prompt / agent 配置的需求」。
 *   有人愿意把一件事写成可复用的 skill，说明这件事他反复干过很多遍 —— 那就是真实、
 *   高频、且已经被验证值得自动化的需求。把这些标题/描述拉出来聚类，就是一份选题清单。
 *
 * 两条路径：
 *   --mode code（默认，需 token）：GitHub Code Search，按 `filename:SKILL.md` /
 *       `path:skills` / 任意关键词检索文件内容，命中后可选 --fetch 把文件正文（含
 *       YAML frontmatter 的 name/description）取回来。
 *   --mode repo（无 token 也能跑）：Repository Search，按仓库名/描述/topic 找
 *       skill 仓库，`--sort updated` 拿最近更新的。code search 不可用时的退路。
 *
 * 示例命令：
 *   node scripts/demand/github-skill-search.mjs --limit 30 --fetch
 *   node scripts/demand/github-skill-search.mjs --q "seo" --filename SKILL.md --limit 20
 *   node scripts/demand/github-skill-search.mjs --path skills --q "invoice OR billing" --json
 *   node scripts/demand/github-skill-search.mjs --mode repo --q "claude skill" --sort updated
 *   node scripts/demand/github-skill-search.mjs --mode repo --topic agent-skills --out repos.jsonl
 *
 * 依赖：
 *   - --mode code **必须**有 token（GitHub Code Search 不允许匿名，匿名直接 401
 *     `{"message":"Requires authentication"}`）。token 读取顺序：环境变量
 *     GITHUB_TOKEN / GH_TOKEN → rankup/.env。本机装了 gh CLI 的话最省事：
 *       GITHUB_TOKEN=$(gh auth token) node scripts/demand/github-skill-search.mjs ...
 *     没有 token 时脚本会明确提示并建议改用 --mode repo。
 *   - --mode repo 无 token 可跑（10 次/分），带 token 30 次/分。
 * 已验证日期：2026-08-23
 *
 * 已知坑：
 *   - **Code Search 不支持按时间排序**。`sort=indexed` 是老 legacy code search 的参数，
 *     现在会被静默忽略，结果顺序是「最佳匹配」。想要「最近的」，只能 --mode repo
 *     配 --sort updated，或者 --enrich 拉每个仓库的 pushed_at 再自己排（脚本已实现
 *     --enrich，代价是每个仓库一次 REST 请求）。
 *   - Code Search 限流很紧：**10 次/分钟**，且每页最多 100 条、最多 1000 条结果。
 *     脚本翻页之间会自动 sleep。
 *   - Code Search 只索引默认分支、且仓库要有一定活跃度；很多个人 skill 仓库搜不到。
 *   - `total_count` 是估算值，动辄百万，不要当真实数量用。
 *   - --fetch 走 raw.githubusercontent.com，不计入 Search 配额，但计入普通 REST 配额时
 *     其实不计（raw 是独立 CDN），只是别开太大并发；脚本串行取。
 */

import { parseArgs, getJson, get, emit, die, sleep, readToken } from './_lib.mjs';

const HELP = `
github-skill-search.mjs — 反查别人沉淀的 SKILL.md，倒推真实需求

用法:
  node github-skill-search.mjs [--mode code|repo] [选项]

--mode code（默认，需要 GITHUB_TOKEN）:
  --filename <f>   限定文件名（默认 SKILL.md，传 "" 取消）
  --path <p>       限定路径片段，如 skills / .claude/skills
  --q <query>      额外关键词（匹配文件内容），支持 GitHub 搜索语法
  --extra <q>      原样追加的限定词，如 "language:markdown size:<20000"
  --fetch          把命中文件的正文取回来，并解析 YAML frontmatter 的 name/description
  --enrich         额外拉每个仓库的 stars / pushedAt（每仓库一次 REST 请求）

--mode repo（无 token 也能跑）:
  --q <query>      仓库名/描述关键词
  --topic <t>      topic 过滤，可重复
  --sort <s>       stars | updated | forks（默认 updated）
  --pushed-days <n> 只看最近 n 天有 push 的仓库

通用:
  --limit <n>      最多返回多少条（默认 30）
  --json / --out <f>
  --help

产出字段:
  code: repo, path, url, rawUrl, name, description(--fetch), excerpt(--fetch),
        stars/pushedAt(--enrich)
  repo: repo, url, description, stars, topics, pushedAt, createdAt
`.trim();

function ghHeaders(token) {
  const h = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

/** 解析 SKILL.md 头部的 YAML frontmatter（只取 name / description，够用且不引依赖） */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) { key = kv[1]; out[key] = kv[2].trim().replace(/^["']|["']$/g, ''); continue; }
    if (key && /^\s+\S/.test(line)) out[key] = (out[key] + ' ' + line.trim()).trim();
  }
  return out;
}

async function codeSearch(args, token) {
  const filename = args.filename === undefined ? 'SKILL.md' : String(args.filename);
  const parts = [];
  if (args.q) parts.push(String(args.q));
  if (filename) parts.push(`filename:${filename}`);
  if (args.path) parts.push(`path:${String(args.path)}`);
  if (args.extra) parts.push(String(args.extra));
  if (!parts.length) die('至少给一个 --q / --filename / --path');

  const limit = Number(args.limit ?? 30);
  const rows = [];
  for (let page = 1; rows.length < limit && page <= 10; page++) {
    const u = new URL('https://api.github.com/search/code');
    u.searchParams.set('q', parts.join(' '));
    u.searchParams.set('per_page', String(Math.min(100, limit - rows.length)));
    u.searchParams.set('page', String(page));
    const d = await getJson(u.toString(), { headers: ghHeaders(token) });
    if (page === 1 && !args.json) console.error(`# 查询: ${parts.join(' ')}  (估算命中 ${d.total_count})`);
    for (const it of d.items ?? []) {
      rows.push({
        repo: it.repository.full_name,
        path: it.path,
        url: it.html_url,
        rawUrl: `https://raw.githubusercontent.com/${it.repository.full_name}/HEAD/${it.path}`,
      });
    }
    if (!(d.items ?? []).length) break;
    if (rows.length < limit) await sleep(6500); // code search 10 次/分
  }
  return rows.slice(0, limit);
}

async function fetchBodies(rows) {
  for (const r of rows) {
    try {
      const res = await get(r.rawUrl, { headers: { accept: 'text/plain' }, retries: 1 });
      if (!res.ok) { r.fetchError = `HTTP ${res.status}`; continue; }
      const text = await res.text();
      const fm = parseFrontmatter(text);
      r.name = fm.name ?? '';
      r.description = fm.description ?? '';
      r.excerpt = text.replace(/^---[\s\S]*?\n---\r?\n/, '').replace(/\s+/g, ' ').trim().slice(0, 400);
    } catch (e) { r.fetchError = e.message; }
  }
}

async function enrich(rows, token) {
  const cache = new Map();
  for (const r of rows) {
    if (!cache.has(r.repo)) {
      try {
        const d = await getJson(`https://api.github.com/repos/${r.repo}`, { headers: ghHeaders(token) });
        cache.set(r.repo, { stars: d.stargazers_count, pushedAt: d.pushed_at, repoDescription: d.description ?? '' });
      } catch { cache.set(r.repo, {}); }
      if (!token) await sleep(1200);
    }
    Object.assign(r, cache.get(r.repo));
  }
  rows.sort((a, b) => new Date(b.pushedAt ?? 0) - new Date(a.pushedAt ?? 0));
}

async function repoSearch(args, token) {
  const parts = [];
  if (args.q) parts.push(String(args.q));
  for (const t of [].concat(args.topic ?? [])) parts.push(`topic:${t}`);
  if (args['pushed-days']) {
    const d = new Date(Date.now() - Number(args['pushed-days']) * 86400000).toISOString().slice(0, 10);
    parts.push(`pushed:>${d}`);
  }
  if (!parts.length) die('--mode repo 至少给一个 --q 或 --topic');

  const limit = Number(args.limit ?? 30);
  const u = new URL('https://api.github.com/search/repositories');
  u.searchParams.set('q', parts.join(' '));
  u.searchParams.set('sort', String(args.sort ?? 'updated'));
  u.searchParams.set('order', 'desc');
  u.searchParams.set('per_page', String(Math.min(100, limit)));
  const d = await getJson(u.toString(), { headers: ghHeaders(token) });
  if (!args.json) console.error(`# 查询: ${parts.join(' ')}  (命中 ${d.total_count})`);
  return (d.items ?? []).slice(0, limit).map((r) => ({
    repo: r.full_name,
    url: r.html_url,
    description: r.description ?? '',
    stars: r.stargazers_count,
    topics: r.topics ?? [],
    pushedAt: r.pushed_at,
    createdAt: r.created_at,
  }));
}

async function main() {
  const args = parseArgs();
  if (args.help || args.h) { console.log(HELP); return; }

  const token = readToken('GITHUB_TOKEN', 'GH_TOKEN');
  const mode = String(args.mode ?? 'code');

  if (mode === 'repo') {
    const rows = await repoSearch(args, token);
    emit(rows, args, [
      { key: 'stars', label: '★', max: 7 },
      { key: 'pushedAt', label: '最近 push', max: 20 },
      { key: 'repo', label: '仓库', max: 40 },
      { key: 'description', label: '描述', max: 70 },
    ]);
    return;
  }
  if (mode !== 'code') die('--mode 只能是 code 或 repo');

  if (!token) {
    die([
      'GitHub Code Search 必须认证，未找到 token。',
      '设置办法（三选一）：',
      '  1) export GITHUB_TOKEN=<你的 PAT>',
      '  2) GITHUB_TOKEN=$(gh auth token) node scripts/demand/github-skill-search.mjs ...',
      '  3) 在 rankup/.env 里加一行 GITHUB_TOKEN=<你的 PAT>',
      '实在没有 token 的退路：改用 --mode repo（仓库搜索，匿名 10 次/分即可），',
      '例如 --mode repo --q "claude skill" --sort updated',
    ].join('\n'));
  }

  const rows = await codeSearch(args, token);
  if (args.fetch) await fetchBodies(rows);
  if (args.enrich) await enrich(rows, token);

  emit(rows, args, args.fetch
    ? [
      { key: 'name', label: 'skill 名', max: 26 },
      { key: 'repo', label: '仓库', max: 32 },
      { key: 'description', label: '它解决什么问题', max: 88 },
    ]
    : [
      { key: 'repo', label: '仓库', max: 40 },
      { key: 'path', label: '路径', max: 46 },
      { key: 'url', label: 'URL', max: 60 },
    ]);
}

main().catch((e) => die(e.message));
