#!/usr/bin/env node
/**
 * seo.web.cafe 统一驱动 —— 一个脚本覆盖全部有后端的工具。
 *
 * 为什么是一个脚本而不是每个工具一个：这些工具的调用形状完全一致——
 * 抓工具页 HTML 拿到该工具专属的 X-<TOOL>-Token，再 POST 到 /<工具>/api/<动作>。
 * 差异只在端点名和请求体字段。拆成多个脚本会把同一段取令牌逻辑抄很多遍。
 *
 * 认证：**零配置即可跑**。
 *   - 除 kd 外的全部工具：脚本 GET /<工具>/，从返回的 HTML 里正则抽出令牌与请求头名。
 *     已实测：不带任何 Cookie 也会下发可用令牌，API 正常返回，只是配额停在匿名档 10/日。
 *     想提额再给 SEO_WEBCAFE_COOKIE（登录 100/日、VIP 500/日）。
 *   - kd 走公开 API，需要 SEO_WEBCAFE_TOKEN（wc_mcp_ 开头，在 /kd/docs 自助生成）。
 *
 * 边界：本脚本只读取服务端主动下发给当前访问者的令牌，等同于页面自身的行为。
 * 它不推导、不伪造令牌的生成算法——那属于绕过访问控制，不做。
 *
 * 已验证：2026-08-07（匿名与登录 VIP 两种身份都实测通过）
 * 验证过的端点见 ../references/seo-webcafe.md 的「补录」一节。
 *
 * 已知坑（都踩过，别再踩）：
 *   - worth / backlink / adsense 的请求体字段是 `input`，不是 domain 或 url。
 *     传错会得到「请输入有效的域名或网址」，读起来像值不合法，实际是字段名不对。
 *   - history/api/analyze 返回 SSE 流不是 JSON，本脚本已单独处理。
 *   - 各工具令牌互不通用，必须各取各的。
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://seo.web.cafe";
/**
 * **必须显式带 User-Agent。** 实测不带这个头，任何请求都直接 403 Forbidden，
 * 而且返回的是 HTML 错误页不是 JSON，脚本里表现为「解析失败」而非「被拒绝」，
 * 极难定位。此前能跑是因为运行时恰好带了默认值，属于运气不是设计。
 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const TOKEN_RE = /[0-9]{13}\.[0-9a-f]{64}/;
const HEADER_RE = /X-[A-Z]{2,8}-Token/;

/** 端点契约表。每加一个工具只动这里。 */
const TOOLS = {
  kd: {
    official: true, // 走公开 API + Bearer 令牌
    path: "/kd/api/v1/kd",
    method: "GET",
    query: (a) => ({ keyword: req(a.keyword, "--keyword"), gl: a.gl || "us", hl: a.hl || "en", ...(a.force ? { force: "1" } : {}), ...(a.format ? { format: a.format } : {}) }),
    spacingMs: 6000, // 每分钟 10 次的保险丝
    desc: "关键词难度估算，唯一有公开 API 的工具",
  },
  serp: { tool: "serp", path: "/serp/api/serp", body: (a) => ({ keyword: req(a.keyword, "--keyword"), gl: a.gl || "us" }), desc: "第一页逐位解密" },
  serpPage: { tool: "serp", path: "/serp/api/page", body: (a) => ({ url: req(a.url, "--url"), keyword: req(a.keyword, "--keyword") }), desc: "单个 SERP 结果页的评分" },
  audit: { tool: "audit", path: "/audit/api/analyze", body: (a) => ({ url: req(a.url, "--url"), keyword: req(a.keyword, "--keyword") }), desc: "On Page 体检，40+ 项" },
  review: { tool: "review", path: "/review/api/analyze", body: (a) => ({ url: req(a.url, "--url"), keyword: req(a.keyword, "--keyword") }), desc: "页面军师" },
  worth: { tool: "worth", path: "/worth/api/estimate", body: (a) => ({ input: req(a.input, "--input"), model: a.model || "ai" }), desc: "网站价值估算" },
  backlink: { tool: "backlink", path: "/backlink/api/evaluate", body: (a) => ({ input: req(a.input, "--input") }), desc: "外链报价评估" },
  adsense: { tool: "adsense", path: "/adsense/api/audit", body: (a) => ({ input: req(a.input, "--input") }), desc: "AdSense 过审预检" },
  history: { tool: "history", path: "/history/api/analyze", body: (a) => ({ domain: req(a.input, "--input") }), sse: true, desc: "域名前世，返回 SSE 流" },
  referring: { tool: "referring", path: "/referring/api/summary", method: "GET", desc: "Stripe 引荐流量榜（不计配额）" },
  /**
   * SEO Agent：站内十余个工具的对话入口，会自行调用它们查真实数据再给结论。
   *
   * **和其余工具不同，它强制要求登录**：匿名调用返回
   * `401 {"code":"login"}`，而不是像别的工具那样先放行再扣访客配额。
   * 所以这条命令必须提供 SEO_WEBCAFE_COOKIE，没有替代路径。
   */
  chat: {
    tool: "chat",
    path: "/chat/api/chat",
    body: (a) => ({
      messages: [{ role: "user", content: req(a.ask, "--ask") }],
    }),
    needsLogin: true,
    /**
     * **返回的是 SSE 流，不是 JSON。** `content-type: text/event-stream`，
     * 直接 JSON.parse 会失败并静默得到 null —— 脚本看起来"成功"但内容是空的，
     * 这是最坏的一种失败，因为不报错。
     *
     * 实测事件结构（2026-08-09，登录 VIP 会话）：
     *   event: session  data: {sessionId, created, title}
     *   event: delta    data: {text}                        逐块正文，要按序拼接
     *   event: done     data: {toolCalls, rounds, charged, sessionId}
     *
     * `done` 里的 toolCalls / rounds / charged 必须报出来：不知道它调了哪些
     * 站内工具就拿到结论，等于把一个黑箱当权威。
     */
    chatSse: true,
    desc: "SEO Agent 对话（**必须登录**，匿名 401；返回 SSE 流）",
  },
};

