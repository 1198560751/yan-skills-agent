#!/usr/bin/env node
/**
 * ahrefs-site-audit.mjs —— 读取 Ahrefs Site Audit 已有的抓取结果，
 * 驱动用户已登录的浏览器。与 ahrefs-setup.mjs 互补：那个负责建项目和验证，这个负责取数。
 *
 * 状态：双证人化改造 2026-08-30（截图链路已实盘验证）。
 * 失败分支不再只留一句结论文案：退出前把「截图 + 页面文本 + manifest(stopReason)」
 * 落进 `.rankup/evidence/ahrefs-site-audit-<ts>/`，会话关闭发生在取证**之后**；
 * `--keep-session` 可以连现场标签页一起留下。
 *
 * 用法：
 *   node <rankup-skill-dir>/scripts/ahrefs-site-audit.mjs projects [--json]
 *   node <rankup-skill-dir>/scripts/ahrefs-site-audit.mjs report <项目|域名片段> <报告> [--json] [--out f]
 *   node <rankup-skill-dir>/scripts/ahrefs-site-audit.mjs routes
 *
 * 标志：
 *   --session <名>   opencli 会话名。**默认固定 `ahrefs-nav`，不要传**——理由见下。
 *   --wait <毫秒>    报告渲染等待上限，默认 20000。不再硬睡这么久：页内轮询到
 *                    「正文长度 > 阈值且连续两拍不变」就提前返回，这个值只是封顶。
 *   --keep-session   完成后不关闭（失败时想留现场标签页也用它）
 *
 * ── 为什么是浏览器而不是 API（实测 2026-08-29）────────────────────
 *
 * 本机这个账号的套餐是**「网站管理员工具（免费）」（AWT）**，不是付费版。
 * AWT 的能力边界很明确：**只能看自己已验证所有权的站点**，
 * 但在这个边界内 Site Audit 是完整的——定期抓取、健康评分、逐类问题报告，
 * 且不消耗任何按次配额。
 *
 * 账号里确实有 API 密钥（范围 `MCP`、限制「无限制」），但：
 *   1. 密钥在页面上是打码的，取出来要么抠 network、要么读剪贴板——
 *      为了省一次浏览器调用去搬运一枚凭据，不划算；
 *   2. `api.ahrefs.com/v3/*` 不带鉴权一律 403，**猜不出免费档到底放行哪几个端点**；
 *      实测 `/v3/public/keyword-difficulty` 之类的猜测路径全是 404，
 *      唯二匿名可用的是 `/v3/public/crawler-ip-ranges` 与 `/v3/public/crawler-ips`（爬虫 IP 段）。
 *   3. 浏览器路径此刻就是通的，且不碰凭据。
 * 想走 API/MCP 的话密钥已经在账号里了（帐号设置 → API密钥），
 * 那是用户自己配 MCP server 的事，不该由脚本去搬。
 *
 * ── 会话名为什么固定 ────────────────────────────────────────
 *
 * Site Audit 的报告页很重，同时加载多个是 Semrush 那类配额站一样的失败形态。
 * 固定会话名 = 并发度 1，daemon 会把多个调用排成一队。**不要给每个 agent 一个名字。**
 *
 * ── 已验证（2026-08-29，扩展 1.0.32 / CLI 1.8.7）──────────────
 *   * `projects` 在 9 个真实项目上跑通（健康评分、已抓取 URL、内链错误数）。
 *   * `report <id> overview` 跑通，返回完整概述文本。
 *   * 报告页需要 ~12 秒渲染；固定短等待会拿到半张页面而**不报错**——
 *     这正是改成「长度稳定判据」的原因。
 *   * `/all-issues` 不是有效路由（返回站内 404 页面），正确的是 `/issues`。
 *   * 2026-09-02：`report <id> data-explorer?...` 直接吃 `issues --json` 里 links 给的原始路径，
 *     拿某条问题的逐 URL 清单（filterId 是动态的，登记不进 ROUTES）。在 4 类问题上跑通。
 */

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { newEvidenceDir, captureScene, writeManifest } from "./lib-scene.mjs";

const BASE = "https://app.ahrefs.com/site-audit";
const SCRIPT = "ahrefs-site-audit";

