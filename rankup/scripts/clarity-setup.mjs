#!/usr/bin/env node
/**
 * clarity-setup.mjs —— 在 Microsoft Clarity 里创建项目并拿到追踪 ID，
 * 驱动用户已登录的浏览器，不需要 API key。
 *
 * 用法：
 *   # 查看当前账号下所有项目（只读）
 *   node <rankup-skill-dir>/scripts/clarity-setup.mjs status
 *
 *   # 为指定域名创建新项目，返回 project ID
 *   node <rankup-skill-dir>/scripts/clarity-setup.mjs create --site example.com --name example
 *
 * 标志：
 *   --site <域名>     要追踪的域名（不带协议，例如 example.com）
 *   --name <名称>     项目显示名，默认取 --site 的二级域名
 *   --session <名>    opencli 会话名（默认 cls-<pid>）
 *   --keep-session    完成后不关闭会话
 *
 * 依赖：opencli，且用户浏览器已登录 clarity.microsoft.com。
 *
 * ── 为什么是浏览器而不是 API ────────────────────────────────
 *
 * Clarity 有 REST API（api.clarity.ms），但截至 2026-08 它只暴露数据读取端点
 * （heatmaps、session recordings、metrics），不暴露项目创建。
 * 创建项目只能走控制台 UI，所以这里用 OpenCLI 自动化。
 *
 * ── 拿到 ID 之后做什么 ────────────────────────────────────
 *
 * 脚本输出 Clarity project ID（形如 `xzmumryb8r`）。把它写进站点的 <head>：
 *
 *   <script>
 *   (function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
 *   t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
 *   y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
 *   })(window, document, "clarity", "script", "<ID>");
 *   </script>
 *
 * 这段代码是公开值（会出现在页面 HTML 里），不是秘密。
 *
 * 已验证：2026-08-23（中文界面）
 */
import { execSync } from "node:child_process"

// ── 参数 ──────────────────────────────────────────────────
const argv = process.argv.slice(2)
if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") { usage(); process.exit(argv.length === 0 ? 1 : 0) }
const action = argv[0]
let site = null
let name = null
let session = `cls-${process.pid}`
let keepSession = false

for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  if (a === "--site" && argv[i + 1]) { site = argv[++i]; continue }
  if (a === "--name" && argv[i + 1]) { name = argv[++i]; continue }
  if (a === "--session" && argv[i + 1]) { session = argv[++i]; continue }
  if (a === "--keep-session") { keepSession = true; continue }
  if (a === "-h" || a === "--help") { usage(); process.exit(0) }
  console.error(`未知参数: ${a}`); usage(); process.exit(1)
}

function usage() {
  console.log(`用法:
  node clarity-setup.mjs status
  node clarity-setup.mjs create --site <域名> [--name <项目名>]`)
}

if (!["status", "create"].includes(action)) { usage(); process.exit(1) }
if (action === "create" && !site) { console.error("错误：create 需要 --site"); process.exit(1) }
if (action === "create" && !name) name = site.split(".")[0]

// ── OpenCLI 封装 ──────────────────────────────────────────
function cli(action_, { timeout = 30000 } = {}) {
  try {
    return execSync(`opencli browser "${session}" --window background ${action_}`,
      { encoding: "utf-8", timeout, stdio: ["pipe", "pipe", "pipe"] }).trim()
  } catch (e) {
    const err = (e.stderr?.toString() || e.stdout?.toString() || e.message).trim()
    throw new Error(`opencli 失败: ${action_}\n  ${err}`)
  }
}
function evalJs(js) { return cli(`eval '${`(()=>{${js}})()`.replace(/'/g, "'\\''")}'`) }
function open(url) { cli(`open "${url}"`) }
function pageText(max = 4000) {
  return evalJs(`return (document.querySelector('main')||document.body).innerText.replace(/\\n{2,}/g,'\\n').slice(0,${max})`)
}
function sleep(ms) { execSync(`sleep ${ms / 1000}`) }