/** 纯客户端工具，没有后端，别去探。 */
const CLIENT_ONLY = ["traffic", "kgr", "money", "influencer", "level", "string", "email"];

function req(v, flag) {
  if (v === undefined || v === null || v === "") die(`缺少必需参数 ${flag}`);
  return v;
}
function die(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const cmd = argv[0];
  const a = {};
  for (let i = 1; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith("--")) die(`未知参数：${t}（用 --help 看用法）`);
    const k = t.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) a[k] = true;
    else { a[k] = next; i++; }
  }
  return { cmd, a };
}

/**
 * Cookie 是**可选**的，只影响配额档位（匿名 10/日、登录 100/日、VIP 500/日）。
 * 已实测：完全不带 Cookie 时，工具页照样下发可用令牌，API 调用正常返回。
 * 所以本脚本零配置即可跑，配额不够时再补 Cookie。
 */
function cookie() {
  return process.env.SEO_WEBCAFE_COOKIE || "";
}
function authHeaders() {
  const c = cookie();
  return c ? { "user-agent": UA, cookie: c } : { "user-agent": UA };
}

/** 抓工具页 HTML，自助取该工具的令牌与请求头名。这一步不消耗查询配额。 */
const tokenCache = new Map();
async function toolAuth(tool) {
  if (tokenCache.has(tool)) return tokenCache.get(tool);
  const r = await fetch(`${BASE}/${tool}/`, { headers: authHeaders() });
  if (!r.ok) die(`取 /${tool}/ 页面失败：HTTP ${r.status}`);
  const html = await r.text();
  const tok = (html.match(TOKEN_RE) || [])[0];
  const hdr = (html.match(HEADER_RE) || [])[0];
  if (!tok || !hdr) {
    die(
      `在 /${tool}/ 的 HTML 里没找到令牌或请求头名。\n` +
        "多半是站点改版了令牌注入方式（不带 Cookie 本来也应该能拿到令牌）。\n" +
        "后者属于正常损耗，请更新本脚本顶部的 TOKEN_RE / HEADER_RE 并回写已验证日期。"
    );
  }
  const auth = { [hdr]: tok };
  tokenCache.set(tool, auth);
  return auth;
}

