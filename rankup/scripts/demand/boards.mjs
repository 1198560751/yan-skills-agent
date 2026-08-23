#!/usr/bin/env node
/**
 * boards.mjs —— AI 工具榜单 / 新品发现站统一取数器。
 *
 * 用途：
 *   把「今天有哪些新产品上线 / 哪些站在涨流量 / 哪些站在赚钱 / 哪些目录站值得发外链」
 *   这几类公开榜单，统一成同一套字段吐出来，供下游批量灌进 Similarweb / Semrush /
 *   KD 脚本做验证。核心字段固定为：
 *     { source, rank, name, url, domain, metric, metricLabel, date }
 *   （另有 extra 放各源特有字段，下游可忽略。）
 *
 * 子命令（source）：
 *   producthunt   每日新品榜（名次 / 票数 / 上线日期，可解析产品真实外链域名）
 *   toolify       最新收录的 AI 工具 + 「有收入」榜（按月访问量排，带支付平台标记）
 *   taaft         There's An AI For That（**本机网络下取不到**，见下方「已知坑」）
 *   traffic-cv    流量榜 / 收入榜，可按年月与榜单类型参数化
 *   trustmrr      Stripe 实连的 SaaS 收入榜（MRR / 增长 / 流量 / 总营收 / 每访客收入）
 *   columbus      AI 站外链榜（哪些目录站被最多 AI 工具站引用，DR / dofollow / 频次）
 *
 * 示例：
 *   node boards.mjs producthunt --date 2026-08-22 --limit 30
 *   node boards.mjs producthunt --resolve-urls --resolve-limit 10 --json
 *   node boards.mjs toolify --board new --limit 20
 *   node boards.mjs toolify --board revenue --limit 50 --out revenue.jsonl
 *   node boards.mjs traffic-cv --type traffic --tab new --year 2026 --month 7
 *   node boards.mjs traffic-cv --type revenue --tab top
 *   node boards.mjs trustmrr --board mrr --limit 20 --resolve-domains
 *   node boards.mjs columbus --board ai-backlink-rank --limit 30
 *   node boards.mjs producthunt --json | jq -r '.[].domain' | sort -u   # 喂给下游
 *
 * 依赖：
 *   - Node 22+，零第三方依赖。
 *   - traffic-cv / trustmrr / columbus：**纯 HTTP，无需登录、无需 token**，可进 CI。
 *   - producthunt / toolify：目标站挂了 Cloudflare 托管质询，纯 HTTP 一律 403，
 *     必须用 OpenCLI 驱动本机真实 Chrome（`opencli doctor` 要绿）。不需要登录账号，
 *     只是需要一个能过 CF 质询的真实浏览器。
 *   - producthunt 另有官方 GraphQL API v2 路径：设置环境变量 PRODUCTHUNT_TOKEN
 *     或在 rankup/.env 里写 `PRODUCTHUNT_TOKEN=...`（developer token，
 *     自助申请见 https://api.producthunt.com/v2/docs）。缺失时自动降级到浏览器路径。
 *     **不要把真实 token 写进脚本或文档。**
 *
 * 已验证：2026-08-23
 *   producthunt（浏览器路径）/ toolify（浏览器路径）/ traffic-cv / trustmrr / columbus
 *   都真跑出数。producthunt 的 GraphQL 路径**未验证**（手上没有 token），
 *   代码按官方文档写，首次使用请以浏览器路径的结果为准做交叉核对。
 *   taaft **取不到**：见下。
 *
 * 已知坑（都踩过）：
 *   - taaft：apex 域直接 TLS 握手被切断（ERR_CONNECTION_CLOSED），www 域返回
 *     Cloudflare `cf-mitigated: challenge` 403。本机 Chrome 走直连也连不上，
 *     curl 走代理只能拿到质询页。结论是**环境级不可达**，不是解析问题。
 *     脚本保留了 taaft 子命令，但它会明确报错而不是编造数据。
 *   - producthunt 的外链是 /r/p/<id> 跳转，纯 HTTP 跟随重定向同样被 CF 挡（403）。
 *     真实域名只能靠浏览器实际跳一次拿 location.href，所以 --resolve-urls 很慢
 *     （每个产品一次导航），默认关闭，用 --resolve-limit 控制条数。
 *   - toolify 的 `Best-AI-Tools-revenue` **不给收入数字**，它是「检测到支付平台的
 *     AI 工具」按月访问量排序，metric 因此是访问量，支付平台放在 extra.paymentPlatform。
 *   - toolify /new 没有提交日期字段，顺序即新旧，date 只能记成抓取日。
 *   - trustmrr 榜单本身不带官网域名（website 字段在列表里恒为 null），
 *     必须再打一次 /startup/<slug> 详情页才有，故 --resolve-domains 默认关闭。
 *   - traffic.cv / trustmrr / columbus 都是 Next.js App Router，数据在 RSC flight
 *     分片里，本脚本先把 self.__next_f 分片拼回来再解析；columbus 走服务端渲染的
 *     <table>，选择器（列顺序）比 JSON 更易变，改版会先在这里断。
 *   - OpenCLI 会话名必须是字面常量且带组前缀，脚本用 `demand-b-*`；跑完自动 close。
 *     绝对不要跑 `opencli browser cleanup`，会关掉别人的标签页。
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = resolve(HERE, "..", "..", ".env");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/* ------------------------------------------------------------------ utils */

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function envVar(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(ENV_FILE)) return undefined;
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    if (t.slice(0, i).trim() === key) return t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