// 项目内报告路由，2026-08-29 从真实项目页的导航里读出来的。
const ROUTES = {
  overview: "概述：健康评分、抓取分布、HTTP 状态码分布、问题分布",
  issues: "所有问题：逐条问题与影响 URL 数",
  links: "链接：内部链接问题，闸门 1「内链零 404」的取数处",
  redirects: "重定向：301/302/307 与重定向链，配合 seo-box.md 二",
  "html-tags": "HTML 标签：title/description/h1，闸门 2 TDK 的第二双眼睛",
  indexability: "可索引性：noindex、canonical、robots 阻挡",
  performance: "效果：慢页面、体积过大的资源",
  images: "图片：过大 / 缺 alt",
  localization: "本地化：hreflang 问题（多语言站）",
  "content-quality": "内容：重复、字数过少",
  "social-tags": "社交标签：OG / Twitter Card",
  "internal-urls": "内部页面：全部已抓取内部 URL",
  "external-urls": "外部页面：出站链接",
  "crawl-log": "抓取日志：这次抓了什么、什么被拦了",
  "project-history": "项目历史：健康评分随时间变化",
};

function parseArgs(argv) {
  const pos = [];
  const o = { session: "ahrefs-nav", wait: 20000, json: false, out: null, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session") o.session = argv[++i];
    else if (a === "--wait") o.wait = Number(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--json") o.json = true;
    else if (a === "--keep-session") o.keep = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a.startsWith("--")) {
      console.error(`未知参数：${a}`);
      process.exit(1);
    } else pos.push(a);
  }
  return { pos, o };
}