// gt 合并进来之前,KD 令牌是放在 Skill 目录的 .env 里的(键名 KD_TOKEN),
// 只装一次就一直能用。合并后若只认环境变量,等于要求用户每次 export,
// 是无声的体验倒退,所以这里保留 .env 兜底,两个键名都认。
function officialToken() {
  const fromEnv = process.env.SEO_WEBCAFE_TOKEN || process.env.KD_TOKEN;
  if (fromEnv) return fromEnv.trim();
  const envFile = join(dirname(dirname(fileURLToPath(import.meta.url))), ".env");
  try {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^\s*(SEO_WEBCAFE_TOKEN|KD_TOKEN)\s*=\s*(.+?)\s*$/);
      if (m) return m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* 没有 .env 是正常情况,继续走下面的报错 */
  }
  return null;
}

async function callOfficial(spec, a) {
  const t = officialToken();
  if (!t) {
    die(
      "缺少 KD 令牌(wc_mcp_ 开头,在 https://seo.web.cafe/kd/docs 自助生成)。\n" +
        "两种给法:export SEO_WEBCAFE_TOKEN=...,或写进本 Skill 目录的 .env(KD_TOKEN= 亦可)。",
    );
  }
  const qs = new URLSearchParams(spec.query(a)).toString();
  const r = await fetch(`${BASE}${spec.path}?${qs}`, {
    headers: { Authorization: `Bearer ${t}`, "user-agent": UA },
  });
  const txt = await r.text();
  return { status: r.status, data: safeJson(txt), raw: txt };
}

async function callSession(spec, a) {
  if (spec.needsLogin && !cookie()) {
    die(
      "这条命令必须登录，匿名会被服务端拒绝（401 code=login）。\n" +
        "其余工具匿名可用，只有 SEO Agent 例外。\n" +
        "登录 https://seo.web.cafe 后从开发者工具复制整个 Cookie 请求头，然后\n" +
        "  export SEO_WEBCAFE_COOKIE='...'\n" +
        "本脚本不会代替你登录。"
    );
  }
  const auth = await toolAuth(spec.tool);
  const method = spec.method || "POST";
  const opt = { method, headers: { ...auth, ...authHeaders() } };
  if (method === "POST") {
    opt.headers["content-type"] = "application/json";
    opt.body = JSON.stringify(spec.body(a));
  }
  const r = await fetch(`${BASE}${spec.path}`, opt);
  const txt = await r.text();
  if (spec.chatSse) return { status: r.status, data: parseChatSse(txt), raw: txt };
  if (spec.sse) return { status: r.status, data: { text: parseSse(txt) }, raw: txt };
  return { status: r.status, data: safeJson(txt), raw: txt };
}

function safeJson(t) {
  try { return JSON.parse(t); } catch { return null; }
}

/** history 那类端点返回 `event: delta\ndata: {"text":"…"}`，拼回整段文本。 */
function parseSse(t) {
  return t
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => { try { return JSON.parse(l.slice(5).trim()).text ?? ""; } catch { return ""; } })
    .join("");
}

/**
 * 解析 SEO Agent 的 SSE 流。
 *
 * 与 `parseSse` 分开写，因为这条流有多种事件类型且尾部的 `done` 带元数据。
 * **拼不出正文时必须报错而不是返回空串** —— 静默的空结果会被当成"这个站没问题"。
 */