async function httpText(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs || 30000);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctl.signal,
      headers: { "user-agent": UA, accept: "*/*", ...(opts.headers || {}) },
    });
    const body = await res.text();
    return { status: res.status, body, url: res.url };
  } finally {
    clearTimeout(t);
  }
}

/** Cloudflare 托管质询的指纹。命中说明必须换浏览器路径，不是解析写错了。 */
const isCfChallenge = (r) => r.status === 403 && /Just a moment|cf_chl_opt|challenges\.cloudflare/.test(r.body);

/** 把 Next.js App Router 的 RSC flight 分片拼回一整条字符串。 */
function flightPayload(html) {
  let out = "";
  const re = /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      out += JSON.parse('"' + m[1] + '"');
    } catch {
      /* 分片本身损坏就跳过，别让一片坏数据废掉整页 */
    }
  }
  return out;
}

/** 从 s 的 startIdx 处开始，按括号配平截出一个完整的 JSON 数组/对象并解析。 */
function sliceJson(s, startIdx) {
  const open = s[startIdx];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(startIdx, i + 1));
    }
  }
  throw new Error("unbalanced JSON while slicing embedded payload");
}

/** 在 flight 文本里找 `"<key>":[` 并解析出那个数组。 */
function arrayAfterKey(payload, key) {
  const needle = `"${key}":[`;
  const i = payload.indexOf(needle);
  if (i < 0) return null;
  return sliceJson(payload, i + needle.length - 1);
}