function browser(session, args, timeoutMs = 200_000) {
  return execFileSync("opencli", ["browser", session, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/* ── 取证（铁律 1/2：先取证，后死；先取证，后关） ───────────── */

let evidence = null; // 惰性建目录：routes/help 这类不碰浏览器的路径不留空目录
function evidenceDir() {
  if (!evidence) evidence = newEvidenceDir(SCRIPT);
  return evidence;
}

/** 采一幕现场。截图与页面文本各自失败都不抛，错误进 manifest。 */
function scene(o, tag, extra) {
  return captureScene({
    dir: evidenceDir(),
    tag,
    screenshot: (p) => browser(o.session, ["screenshot", p], 90_000),
    pageText: () =>
      browser(o.session, [
        "eval",
        `(()=>{try{return document.body?document.body.innerText:''}catch(e){return 'PAGE_TEXT_FAILED:'+e}})()`,
      ]),
    extra,
  });
}

function closeSession(o) {
  if (o.keep) return;
  try {
    browser(o.session, ["close"], 30_000);
  } catch {
    /* 会话本来就不存在是正常情况 */
  }
}

/**
 * 失败退出的唯一出口：先落现场，再写 stopReason，**然后**才关会话、退出。
 * `extra` 里放已经在手的事实（原始响应、URL、页面对象），不做结论转译。
 */
function bail(o, stopReason, msg, extra) {
  let dir = null;
  try {
    scene(o, `fail-${stopReason}`, extra);
    dir = writeManifest(evidenceDir(), { script: SCRIPT, stopReason, finishedAt: new Date().toISOString() });
  } catch (e) {
    console.error(`（取证失败：${String(e?.message || e).slice(0, 200)}）`);
  }
  console.error(msg);
  if (dir) console.error(`现场已落盘：${dirname(dir)}（截图 + 页面文本 + manifest，判读以它们为准）`);
  if (o.keep) console.error(`会话 ${o.session} 已保留，可去浏览器里看现场标签页。`);
  closeSession(o);
  process.exit(1);
}

// 一次访问打包成一个 batch：含写操作的 batch 整体按写处理，别人插不进来。
function openAndEval(o, url, js) {
  let raw;
  try {
    raw = browser(o.session, [
      "batch",
      "--commands",
      JSON.stringify([{ cmd: "open", args: { url } }, { cmd: "eval", args: { js } }]),
    ]);
  } catch (e) {
    // batch 本身没跑起来（daemon 掉线 / 超时），此时可能连会话都没有，
    // 截图多半也采不到——captureScene 会把这一点如实记进 manifest。
    bail(o, "opencli-failed", `opencli batch 失败：${String(e?.stderr || e?.message || e).slice(0, 400)}`, { url });
  }
  const arr = JSON.parse(raw.slice(raw.indexOf("[")));
  const open = arr.find((x) => x.cmd === "open");
  if (!open?.ok) bail(o, "open-failed", `打开失败：${JSON.stringify(open?.error)}`, { url, steps: arr });
  const ev = arr.find((x) => x.cmd === "eval");
  if (!ev?.ok) bail(o, "eval-failed", `读取失败：${JSON.stringify(ev?.error)}`, { url, steps: arr });
  return JSON.parse(ev.result);
}

// eval 体一律包 IIFE：本环境 eval 上下文跨调用持续，重复声明会抛错且那次调用不执行。
//
// 等待不再是「硬睡 wait 毫秒」：页内轮询，正文长度超过阈值且连续两拍（1s）不变
// 即认为渲染稳定，提前返回；waitMs 只是封顶。慢页面不至于拿到半张页（那不报错、
// 只给一个看着正常的错误答案），快页面也不用白等十几秒。
const readPage = (waitMs) => `(async()=>{
  const deadline = Date.now() + ${Math.max(1000, Number(waitMs) || 20000)};
  let prev = -1, stable = 0;
  while (Date.now() < deadline) {
    const len = document.body ? document.body.innerText.length : 0;
    if (len > 500 && len === prev) { stable++; if (stable >= 2) break; }
    else stable = 0;
    prev = len;
    await new Promise(r=>setTimeout(r,1000));
  }
  const t = document.body ? document.body.innerText.replace(/\\s+/g,' ') : '';
  const links = [...new Set([...document.querySelectorAll('a')]
    .map(a=>a.getAttribute('href')||'').filter(h=>/^\\/site-audit\\/\\d+\\//.test(h)))];
  return JSON.stringify({url: location.href, text: t, textLen: t.length, settled: stable >= 2, links});
})()`;

// 登录判据**只看 URL**，绝不看正文。
// 实测 2026-08-29：早先按正文子串判，被审计站点自己的报告数据触发了误报——
// 一条锚文本 "Sign In →" 和一个 `https://<被审计站>/auth/signin` 链接出现在链接报告里，
// 于是脚本对着一张加载完好的页面报「未登录」。**把目标站的数据读成平台状态，
// 是这类脚本最贵的错误**：它不报错，只是给出一个反向的结论。
function requireLogin(o, page) {
  if (/\/(user\/)?(login|signin|sign-in)(\/|\?|$)/i.test(page.url)) {
    bail(
      o,
      "redirected-to-login",
      "页面被重定向到登录页（判据：URL，不是正文）。请在用户的 Chrome 里登录 app.ahrefs.com 后重试。",
      { finalUrl: page.url },
    );
  }
}

async function cmdProjects(o) {
  const page = openAndEval(o, `${BASE}`, readPage(o.wait));
  requireLogin(o, page);
  const ids = [...new Set(page.links.map((h) => h.match(/^\/site-audit\/(\d+)\//)?.[1]).filter(Boolean))];
  // 项目名与域名从概览表格文本里取；表格是 innerText，Ahrefs 改版会让这里失配，
  // 所以 ids 与 raw 都原样返回，解析失败时仍有东西可用。
  const domains = [...page.text.matchAll(/([a-z0-9-]+(?:\.[a-z0-9-]+)+)\//g)].map((m) => m[1]);
  const out = { projectIds: ids, domainsSeen: [...new Set(domains)], settled: page.settled, raw: page.text };
  if (!ids.length) {
    // 「没解析到 ID」有两个不可分辨的成因：账号确实没有项目，或页面没渲染完/改版。
    // 落现场，让判读者对着截图分辨，不在这里替他选一个。
    scene(o, "projects-no-ids", { finalUrl: page.url, textLen: page.textLen, settled: page.settled });
    writeManifest(evidenceDir(), { script: SCRIPT, stopReason: "projects-empty", finishedAt: new Date().toISOString() });
    console.error(
      `没解析到任何项目 ID（正文 ${page.textLen} 字，渲染稳定=${page.settled}）。` +
        `「账号没有项目」与「页面没渲染完/改版」在此不可分辨——看 ${evidenceDir()} 里的截图与文本判断。`,
    );
  }
  if (o.json) return JSON.stringify(out, null, 2);
  return (
    `项目 ID：${ids.join(", ") || "（没解析到——成因见 stderr 与证据目录）"}\n` +
    `域名：${out.domainsSeen.join(", ")}\n\n${page.text}`
  );
}

async function cmdReport(pos, o) {
  const [, target, route] = pos;
  if (!target || !route) {
    console.error("用法：report <项目ID|域名片段> <报告>。报告清单跑 `routes`。");
    process.exit(1);
  }
  // 2026-09-02：允许直接传 issues 页里抠出来的 data-explorer 相对路径
  // （形如 `data-explorer?columns=...&issueId=...`），用来拿某个问题的逐 URL 清单。
  // 这些路径带 filterId，只能从 `issues --json` 的 links 里取，没法预先登记进 ROUTES。
  const isRawPath = /^data-explorer\?/.test(route);
  if (!ROUTES[route] && !isRawPath) {
    console.error(`未知报告 ${route}。可用：${Object.keys(ROUTES).join(", ")}，或 data-explorer?... 原始路径`);
    process.exit(1);
  }

  let id = /^\d+$/.test(target) ? target : null;
  if (!id) {
    // 域名片段 → 项目 ID 只能靠列表页的顺序对齐，Ahrefs 没在链接上带域名。
    // 对不上就直接报错，不猜——猜错会静默地把另一个站的报告写进 audit.md。
    console.error(
      `本命令需要项目 ID。先跑 \`projects\` 拿到 ID 列表，再用 ID 调本命令。\n` +
        `（Ahrefs 的项目链接里不带域名，"${target}" → ID 的映射只能靠人对一次。）`,
    );
    process.exit(1);
  }

  const page = openAndEval(o, `${BASE}/${id}/${route}`, readPage(o.wait));
  requireLogin(o, page);
  if (/Page not found|找不到|couldn.t find that page/i.test(page.text)) {
    // 这句正则命中的是**站内 404 的文案**，但它也可能来自报告数据本身
    // （被审计站点的页面标题里就含 "Page not found" 的情况见 requireLogin 注释）。
    // 所以不下「路由 404」的结论，落现场让判读者看截图。
    bail(
      o,
      "page-text-matched-404",
      `路由 ${route} 在项目 ${id} 上的页面文本命中了「Page not found」类字样。\n` +
        `可能是项目 ID 不对 / 路由改版，也可能是报告数据本身含这几个词——两者在文本层不可分辨，看截图。`,
      { finalUrl: page.url, route, id, textHead: page.text.slice(0, 500) },
    );
  }
  return o.json ? JSON.stringify({ projectId: id, route, ...page }, null, 2) : page.text;
}

const { pos, o } = parseArgs(process.argv.slice(2));
const cmd = pos[0];

if (o.help || !cmd) {
  console.log(
    "用法：\n" +
      "  ahrefs-site-audit.mjs projects [--json]\n" +
      "  ahrefs-site-audit.mjs report <项目ID> <报告> [--json] [--out f] [--wait ms]\n" +
      "  ahrefs-site-audit.mjs routes\n\n" +
      "会话名固定 ahrefs-nav（并发度 1），不要传 --session。\n" +
      "失败时现场（截图+文本+manifest）落 .rankup/evidence/ahrefs-site-audit-<ts>/。",
  );
  process.exit(0);
}

if (cmd === "routes") {
  for (const [k, v] of Object.entries(ROUTES)) console.log(`${k.padEnd(18)} ${v}`);
  process.exit(0);
}

let text;
try {
  if (cmd === "projects") text = await cmdProjects(o);
  else if (cmd === "report") text = await cmdReport(pos, o);
  else {
    console.error(`未知子命令：${cmd}`);
    process.exit(1);
  }
} catch (e) {
  // 走到这里说明是没被 bail 接住的意外错误（bail 自己 process.exit，不会到这）。
  // 同样先取证再关——finally 关会话毁现场正是旧版最大的坑。
  bail(o, "unexpected-error", `执行失败：${String(e?.message || e).slice(0, 400)}`, { stack: String(e?.stack || "").slice(0, 1000) });
}

// 成功路径：关会话（崩溃时 daemon 不会自动清理，残留会话在用户 Chrome 里就是一个孤儿标签页）。
closeSession(o);

if (o.out) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(o.out, text + "\n");
  console.error(`已写入 ${o.out}`);
} else {
  console.log(text);
}