function parseChatSse(raw) {
  const out = { text: "", sessionId: null, title: null, toolCalls: null, rounds: null, charged: null };
  let sawEvent = false;
  for (const block of raw.split(/\n\n/)) {
    const ev = (block.match(/^event:\s*(\S+)/m) || [])[1];
    const dm = block.match(/^data:\s*(.+)$/m);
    if (!ev || !dm) continue;
    sawEvent = true;
    let d;
    try { d = JSON.parse(dm[1]); } catch { continue; }
    if (ev === "delta" && typeof d.text === "string") out.text += d.text;
    else if (ev === "session") { out.sessionId = d.sessionId ?? out.sessionId; out.title = d.title ?? out.title; }
    else if (ev === "done") {
      out.toolCalls = d.toolCalls ?? null;
      out.rounds = d.rounds ?? null;
      out.charged = d.charged ?? null;
      out.sessionId = d.sessionId ?? out.sessionId;
    } else if (ev === "error") out.error = d.error ?? d.message ?? JSON.stringify(d);
  }
  if (!sawEvent) {
    out.error = "响应里没有任何 SSE 事件。多半是站点改了返回格式，或者请求根本没走到 Agent。";
  } else if (!out.text && !out.error) {
    out.error = "SSE 事件解析到了，但一个 delta 都没有，正文为空。不要把这当作\"没问题\"。";
  }
  return out;
}

