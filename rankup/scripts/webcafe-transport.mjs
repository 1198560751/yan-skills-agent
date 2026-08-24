/**
 * 用途：new.web.cafe（哥飞社区论坛）的取数传输层。一个开关切换「匿名 HTTP」和
 *       「用户已登录的真实浏览器」，把「要不要登录」这件事从每个调用点收敛到一处。
 *       不是可执行脚本，只被 webcafe-forum.mjs 之类的调用方 import。
 * 依赖：Node 22 内置 fetch；browser 传输需要 opencli + 已登录的 Chrome。
 * 已验证日期：2026-08-24
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 【为什么需要这一层：这个站不是「要登录」或「不要登录」，是同一个端点两副面孔】
 *
 * 实测 `GET /api/ask/bounty/fd0wrgx7fh`（2026-08-24）：
 *
 *   | 传输 | HTTP | 字节 | answers | content | visible | vote_count |
 *   |---|---|---|---|---|---|---|
 *   | 匿名 curl | 200 | 80,941 | 23 条**全在** | **空** | false | **0** |
 *   | 已登录浏览器 | 200 | 140,491 | 23 条 | 19,651 字 | true | 26/8/20… |
 *
 * **匿名不会 401，也不会少给条目**——它照样返回 23 条答案、342 个投资人、
 * 每条答案的作者名和 `content_len`，只是把正文换成空串、`visible` 置 false、
 * `vote_count` 归零。这是本文件存在的唯一理由：
 *
 *   **失败是静默的。** 脚本拿到 200、拿到完整数组、拿到正确条数，
 *   一切看起来都对，只有正文是空的。如果调用方不显式检查 `visible`，
 *   它会把「没登录」当成「这条答案是空的」写进结果文件。
 *
 * 所以本层做两件事：`auto` 传输先走免费的 HTTP，**发现被降级了才升级到浏览器**；
 * 以及把降级判据 (`gated`) 做成调用方必须显式提供的参数，逼它想清楚
 * 「对这个端点来说，什么叫拿到的数据不完整」。
 *
 * 【三种传输怎么选】
 *   http     纯公开 HTTP，无依赖、可并发、给别人用零门槛。**元数据够用就停在这。**
 *   browser  在用户已登录的页面上下文里 fetch，Cookie 由浏览器自动附带，
 *            **脚本全程碰不到凭据**（不用把会话 Cookie 抠出来存进环境变量）。
 *   auto     默认。先 http，`gated()` 判定被降级则自动升级到 browser。
 *            拿不到浏览器就**如实报告降级**，不假装成功。
 *
 * 【为什么 browser 走「页面内 fetch」而不是 opencli 的 adapter 或读 Cookie】
 * 这个站的会话 Cookie 是 HttpOnly，脚本读不到；要拿就得去翻浏览器的 Cookie 存储，
 * 等于把用户的登录凭据抠出来落盘。页面内 fetch 这条路，凭据从头到尾只存在于浏览器里。
 *
 * 【已知坑】
 *   - **`hasUnlocked` 不是判据，`canSeeAll` 才是。** 悬赏正文是付费解锁的
 *     （`unlock_price:100` 分），但会员账号 `hasUnlocked:false` 却 `canSeeAll:true`
 *     ——照样能看全文。拿 `hasUnlocked` 当判据会误判成「没解锁，去解锁吧」，
 *     而**解锁是要花钱的**。
 *   - 页面内 fetch 是**相对路径**，所以会话必须停在本站 origin 上，
 *     否则打到别的域名去了还照样返回 200（那个站的 404 页面）。`ensureOrigin()` 管这件事。
 *   - **必须显式带 User-Agent**：不带 UA 的请求会被挡（和 seo-webcafe.mjs 同源的坑）。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

export const BASE = "https://new.web.cafe";

/** 不带这个头会被挡。和 seo-webcafe.mjs 是同一个坑，别删。 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/**
 * 会话名就是标签页的所有权声明：两个任务挑同一个名字就共用同一个标签页，
 * 各自读回对方打开的页面——导航报成功、数据是别人的、全程不报错。
 * 所以默认值绝不能是字面常量。后缀取「真正会并发的那个单位」。
 */
