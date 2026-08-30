#!/usr/bin/env node
/**
 * ahrefs-site-audit.mjs —— 读取 Ahrefs Site Audit 已有的抓取结果，
 * 驱动用户已登录的浏览器。与 ahrefs-setup.mjs 互补：那个负责建项目和验证，这个负责取数。
 *
 * 用法：
 *   node <rankup-skill-dir>/scripts/ahrefs-site-audit.mjs projects [--json]
 *   node <rankup-skill-dir>/scripts/ahrefs-site-audit.mjs report <项目|域名片段> <报告> [--json] [--out f]
 *   node <rankup-skill-dir>/scripts/ahrefs-site-audit.mjs routes
 *
 * 标志：
 *   --session <名>   opencli 会话名。**默认固定 `ahrefs-nav`，不要传**——理由见下。
 *   --wait <毫秒>    报告渲染等待，默认 12000（重报表要更久）
 *   --keep-session   完成后不关闭
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
 *   * 报告页需要 ~12 秒渲染；给 5 秒会拿到半张页面而**不报错**。
 *   * `/all-issues` 不是有效路由（返回站内 404 页面），正确的是 `/issues`。
 */

import { execFileSync } from "node:child_process";

const BASE = "https://app.ahrefs.com/site-audit";

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

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const pos = [];
  const o = { session: "ahrefs-nav", wait: 12000, json: false, out: null, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session") o.session = argv[++i];
    else if (a === "--wait") o.wait = Number(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--json") o.json = true;
    else if (a === "--keep-session") o.keep = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a.startsWith("--")) die(`未知参数：${a}`);
    else pos.push(a);
  }
  return { pos, o };
}

function browser(session, args, timeoutMs = 200_000) {
  return execFileSync("opencli", ["browser", session, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// 一次访问打包成一个 batch：含写操作的 batch 整体按写处理，别人插不进来。
function openAndEval(session, url, js) {
  const raw = browser(session, [
    "batch",
    "--commands",
    JSON.stringify([{ cmd: "open", args: { url } }, { cmd: "eval", args: { js } }]),
  ]);
  const arr = JSON.parse(raw.slice(raw.indexOf("[")));
  const open = arr.find((x) => x.cmd === "open");
  if (!open?.ok) die(`打开失败：${JSON.stringify(open?.error)}`);
  const ev = arr.find((x) => x.cmd === "eval");
  if (!ev?.ok) die(`读取失败：${JSON.stringify(ev?.error)}`);
  return JSON.parse(ev.result);
}

// eval 体一律包 IIFE：本环境 eval 上下文跨调用持续，重复声明会抛错且那次调用不执行。
const readPage = (wait) => `(async()=>{
  await new Promise(r=>setTimeout(r,${wait}));
  const t = document.body ? document.body.innerText.replace(/\\s+/g,' ') : '';
  const links = [...new Set([...document.querySelectorAll('a')]
    .map(a=>a.getAttribute('href')||'').filter(h=>/^\\/site-audit\\/\\d+\\//.test(h)))];
  return JSON.stringify({url: location.href, text: t, links});
})()`;

// 登录判据**只看 URL**，绝不看正文。
// 实测 2026-08-29：早先按正文子串判，被审计站点自己的报告数据触发了误报——
// 一条锚文本 "Sign In →" 和一个 `https://<被审计站>/auth/signin` 链接出现在链接报告里，
// 于是脚本对着一张加载完好的页面报「未登录」。**把目标站的数据读成平台状态，
// 是这类脚本最贵的错误**：它不报错，只是给出一个反向的结论。
function requireLogin(page) {
  if (/\/(user\/)?(login|signin|sign-in)(\/|\?|$)/i.test(page.url)) {
    die("Ahrefs 未登录（页面被重定向到登录页）。请在用户的 Chrome 里登录 app.ahrefs.com 后重试。");
  }
}

async function cmdProjects(o) {
  const page = openAndEval(o.session, `${BASE}`, readPage(o.wait));
  requireLogin(page);
  const ids = [...new Set(page.links.map((h) => h.match(/^\/site-audit\/(\d+)\//)?.[1]).filter(Boolean))];
  // 项目名与域名从概览表格文本里取；表格是 innerText，Ahrefs 改版会让这里失配，
  // 所以 ids 与 raw 都原样返回，解析失败时仍有东西可用。
  const domains = [...page.text.matchAll(/([a-z0-9-]+(?:\.[a-z0-9-]+)+)\//g)].map((m) => m[1]);
  const out = { projectIds: ids, domainsSeen: [...new Set(domains)], raw: page.text };
  if (o.json) return JSON.stringify(out, null, 2);
  return (
    `项目 ID：${ids.join(", ") || "（没解析到——账号里可能一个项目都没有）"}\n` +
    `域名：${out.domainsSeen.join(", ")}\n\n${page.text}`
  );
}

async function cmdReport(pos, o) {
  const [, target, route] = pos;
  if (!target || !route) die("用法：report <项目ID|域名片段> <报告>。报告清单跑 `routes`。");
  if (!ROUTES[route]) die(`未知报告 ${route}。可用：${Object.keys(ROUTES).join(", ")}`);

  let id = /^\d+$/.test(target) ? target : null;
  if (!id) {
    const list = openAndEval(o.session, `${BASE}`, readPage(o.wait));
    requireLogin(list);
    // 域名片段 → 项目 ID 只能靠列表页的顺序对齐，Ahrefs 没在链接上带域名。
    // 对不上就直接报错，不猜——猜错会静默地把另一个站的报告写进 audit.md。
    die(
      `本命令需要项目 ID。先跑 \`projects\` 拿到 ID 列表，再用 ID 调本命令。\n` +
        `（Ahrefs 的项目链接里不带域名，"${target}" → ID 的映射只能靠人对一次。）`,
    );
  }

  const page = openAndEval(o.session, `${BASE}/${id}/${route}`, readPage(o.wait));
  requireLogin(page);
  if (/Page not found|找不到|couldn.t find that page/i.test(page.text)) {
    die(`路由 ${route} 在项目 ${id} 上返回站内 404。项目 ID 对不对？`);
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
      "会话名固定 ahrefs-nav（并发度 1），不要传 --session。",
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
  else die(`未知子命令：${cmd}`);
} finally {
  // 崩溃时 daemon 不会自动清理，残留会话在用户 Chrome 里就是一个孤儿标签页。
  if (!o.keep) {
    try {
      browser(o.session, ["close"], 30_000);
    } catch {
      /* 会话本来就不存在是正常情况 */
    }
  }
}

if (o.out) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(o.out, text + "\n");
  console.error(`已写入 ${o.out}`);
} else {
  console.log(text);
}