/** 零配额普查：抓每个工具页 HTML，抽出它引用的全部 api 路径。 */
async function discover() {
  const tools = [...new Set([...Object.values(TOOLS).map((s) => s.tool).filter(Boolean), "translate", "mine", "domain", ...CLIENT_ONLY])];
  const out = {};
  for (const t of tools) {
    try {
      const html = await fetch(`${BASE}/${t}/`, { headers: authHeaders() }).then((r) => r.text());
      out[t] = {
        header: (html.match(HEADER_RE) || [])[0] || null,
        hasToken: TOKEN_RE.test(html),
        endpoints: [...new Set((html.match(/["'`]api\/[a-z0-9_-]+/g) || []).map((s) => s.slice(1)))],
      };
    } catch (e) {
      out[t] = { error: String(e).slice(0, 80) };
    }
  }
  return out;
}

function summarize(name, data) {
  if (!data) return "（非 JSON 响应）";
  if (name === "kd") {
    // keywordType=brand 时 score 是「衍生内容进入难度」,与通用词不同口径,不标出来会被误读。
    // keywordTrend.ratio >= 1 表示有站正靠这个词快速上升,是时机信号,官方文档专门点名。
    const brand = data.keywordType === "brand" ? " · 品牌词(衍生口径)" : "";
    const r = data.keywordTrend?.ratio;
    const rising = typeof r === "number" && r >= 1 ? ` · 上升期 ratio ${r.toFixed(2)}` : "";
    const newcomer = (data.details || []).some((d) => typeof d.ageYears === "number" && d.ageYears < 2)
      ? " · 有新站进前十"
      : "";
    return `KD ${data.score} ${data.level}${brand} · 月搜 ${data.keywordVolume ?? "—"} · 引用域中值 ${data.linkBudget?.quality?.mid ?? "—"}${rising}${newcomer}`;
  }
  if (name === "audit") return `得分 ${data.score} ${data.grade} · 失败项 ${(data.categories || []).flatMap((c) => c.checks).filter((c) => c.status === "fail").length}`;
  if (name === "backlink") return `${data.domain} · 质量 ${data.quality?.score ?? "—"}/${data.quality?.level ?? "—"} · 判定 ${data.verdict?.label ?? data.verdict?.text ?? JSON.stringify(data.verdict ?? "—").slice(0, 60)}`;
  if (name === "serp") return `top${(data.results || []).length} · KD ${data.kd ?? "—"}`;
  if (name === "chat") {
    if (data.error) return `解析失败：${data.error}`;
    const tc = Array.isArray(data.toolCalls) ? data.toolCalls.join(",") : (data.toolCalls ?? "—");
    return `${data.text.length} 字 · 调用工具 [${tc}] · ${data.rounds ?? "—"} 轮 · 扣 ${data.charged ?? "—"} 积分`;
  }
  if (data.error) return `错误 ${data.code}：${data.error}`;
  return Object.keys(data).slice(0, 8).join(", ");
}

const HELP = `seo.web.cafe 统一驱动

用法:
  node seo-webcafe.mjs <命令> [选项]

命令:
${Object.entries(TOOLS).map(([k, v]) => `  ${k.padEnd(11)} ${v.desc}`).join("\n")}
  endpoints   零配额普查：列出每个工具的请求头名与全部 api 端点
  tools       列出纯客户端工具（无后端，不要去探）

通用选项:
  --out <path>       把完整 JSON 写到文件
  --batch <file>     批量模式，每行一组参数（见下）
  --spacing-ms <ms>  批量时的请求间隔，默认按工具的保险丝取值
  --help             本帮助

批量文件格式：每行一条，用 key=value 空格分隔，例如
  keyword=markdown to pdf
  url=https://example.com/a  keyword=pdf to markdown

环境变量（都是可选的）:
  SEO_WEBCAFE_COOKIE  站点登录会话 Cookie。不给也能跑，只是配额停在匿名档 10/日。
                      要提额就登录后从开发者工具复制整个 Cookie 请求头。脚本不代你登录。
  SEO_WEBCAFE_TOKEN   仅 kd 命令使用的 wc_mcp_ 公开 API 令牌，在 /kd/docs 自助生成。

chat 命令示例:
  node seo-webcafe.mjs chat --ask "帮我看看 https://example.com 这个站还有哪些 SEO 问题"

配额：访客 10/日、登录 100/日、VIP 500/日，三端共用；另有每分钟 10 次保险丝。
**chat 强制登录**，匿名 401；其余命令匿名可用。
/referring/* 不计入配额。7 天内重复查询命中缓存但仍计数。`;

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("--help")) { console.log(HELP); return; }
  const { cmd, a } = parseArgs(argv);

  if (cmd === "tools") { console.log("纯客户端工具（无后端）：" + CLIENT_ONLY.join(", ")); return; }
  if (cmd === "endpoints") {
    const map = await discover();
    console.log(JSON.stringify(map, null, 2));
    if (a.out) { writeFileSync(a.out, JSON.stringify(map, null, 2)); console.error(`已写入 ${a.out}`); }
    return;
  }

  const spec = TOOLS[cmd];
  if (!spec) die(`未知命令：${cmd}（用 --help 看全部命令）`);

  const rows = a.batch
    ? readFileSync(a.batch, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
        .map((l) => Object.fromEntries(l.split(/\s+(?=[a-z]+=)/).map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i), kv.slice(i + 1)]; })))
    : [a];

  const spacing = Number(a.spacingMs ?? spec.spacingMs ?? 0);
  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const args = { ...a, ...rows[i] };
    const res = spec.official ? await callOfficial(spec, args) : await callSession(spec, args);
    const label = args.keyword || args.url || args.input || cmd;
    if (res.status !== 200) {
      console.error(`✗ ${label} → HTTP ${res.status} ${res.raw.slice(0, 120)}`);
    } else {
      console.log(`✓ ${label} → ${summarize(cmd, res.data)}`);
    }
    results.push({ args: rows[i], status: res.status, data: res.data });
    if (spacing && i < rows.length - 1) await new Promise((r) => setTimeout(r, spacing));
  }

  if (a.out) {
    const path = a.out;
    if (path.endsWith("/")) { mkdirSync(path, { recursive: true }); writeFileSync(join(path, `${cmd}.json`), JSON.stringify(results, null, 2)); }
    else writeFileSync(path, JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
    console.error(`已写入 ${path}`);
  }
}

main().catch((e) => die(`执行失败：${e?.message || e}`));