export function sessionName(base = "webcafe") {
  const suffix = (
    process.env.OPENCLI_SESSION_SUFFIX ||
    process.env.CLAUDE_CODE_SESSION_ID ||
    process.env.CLAUDE_CODE_HOST_SESSION_ID ||
    String(process.pid)
  )
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 12) || "local";
  return `${base}-${suffix}`;
}

const abs = (p) => (p.startsWith("http") ? p : BASE + p);

/* ───────────────────────────── HTTP（匿名） ───────────────────────────── */

export async function httpGet(path, { timeout = 30000, retries = 2, accept = "application/json" } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(abs(path), {
        redirect: "follow",
        signal: ctl.signal,
        headers: { "user-agent": UA, accept, "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" },
      });
      clearTimeout(t);
      const text = await res.text();
      if ((res.status >= 500 || res.status === 429) && i < retries) {
        lastErr = new Error(`HTTP ${res.status} ${path}`);
        await sleep(800 * (i + 1));
        continue;
      }
      return { status: res.status, text, ok: res.ok };
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (i < retries) await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────── 浏览器（已登录） ─────────────────────────── */

async function opencli(args, { timeout = 120000 } = {}) {
  const { stdout } = await pExecFile("opencli", args, { timeout, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/**
 * 页面内 fetch 是相对路径，所以会话必须先停在本站 origin 上。
 * 不检查的话，会话恰好停在别的网站时，fetch("/api/...") 打到那个站，
 * **返回它的 404 页面，HTTP 仍是 200**——又是一次静默失败。
 */
export async function ensureOrigin(session) {
  try {
    const out = await opencli(["browser", session, "eval", "location.origin"], { timeout: 20000 });
    if (out.includes("new.web.cafe")) return false;
  } catch {
    /* 会话还不存在，往下开 */
  }
  // 默认 background：在用户当前窗口开标签页，不抬窗口、不切走他正在看的标签页。
  await opencli(["browser", session, "--window", "background", "open", BASE + "/"]);
  await sleep(2500);
  return true;
}

/**
 * 在已登录的页面上下文里 GET 一个同源路径。
 * eval 必须包 IIFE：本环境 eval 上下文跨调用持续，裸的声明重复执行会抛错，
 * 而且那次调用**根本没执行**。
 */
export async function browserGet(path, { session, accept = "application/json" } = {}) {
  if (!session) throw new Error("browserGet 需要 session");
  await ensureOrigin(session);
  const url = abs(path);
  const expr =
    `(async()=>{const r=await fetch(${JSON.stringify(url)},{headers:{accept:${JSON.stringify(accept)}},credentials:"include"});` +
    `const t=await r.text();return JSON.stringify({status:r.status,text:t});})()`;
  const out = await opencli(["browser", session, "eval", expr]);
  const trimmed = out.trim();
  const start = trimmed.indexOf("{");
  if (start === -1) throw new Error(`浏览器返回的不是 JSON 信封：${trimmed.slice(0, 200)}`);
  let env;
  try {
    env = JSON.parse(trimmed.slice(start));
  } catch (e) {
    throw new Error(`解析浏览器信封失败（${e.message}）：${trimmed.slice(0, 200)}`);
  }
  return { status: env.status, text: env.text, ok: env.status >= 200 && env.status < 300 };
}

/**
 * 在已登录的页面上下文里 POST 一个同源路径。
 *
 * **只用于「查询式 POST」**——有些搜索接口把参数放 body 里，方法是 POST 但语义是读。
 * 本仓库对 new.web.cafe 的调用只允许 `/api/community/message/search-message`
 * 这类检索端点；**站内还有大量同前缀的 `save-*` / `update-*` / `payment/*` 写端点，
 * 绝不能走这个函数**（那会动用户的真实账号和余额）。
 * 调用方必须自己确认路径在白名单里，见 webcafe-forum.mjs 的 READ_ONLY_POST。
 */
export async function browserPost(path, body, { session } = {}) {
  if (!session) throw new Error("browserPost 需要 session");
  await ensureOrigin(session);
  const url = abs(path);
  const expr =
    `(async()=>{const r=await fetch(${JSON.stringify(url)},{method:"POST",` +
    `headers:{"content-type":"application/json",accept:"application/json"},` +
    `credentials:"include",body:${JSON.stringify(JSON.stringify(body))}});` +
    `const t=await r.text();return JSON.stringify({status:r.status,text:t});})()`;
  const out = await opencli(["browser", session, "eval", expr]);
  const trimmed = out.trim();
  const start = trimmed.indexOf("{");
  if (start === -1) throw new Error(`浏览器返回的不是 JSON 信封：${trimmed.slice(0, 200)}`);
  const env = JSON.parse(trimmed.slice(start));
  return { status: env.status, text: env.text, ok: env.status >= 200 && env.status < 300 };
}

/* ──────────────────────────────── auto ──────────────────────────────── */

/**
 * 取一个 JSON 端点。
 *
 * @param {string} path      `/api/...` 或完整 URL
 * @param {object} opts
 * @param {'auto'|'http'|'browser'} opts.transport
 * @param {string}  opts.session   browser/auto 升级时用的会话名
 * @param {(json:any)=>boolean} opts.gated
 *        **判定「这份数据被匿名降级了」的谓词，调用方必须自己给。**
 *        它不是「有没有报错」，而是「字段在不在、正文空不空」——
 *        因为这个站降级时照样返回 200 和完整数组。
 * @returns {{json:any, transport:'http'|'browser', degraded:boolean, status:number}}
 *        `degraded:true` 表示**确实没拿全**（想升级但没有浏览器 / 升级后依然被挡）。
 *        调用方必须把它透传给用户，不许当成成功。
 */
export async function getJson(path, { transport = "auto", session, gated } = {}) {
  const parse = (r, via) => {
    let json;
    try {
      json = JSON.parse(r.text);
    } catch {
      throw new Error(
        `${via} 返回的不是 JSON（HTTP ${r.status}）：${String(r.text).slice(0, 200)}`,
      );
    }
    return json;
  };

  if (transport === "browser") {
    const r = await browserGet(path, { session });
    const json = parse(r, "浏览器");
    return { json, transport: "browser", degraded: gated ? gated(json) : false, status: r.status };
  }

  const r = await httpGet(path);
  const json = parse(r, "匿名 HTTP");
  const isGated = gated ? gated(json) : false;

  if (transport === "http") {
    return { json, transport: "http", degraded: isGated, status: r.status };
  }

  // auto：只有确认被降级了才去开浏览器。没被降级就不动用户的 Chrome。
  if (!isGated) return { json, transport: "http", degraded: false, status: r.status };

  try {
    const br = await browserGet(path, { session: session || sessionName() });
    const bjson = parse(br, "浏览器");
    return {
      json: bjson,
      transport: "browser",
      degraded: gated ? gated(bjson) : false,
      status: br.status,
    };
  } catch (e) {
    // 升级失败要如实报告，不能把降级过的数据当完整数据返回。
    return {
      json,
      transport: "http",
      degraded: true,
      status: r.status,
      upgradeError: e.message,
    };
  }
}

/**
 * 取 HTML（SSR 页面用）。经验/话题这类页面没有内容 API，只能从 HTML 里抠。
 *
 * **这里没有 auto 档，是故意的。** SSR 的降级特征（`markdown` 被抹成空串）藏在
 * RSC payload 里，本层只拿得到 HTML 字符串，判不出来。传 `"auto"` 会走 http 分支，
 * 返回值里的 `transport` 会如实写 `"http"`——调用方靠这个字段决定要不要升级。
 * 升级判据在 webcafe-forum.mjs 的 `fetchProps(path, ctx, gated)`。
 */
export async function getHtml(path, { transport = "http", session } = {}) {
  if (transport === "browser") {
    const r = await browserGet(path, { session, accept: "text/html" });
    return { html: r.text, transport: "browser", status: r.status };
  }
  const r = await httpGet(path, { accept: "text/html" });
  return { html: r.text, transport: "http", status: r.status };
}

/** 会话用完必须还回去；崩溃时不会自动清理。**绝不要用 cleanup**（那会关掉别人的标签页）。 */
export async function closeSession(session) {
  try {
    await opencli(["browser", session, "close"], { timeout: 20000 });
  } catch {
    /* 本来就没开就算了 */
  }
}

/** 探针：脚本当前在浏览器里是不是登录态。 */
export async function whoami(session) {
  const r = await browserGet("/api/auth/session", { session });
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
}
