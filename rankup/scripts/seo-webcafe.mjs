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
import { join } from "node:path";

const BASE = "https://seo.web.cafe";
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
  return c ? { cookie: c } : {};
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

async function callOfficial(spec, a) {
  const t = process.env.SEO_WEBCAFE_TOKEN;
  if (!t) die("缺少环境变量 SEO_WEBCAFE_TOKEN（wc_mcp_ 开头，在 /kd/docs 自助生成）。");
  const qs = new URLSearchParams(spec.query(a)).toString();
  const r = await fetch(`${BASE}${spec.path}?${qs}`, { headers: { Authorization: `Bearer ${t}` } });
  const txt = await r.text();
  return { status: r.status, data: safeJson(txt), raw: txt };
}

async function callSession(spec, a) {
  const auth = await toolAuth(spec.tool);
  const method = spec.method || "POST";
  const opt = { method, headers: { ...auth, ...authHeaders() } };
  if (method === "POST") {
    opt.headers["content-type"] = "application/json";
    opt.body = JSON.stringify(spec.body(a));
  }
  const r = await fetch(`${BASE}${spec.path}`, opt);
  const txt = await r.text();
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
  if (name === "kd") return `KD ${data.score} ${data.level} · 月搜 ${data.keywordVolume ?? "—"} · 引用域中值 ${data.linkBudget?.quality?.mid ?? "—"}`;
  if (name === "audit") return `得分 ${data.score} ${data.grade} · 失败项 ${(data.categories || []).flatMap((c) => c.checks).filter((c) => c.status === "fail").length}`;
  if (name === "backlink") return `${data.domain} · 质量 ${data.quality?.score ?? "—"}/${data.quality?.level ?? "—"} · 判定 ${data.verdict?.label ?? data.verdict?.text ?? JSON.stringify(data.verdict ?? "—").slice(0, 60)}`;
  if (name === "serp") return `top${(data.results || []).length} · KD ${data.kd ?? "—"}`;
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

配额：访客 10/日、登录 100/日、VIP 500/日，三端共用；另有每分钟 10 次保险丝。
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