function stampAndClick(js, label) {
  evalJs(`const el=${js};if(!el)throw new Error('找不到: ${label}');el.setAttribute('data-rankup-target','1')`)
  cli('click "[data-rankup-target=\\"1\\"]"')
  evalJs(`document.querySelector('[data-rankup-target]')?.removeAttribute('data-rankup-target')`)
}

// ── status：列出所有项目 ──────────────────────────────────
async function doStatus() {
  open("https://clarity.microsoft.com/projects")
  sleep(5000)

  const text = pageText(8000)
  if (text.includes("Sign in") || text.includes("登录")) {
    console.error("❌ 未登录 Clarity。请先在浏览器中登录 clarity.microsoft.com")
    return process.exit(1)
  }

  console.log("── Clarity 项目列表 ──")
  console.log(text)
}

// ── create：新建项目 ──────────────────────────────────────
async function doCreate() {
  open("https://clarity.microsoft.com/projects")
  sleep(5000)

  const text = pageText()
  if (text.includes("Sign in") || text.includes("登录")) {
    console.error("❌ 未登录 Clarity。请先在浏览器中登录 clarity.microsoft.com")
    return process.exit(1)
  }

  // 点击 "+ Add new project" 按钮
  stampAndClick(
    `[...document.querySelectorAll('button')].find(b=>/add.*project|新建项目|添加/i.test(b.textContent))`,
    "Add new project 按钮"
  )
  sleep(3000)

  // 填写项目名称
  const nameInput = `document.querySelector('input[placeholder*="name" i],input[placeholder*="名称" i],input[type="text"]')`
  evalJs(`const el=${nameInput};if(!el)throw new Error('找不到名称输入框');el.focus();el.value='';`)
  cli(`type "${name}"`)
  sleep(500)

  // 填写网站 URL
  const urlInput = `[...document.querySelectorAll('input[type="text"],input[type="url"]')].find(i=>/url|网站|site/i.test(i.placeholder||i.labels?.[0]?.textContent||''))`
  evalJs(`const el=${urlInput};if(!el)throw new Error('找不到 URL 输入框');el.focus();el.value='';`)
  cli(`type "https://${site}"`)
  sleep(500)

  // 选择网站类别（如果有下拉框的话跳过，不是必填项）

  // 点击 "Add" / "添加" 按钮
  stampAndClick(
    `[...document.querySelectorAll('button[type="submit"],button')].find(b=>/^(add|create|添加|创建)$/i.test(b.textContent.trim()))`,
    "Add/创建 按钮"
  )
  sleep(5000)

  // 从跳转后的 URL 或页面内容中提取 project ID
  const finalUrl = evalJs(`return window.location.href`)
  const idMatch = finalUrl.match(/\/projects\/([a-z0-9]+)/) || finalUrl.match(/projectId=([a-z0-9]+)/)
  if (idMatch) {
    console.log(`✅ Clarity 项目创建成功`)
    console.log(`   项目名: ${name}`)
    console.log(`   域名:   ${site}`)
    console.log(`   ID:     ${idMatch[1]}`)
    console.log(`\n追踪代码:`)
    console.log(`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window, document, "clarity", "script", "${idMatch[1]}");`)
    return
  }

  // fallback: 从页面内容提取
  const page = pageText(10000)
  const tagMatch = page.match(/clarity\.ms\/tag\/([a-z0-9]+)/)
  if (tagMatch) {
    console.log(`✅ Clarity 项目创建成功`)
    console.log(`   项目名: ${name}`)
    console.log(`   域名:   ${site}`)
    console.log(`   ID:     ${tagMatch[1]}`)
    return
  }

  console.log("⚠️ 项目可能已创建，但无法自动提取 ID。请检查浏览器页面。")
  console.log("页面内容：")
  console.log(page.slice(0, 2000))
}

// ── 执行 ──────────────────────────────────────────────────
try {
  if (action === "status") await doStatus()
  else await doCreate()
} finally {
  if (!keepSession) {
    try { cli("close") } catch {}
  }
}