function hostOf(u) {
  if (!u) return null;
  try {
    return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function stripTracking(u) {
  if (!u) return u;
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|ref_|source$)/i.test(k)) url.searchParams.delete(k);
    }
    return url.toString().replace(/\?$/, "");
  } catch {
    return u;
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/* -------------------------------------------------------------- opencli io */

function opencli(args, timeoutMs = 180000) {
  const r = spawnSync("opencli", args, { encoding: "utf8", timeout: timeoutMs });
  if (r.error) throw new Error(`opencli 调不起来（装了吗？）：${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`opencli ${args.slice(0, 3).join(" ")} 失败：${(r.stderr || r.stdout || "").trim().slice(-500)}`);
  }
  return r.stdout;
}

function browserEval(session, code) {
  const out = opencli(["browser", session, "eval", code]);
  const i = out.indexOf("{");
  const j = out.indexOf("[");
  const start = i < 0 ? j : j < 0 ? i : Math.min(i, j);
  if (start < 0) return null;
  return JSON.parse(out.slice(start));
}

/** 打开页面并等它真的 ready；返回最终 URL（跟完重定向后的）。 */
function browserOpen(session, url, { waitMs = 25000 } = {}) {
  opencli(["browser", session, "--window", "background", "open", url]);
  const deadline = Date.now() + waitMs;
  let last = null;
  while (Date.now() < deadline) {
    sleep(1200);
    try {
      last = browserEval(session, "(()=>({rs:document.readyState,u:location.href,err:location.href.startsWith('chrome-error')}))()");
    } catch {
      continue;
    }
    if (last && last.err) throw new Error(`浏览器连不上 ${url}（chrome-error），多半是本机网络/代理够不着这个站`);
    if (last && last.rs === "complete") return last.u;
  }
  if (!last) throw new Error(`打开 ${url} 后拿不到页面状态`);
  return last.u;
}

function browserClose(session) {
  try {
    opencli(["browser", session, "close"], 60000);
  } catch {
    /* 关不掉不该让整次取数失败，但也别静默到看不见 */
    console.error(`warn: 会话 ${session} 没关干净，手动跑 opencli browser ${session} close`);
  }
}

/* ------------------------------------------------------------ arg parsing */

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const key = (eq < 0 ? a.slice(2) : a.slice(2, eq)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      let val = eq < 0 ? undefined : a.slice(eq + 1);
      if (val === undefined) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          val = next;
          i++;
        } else val = true;
      }
      out[key] = val;
    } else if (a.startsWith("-") && a.length > 1) {
      const key = a.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        out[key] = next;
        i++;
      } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

const num = (v, d) => (v === undefined || v === true ? d : Number(v));

/* -------------------------------------------------------------- 输出与落盘 */

const FIELDS = ["source", "rank", "name", "url", "domain", "metric", "metricLabel", "date"];

function emit(rows, args) {
  if (args.out) {
    const file = String(args.out);
    const body = file.endsWith(".jsonl")
      ? rows.map((r) => JSON.stringify(r)).join("\n") + "\n"
      : JSON.stringify(rows, null, 2) + "\n";
    writeFileSync(file, body);
    console.error(`wrote ${rows.length} rows -> ${file}`);
  }
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (!rows.length) {
    console.log("(no rows)");
    return;
  }
  const cols = FIELDS.filter((f) => rows.some((r) => r[f] !== undefined && r[f] !== null && r[f] !== ""));
  const width = Object.fromEntries(
    cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").slice(0, 46).length))])
  );
  const line = (cells) => cells.map((c, i) => String(c).padEnd(width[cols[i]])).join("  ");
  console.log(line(cols));
  console.log(cols.map((c) => "-".repeat(width[c])).join("  "));
  for (const r of rows) console.log(line(cols.map((c) => String(r[c] ?? "").slice(0, 46))));
}

/* ============================================================ PRODUCT HUNT */

const PH_GQL = "https://api.producthunt.com/v2/api/graphql";

async function phViaGraphql(token, date, limit) {
  const after = `${date}T00:00:00Z`;
  const before = `${date}T23:59:59Z`;
  const query = `query($after:DateTime,$before:DateTime,$n:Int!){
    posts(postedAfter:$after, postedBefore:$before, order:VOTES, first:$n){
      edges{node{ id name tagline slug votesCount commentsCount website url featuredAt }}
    }
  }`;
  const r = await httpText(PH_GQL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables: { after, before, n: Math.min(limit, 50) } }),
  });
  let json;
  try {
    json = JSON.parse(r.body);
  } catch {
    throw new Error(`GraphQL 返回不是 JSON（HTTP ${r.status}）：${r.body.slice(0, 200)}`);
  }
  if (json.errors || json.error) {
    throw new Error(`GraphQL 报错：${JSON.stringify(json.errors || json.error).slice(0, 300)}`);
  }
  const edges = json?.data?.posts?.edges || [];
  return edges.map((e, i) => ({
    source: "producthunt",
    rank: i + 1,
    name: e.node.name,
    // website 是 PH 的跳转链接，真实域名仍需 --resolve-urls 跟一次
    url: e.node.website || e.node.url,
    domain: hostOf(e.node.website),
    metric: e.node.votesCount,
    metricLabel: "upvotes",
    date,
    extra: {
      id: e.node.id,
      slug: e.node.slug,
      tagline: e.node.tagline,
      comments: e.node.commentsCount,
      phUrl: e.node.url,
      via: "graphql",
    },
  }));
}

const PH_EXTRACT = `(()=>{
  const c = window.__APOLLO_CLIENT__ && window.__APOLLO_CLIENT__.cache.extract();
  if(!c) return {error:"no apollo cache"};
  const posts = Object.values(c).filter(v=>v&&v.__typename==="Post"&&v.shortenedUrl);
  return {posts: posts.map(p=>({
    id:p.id, name:p.name, slug:p.slug, tagline:p.tagline,
    dailyRank:p.dailyRank, weeklyRank:p.weeklyRank, monthlyRank:p.monthlyRank,
    votes:p.latestScore, launchDayScore:p.launchDayScore, comments:p.commentsCount,
    featuredAt:p.featuredAt, shortenedUrl:p.shortenedUrl
  }))};
})()`;

async function phViaBrowser(session, date, limit, scrolls) {
  const [y, m, d] = date.split("-").map(Number);
  browserOpen(session, `https://www.producthunt.com/leaderboard/daily/${y}/${m}/${d}`);
  for (let i = 0; i < scrolls; i++) {
    browserEval(session, "(()=>{window.scrollTo(0,document.body.scrollHeight);return 1;})()");
    sleep(1800);
  }
  const res = browserEval(session, PH_EXTRACT);
  if (!res || res.error) throw new Error(`PH 页面里没找到 Apollo 缓存：${res && res.error}`);
  const posts = res.posts
    .filter((p) => !p.featuredAt || p.featuredAt.slice(0, 10) === date)
    .sort((a, b) => Number(a.dailyRank || 999) - Number(b.dailyRank || 999))
    .slice(0, limit);
  return posts.map((p) => ({
    source: "producthunt",
    rank: Number(p.dailyRank) || null,
    name: p.name,
    url: `https://www.producthunt.com${p.shortenedUrl}`,
    domain: null, // 需要 --resolve-urls 才有
    metric: p.votes,
    metricLabel: "upvotes",
    date,
    extra: {
      id: p.id,
      slug: p.slug,
      tagline: p.tagline,
      comments: p.comments,
      weeklyRank: p.weeklyRank,
      monthlyRank: p.monthlyRank,
      phUrl: `https://www.producthunt.com/products/${p.slug}`,
      via: "browser",
    },
  }));
}

/** 无 token、无浏览器时的最后兜底：官方 Atom feed。没有名次、没有票数。 */
async function phViaFeed(limit, date) {
  const r = await httpText("https://www.producthunt.com/feed");
  if (r.status !== 200) throw new Error(`PH feed HTTP ${r.status}`);
  const entries = r.body.split("<entry>").slice(1);
  const rows = [];
  for (const e of entries) {
    const name = (e.match(/<title>([^<]*)<\/title>/) || [])[1];
    const published = (e.match(/<published>([^<]*)<\/published>/) || [])[1];
    const rlink = (e.match(/\/r\/p\/(\d+)/) || [])[1];
    if (!name) continue;
    const day = published ? published.slice(0, 10) : null;
    if (date && day && day !== date) continue;
    rows.push({
      source: "producthunt",
      rank: null,
      name,
      url: rlink ? `https://www.producthunt.com/r/p/${rlink}` : null,
      domain: null,
      metric: null,
      metricLabel: "upvotes",
      date: day,
      extra: { id: rlink, via: "atom-feed" },
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

/** 用浏览器把 /r/p/<id> 跳转跟到底，拿产品真实外链域名。慢，按条计费。 */
function phResolveUrls(session, rows, max) {
  let done = 0;
  for (const row of rows) {
    if (done >= max) break;
    if (!row.url || !/\/r\/(p|ad)\//.test(row.url)) continue;
    try {
      const final = browserOpen(session, `${row.url}${row.url.includes("?") ? "&" : "?"}app_id=339`);
      const host = hostOf(final);
      if (host && !/producthunt\.com$/.test(host)) {
        row.url = stripTracking(final);
        row.domain = host;
      }
    } catch (e) {
      row.extra = { ...row.extra, resolveError: String(e.message).slice(0, 120) };
    }
    done++;
  }
  return rows;
}

async function cmdProducthunt(args) {
  const date = args.date && args.date !== true ? String(args.date) : today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die("--date 要 YYYY-MM-DD");
  const limit = num(args.limit, 30);
  const token = envVar("PRODUCTHUNT_TOKEN");
  const wantBrowser = args.noBrowser !== true && args.browser !== "false";
  const session = "demand-b-producthunt";

  let rows = null;
  let needSession = false;

  if (token) {
    try {
      rows = await phViaGraphql(token, date, limit);
    } catch (e) {
      console.error(`warn: GraphQL 路径失败，降级：${e.message}`);
    }
  } else {
    console.error("note: 没有 PRODUCTHUNT_TOKEN（环境变量或 rankup/.env），走浏览器路径");
  }

  try {
    if (!rows || !rows.length) {
      if (!wantBrowser) {
        rows = await phViaFeed(limit, args.date ? date : null);
        console.error("note: --no-browser，只有 Atom feed 兜底：没有名次、没有票数");
      } else {
        needSession = true;
        rows = await phViaBrowser(session, date, limit, num(args.scrolls, 2));
      }
    }
    if (args.resolveUrls) {
      needSession = true;
      rows = phResolveUrls(session, rows, num(args.resolveLimit, 10));
    }
  } finally {
    if (needSession) browserClose(session);
  }
  return rows;
}

/* ================================================================= TOOLIFY */

const TOOLIFY_BOARDS = {
  new: { path: "/new", label: "monthly visits" },
  revenue: { path: "/Best-AI-Tools-revenue", label: "monthly visits" },
  trending: { path: "/Best-trending-AI-Tools", label: "monthly visits" },
  "most-saved": { path: "/most-saved", label: "monthly visits" },
  "most-used": { path: "/most-used", label: "monthly visits" },
};

const TOOLIFY_EXTRACT = `(()=>{
  const n = window.__NUXT__;
  if(!n || !n.data || !n.data[0]) return {error:"no __NUXT__ payload"};
  const d = n.data[0];
  const prefer = ["toolsList","tableData","list","data","items"];
  let key = prefer.find(k=>Array.isArray(d[k]) && d[k].length && d[k][0] && d[k][0].website);
  if(!key) key = Object.keys(d).find(k=>Array.isArray(d[k]) && d[k].length && d[k][0] && d[k][0].website);
  if(!key) return {error:"payload 里找不到带 website 的列表，页面结构可能改了"};
  // 「Payment Platform」（Stripe / Paypal / Paddle）只存在于渲染出来的表格里，
  // __NUXT__ 负载里没有对应字段（social_media_site_id 是内部枚举，不可靠）。
  // 所以按 website 单元格文本建一张映射再并回去。
  const ths=[...document.querySelectorAll("th")].map(x=>x.innerText.trim());
  const payIdx=ths.indexOf("Payment Platform");
  const payBy={};
  if(payIdx>=0){
    for(const tr of document.querySelectorAll("tbody tr")){
      const c=[...tr.querySelectorAll("td")];
      if(c.length<=payIdx) continue;
      const site=(c[2]&&c[2].innerText.trim())||"";
      const host=site.replace(/^https?:\\/\\//,"").split(/[/?]/)[0];
      if(host) payBy[host]=c[payIdx].innerText.trim()||null;
    }
  }
  const hostOf=u=>String(u||"").replace(/^https?:\\/\\//,"").split(/[/?]/)[0];
  return {key, total:d.total, rows: d[key].map(t=>({
    name:t.name||t.website_name, website:t.website, visits:t.month_visited_count,
    handle:t.handle, desc:t.what_is_summary||t.description,
    payment: payBy[hostOf(t.website)] || null,
    createdAt:t.created_at, isAd:!!t.is_ad,
    categories:(t.categories||[]).map(c=>c.name).slice(0,3)
  }))};
})()`;

async function cmdToolify(args) {
  const boardKey = args.board && args.board !== true ? String(args.board) : "new";
  const path = args.path && args.path !== true ? String(args.path) : (TOOLIFY_BOARDS[boardKey] || {}).path;
  if (!path) die(`--board 只认 ${Object.keys(TOOLIFY_BOARDS).join(" / ")}，或用 --path /任意路径`);
  const limit = num(args.limit, 50);
  const pages = num(args.pages, 1);
  const session = "demand-b-toolify";
  const date = today();
  const rows = [];
  try {
    for (let page = 1; page <= pages && rows.length < limit; page++) {
      const url = `https://www.toolify.ai${path}${page > 1 ? `?page=${page}` : ""}`;
      browserOpen(session, url);
      const res = browserEval(session, TOOLIFY_EXTRACT);
      if (!res || res.error) throw new Error(`toolify 取数失败：${res && res.error}`);
      for (const t of res.rows) {
        if (rows.length >= limit) break;
        if (args.skipAds && t.isAd) continue;
        const url2 = stripTracking(t.website);
        rows.push({
          source: `toolify:${boardKey}`,
          rank: rows.length + 1,
          name: t.name,
          url: url2,
          domain: hostOf(url2),
          metric: t.visits ?? null,
          metricLabel: "monthly visits",
          // toolify /new 没有提交日期字段，只能记抓取日；榜单页有 created_at 时用它
          date: t.createdAt ? String(t.createdAt).slice(0, 10) : date,
          extra: {
            handle: t.handle,
            tagline: t.desc ? String(t.desc).slice(0, 160) : null,
            paymentPlatform: t.payment,
            categories: t.categories,
            isAd: t.isAd,
            listKey: res.key,
          },
        });
      }
    }
  } finally {
    browserClose(session);
  }
  return rows;
}

/* =================================================================== TAAFT */

async function cmdTaaft(args) {
  const board = args.board && args.board !== true ? String(args.board) : "new";
  const paths = { new: "/new/", requests: "/requests/", home: "/" };
  const path = paths[board] || `/${String(board).replace(/^\/|\/$/g, "")}/`;
  const url = `https://www.theresanaiforthat.com${path}`;

  const r = await httpText(url).catch((e) => ({ status: 0, body: String(e.message) }));
  if (isCfChallenge(r) || r.status !== 200) {
    throw new Error(
      [
        `取不到 TAAFT（${url} → HTTP ${r.status || "连不上"}）。`,
        "已实测（2026-08-23）：apex 域 TLS 握手被直接切断，www 域返回 Cloudflare",
        "托管质询（cf-mitigated: challenge）；本机 Chrome 直连也是 ERR_CONNECTION_CLOSED。",
        "这是环境级不可达，不是解析问题。可行做法：换一个能直连该站的出口再跑，",
        "或人工在浏览器里导出。本脚本不编造字段。",
      ].join("\n")
    );
  }
  // 真到得了的环境里再补解析；此处不写未经验证的选择器。
  throw new Error(
    `TAAFT 这次返回了 HTTP 200（${r.body.length} 字节），但本脚本还没有经过验证的解析规则——` +
      "写验证过的解析器需要先能稳定拿到页面。请把这段 HTML 存下来交给维护者补解析。"
  );
}

/* =============================================================== TRAFFIC.CV */

async function cmdTrafficCv(args) {
  const type = String(args.type && args.type !== true ? args.type : "traffic");
  if (!["traffic", "revenue"].includes(type)) die("--type 只认 traffic / revenue");
  const tab = String(args.tab && args.tab !== true ? args.tab : "new");
  if (!["new", "top", "trending"].includes(tab)) die("--tab 只认 new / top / trending");
  const limit = num(args.limit, 50);

  let path = `/leaderboard/${type}/${tab}`;
  if (type === "traffic" && args.year && args.month) {
    path = `/leaderboard/traffic/${Number(args.year)}/${Number(args.month)}/${tab}`;
  }
  const url = `https://traffic.cv${path}`;
  const r = await httpText(url);
  if (r.status !== 200) throw new Error(`traffic.cv HTTP ${r.status} @ ${url}`);
  const payload = flightPayload(r.body);
  const data = arrayAfterKey(payload, "data");
  if (!data || !data.length) throw new Error("traffic.cv 页面里没解析出 data 数组（改版了？）");

  const monthTag = data[0].year && data[0].month ? `${data[0].year}-${String(data[0].month).padStart(2, "0")}` : today().slice(0, 7);
  // 付费墙后的条目 hostname 被打成 `***`，域名对下游没用。默认剔掉，
  // 想看完整名次分布再加 --include-restricted。
  const usable = args.includeRestricted ? data : data.filter((d) => d.hostname && !/^\*+$/.test(d.hostname));
  return usable.slice(0, limit).map((d, i) => {
    const host = d.hostname;
    const isRev = type === "revenue";
    return {
      source: `traffic.cv:${type}-${tab}`,
      rank: d.rank ?? i + 1,
      name: host,
      url: `https://${host}`,
      domain: host,
      metric: isRev ? d.volume : d.visits,
      metricLabel: isRev ? "est. monthly payment volume" : "monthly visits",
      date: monthTag,
      extra: {
        previousVisits: d.previous_visits,
        growth: d.growth,
        deltaSign: d.delta_sign,
        domainCreatedAt: d.domain_created_at ? String(d.domain_created_at).slice(0, 10) : null,
        platform: d.platform,
        share: d.share,
        change: d.change,
        categories: d.categories,
        restricted: !!d.restricted,
        topKeywords: (d.raw?.TopKeywords || []).map((k) => ({ name: k.Name, volume: k.Volume })).slice(0, 5),
      },
    };
  });
}

/* ================================================================ TRUSTMRR */

const TRUSTMRR_BOARDS = {
  mrr: { field: "currentMrr", label: "MRR (USD)" },
  growth: { field: "cachedGrowth30d", label: "30d revenue growth (%)" },
  traffic: { field: "currentLast30DaysRevenue", label: "30d revenue (USD)" },
  revenuePerVisitor: { field: "revenuePerVisitorLast30Days", label: "revenue per visitor (USD)" },
  allTimeRevenue: { field: "currentTotalRevenue", label: "all-time revenue (USD)" },
};

async function trustmrrDomain(slug) {
  const r = await httpText(`https://trustmrr.com/startup/${slug}`).catch(() => null);
  if (!r || r.status !== 200) return null;
  const p = flightPayload(r.body);
  const m = p.match(/"website":"(https?:\/\/[^"]+)"/);
  return m ? m[1] : null;
}

async function cmdTrustmrr(args) {
  const board = String(args.board && args.board !== true ? args.board : "mrr");
  const spec = TRUSTMRR_BOARDS[board];
  if (!spec) die(`--board 只认 ${Object.keys(TRUSTMRR_BOARDS).join(" / ")}`);
  const limit = num(args.limit, 50);

  const r = await httpText("https://trustmrr.com/");
  if (r.status !== 200) throw new Error(`trustmrr HTTP ${r.status}`);
  const payload = flightPayload(r.body);
  const list = arrayAfterKey(payload, board);
  if (!list || !list.length) throw new Error(`trustmrr 首页里没解析出 "${board}" 榜（改版了？）`);

  const rows = list.slice(0, limit).map((s, i) => ({
    source: `trustmrr:${board}`,
    rank: i + 1,
    name: s.name,
    url: `https://trustmrr.com/startup/${s.slug}`,
    domain: hostOf(s.website), // 列表里恒为 null，靠 --resolve-domains 补
    metric: s[spec.field] ?? null,
    metricLabel: spec.label,
    date: today(),
    extra: {
      slug: s.slug,
      tagline: s.description ? String(s.description).slice(0, 160) : null,
      mrr: s.currentMrr,
      totalRevenue: s.currentTotalRevenue,
      last30dRevenue: s.currentLast30DaysRevenue,
      growth30d: s.cachedGrowth30d,
      xHandle: s.xHandle,
      founder: s.xFounderName,
      onSale: s.onSale,
      stealth: s.stealthMode,
    },
  }));

  if (args.resolveDomains) {
    const max = num(args.resolveLimit, rows.length);
    for (let i = 0; i < Math.min(max, rows.length); i++) {
      if (rows[i].domain) continue;
      const site = await trustmrrDomain(rows[i].extra.slug);
      if (site) {
        rows[i].url = stripTracking(site);
        rows[i].domain = hostOf(site);
      }
    }
  }
  return rows;
}

/* ================================================================ COLUMBUS */

const COLUMBUS_BOARDS = {
  "ai-backlink-rank": { metricIdx: 8, label: "citing AI sites" },
  "ai-rank": { metricIdx: null, label: "rank" },
  "ai-keyword-rank": { metricIdx: null, label: "rank" },
};

/**
 * 单元格取文本。**必须先砍掉开标签剩下的属性串**——我们是按 `<td` 切片的，
 * 切完每片开头还挂着 `data-slot="…" class="…">`，不砍就会把 class 里的数字
 * （tabular-nums 之类）当成指标读进来，症状是「排名 1 的频次莫名变成 20537」。
 */
const textOf = (cell) =>
  cell
    .slice(cell.indexOf(">") + 1)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function cmdColumbus(args) {
  const board = String(args.board && args.board !== true ? args.board : "ai-backlink-rank");
  if (!COLUMBUS_BOARDS[board]) die(`--board 只认 ${Object.keys(COLUMBUS_BOARDS).join(" / ")}`);
  const limit = num(args.limit, 50);
  const url = `https://columbus.tools/${board}`;
  const r = await httpText(url);
  if (r.status !== 200) throw new Error(`columbus HTTP ${r.status} @ ${url}`);

  const tb = r.body.slice(r.body.indexOf("<tbody"), r.body.indexOf("</tbody>"));
  if (!tb) throw new Error("columbus 页面里没有 <tbody>（改版了？）");
  const trs = tb.split("<tr").slice(1);
  const rows = [];
  for (const tr of trs) {
    if (rows.length >= limit) break;
    const tds = tr.split("<td").slice(1);
    if (tds.length < 3) continue;
    const cells = tds.map(textOf);
    // 列顺序：# | 域名(+简介) | 近3月 | 站点类型 | 月访问量 | DR | dofollow | 搜索占比 | 出现频次 | 操作
    // 注意：不是每一行都有后两列（非 AI 工具站的行只到「搜索占比」就结束），
    // 所以只能按前 8 列定位，第 9 列存在才当频次读，缺了就是 null。
    const href = (tr.match(/href="(https?:\/\/[^"]+)"/) || [])[1];
    const domain = hostOf(href) || cells[1].split(" ")[0];
    const rank = Number(cells[0]) || rows.length + 1;
    rows.push({
      source: `columbus:${board}`,
      rank,
      name: domain,
      url: href ? stripTracking(href) : `https://${domain}`,
      domain,
      metric: cells[8] ? Number(String(cells[8]).replace(/[^\d.]/g, "")) || cells[8] : null,
      metricLabel: COLUMBUS_BOARDS[board].label,
      date: today(),
      extra: {
        siteType: cells[3] || null,
        monthlyVisits: cells[4] || null,
        dr: cells[5] || null,
        linkType: cells[6] || null,
        searchShare: cells[7] || null,
        tagline: cells[1].replace(domain, "").trim().slice(0, 160) || null,
      },
    });
  }
  if (!rows.length) throw new Error("columbus 解析出 0 行（列结构变了？）");
  return rows;
}

/* ==================================================================== main */

const SOURCES = {
  producthunt: cmdProducthunt,
  toolify: cmdToolify,
  taaft: cmdTaaft,
  "traffic-cv": cmdTrafficCv,
  trustmrr: cmdTrustmrr,
  columbus: cmdColumbus,
};

const HELP = `boards.mjs —— AI 工具榜单 / 新品发现站统一取数器

用法：
  node boards.mjs <source> [options]

source：
  producthunt   PH 每日新品榜（名次/票数/日期，可解析真实外链域名）
  toolify       Toolify 最新收录 / 有收入榜
  taaft         There's An AI For That（本机网络不可达，会明确报错）
  traffic-cv    traffic.cv 流量榜 / 收入榜
  trustmrr      TrustMRR Stripe 实连收入榜
  columbus      columbus.tools AI 站外链榜

通用选项：
  --limit <n>        取前 n 条（默认按源 30~50）
  --json             输出结构化 JSON（默认人类可读表格）
  --out <file>       落盘；.jsonl 结尾写 JSON Lines，否则写 JSON
  -h, --help         本帮助

producthunt：
  --date <YYYY-MM-DD>   榜单日期，默认今天（本地 UTC 日）
  --resolve-urls        跟随 /r/p/ 跳转拿产品真实外链域名（慢，逐条导航）
  --resolve-limit <n>   最多解析几条外链（默认 10）
  --scrolls <n>         榜单页下滑几次以加载更多（默认 2）
  --no-browser          不用浏览器，只用官方 Atom feed 兜底（无名次、无票数）
  token：PRODUCTHUNT_TOKEN（环境变量 → rankup/.env）。有则走官方 GraphQL，无则走浏览器。

toolify：
  --board <k>        new | revenue | trending | most-saved | most-used（默认 new）
  --path </x>        直接指定任意榜单路径，覆盖 --board
  --pages <n>        翻几页（默认 1）
  --skip-ads         过滤 is_ad 的推广位

traffic-cv：
  --type <t>         traffic | revenue（默认 traffic）
  --tab <t>          new | top | trending（默认 new）
  --year <y> --month <m>   仅 traffic 支持按年月取历史榜
  --include-restricted     保留付费墙后 hostname 被打码成 *** 的条目（默认剔除）

trustmrr：
  --board <k>        mrr | growth | traffic | revenuePerVisitor | allTimeRevenue
  --resolve-domains  逐条打详情页补官网域名（榜单本身不带）
  --resolve-limit <n>

columbus：
  --board <k>        ai-backlink-rank | ai-rank | ai-keyword-rank

输出字段（所有源统一）：
  source, rank, name, url, domain, metric, metricLabel, date  (+ extra)

示例：
  node boards.mjs producthunt --date 2026-08-22 --limit 20 --resolve-urls
  node boards.mjs traffic-cv --type traffic --tab new --year 2026 --month 7 --json
  node boards.mjs columbus --limit 30 --out backlink.jsonl
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = args._[0];
  if (args.h || args.help || !source) {
    console.log(HELP);
    process.exit(source ? 0 : 1);
  }
  const fn = SOURCES[source];
  if (!fn) die(`未知 source「${source}」。可选：${Object.keys(SOURCES).join(", ")}`);
  try {
    const rows = await fn(args);
    emit(rows, args);
  } catch (e) {
    die(e.message);
  }
}

main();
