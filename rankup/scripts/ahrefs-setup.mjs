#!/usr/bin/env node
/**
 * ahrefs-setup.mjs —— 在 Ahrefs 里添加项目并启动网站审计，
 * 驱动用户已登录的浏览器，不需要 API key。
 *
 * 用法：
 *   # 查看 Dashboard 上的项目列表（只读）
 *   node <rankup-skill-dir>/scripts/ahrefs-setup.mjs status
 *
 *   # 为指定域名创建新项目
 *   node <rankup-skill-dir>/scripts/ahrefs-setup.mjs create --site shindan.co --name shindan
 *
 * 标志：
 *   --site <域名>     要追踪的域名（不带协议，例如 shindan.co）
 *   --name <名称>     项目显示名，默认取 --site 的二级域名
 *   --session <名>    opencli 会话名（默认 ahs-<pid>）
 *   --keep-session    完成后不关闭会话
 *
 * 依赖：opencli，且用户浏览器已登录 app.ahrefs.com。
 *
 * ── 为什么是浏览器而不是 API ────────────────────────────────
 *
 * Ahrefs API v3 只暴露数据查询端点（backlinks、keywords、SERPs），
 * 不暴露项目管理。创建项目 / 启动 Site Audit 只能走 Dashboard UI。
 *
 * ── 关于所有权验证 ────────────────────────────────────────
 *
 * 项目创建后处于「冻结」状态，需要验证所有权才能使用 Site Audit 等功能。
 * 验证方式推荐 DNS TXT 记录（Cloudflare API 可自动添加）或 HTML 标签。
 * 即使冻结，Site Explorer / Backlinks / Keywords Explorer 等查询功能仍然可用。
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
let session = `ahs-${process.pid}`
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
  node ahrefs-setup.mjs status
  node ahrefs-setup.mjs create --site <域名> [--name <项目名>]`)
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
  open("https://app.ahrefs.com/dashboard")
  sleep(8000)

  const text = pageText(8000)
  if (text.includes("Log in") || text.includes("Sign in")) {
    console.error("❌ 未登录 Ahrefs。请先在浏览器中登录 app.ahrefs.com")
    return process.exit(1)
  }

  console.log("── Ahrefs 项目列表 ──")
  // 提取项目名和域名
  const projects = evalJs(`
    const cards = document.querySelectorAll('[class*="ProjectCard"],[class*="project"]');
    const items = [];
    cards.forEach(c => {
      const name = c.querySelector('h3,h2,[class*="name"],[class*="Name"]')?.textContent?.trim();
      const domain = c.querySelector('[class*="domain"],[class*="url"]')?.textContent?.trim();
      if (name) items.push(name + ' | ' + (domain || ''));
    });
    return items.length ? items.join('\\n') : document.body.innerText.slice(0, 3000);
  `)
  console.log(projects)
}

// ── create：新建项目 ──────────────────────────────────────
async function doCreate() {
  // 直接导航到手动添加项目页面
  open("https://app.ahrefs.com/add-project/scope")
  sleep(5000)

  const text = pageText()
  if (text.includes("Log in") || text.includes("Sign in")) {
    console.error("❌ 未登录 Ahrefs。请先在浏览器中登录 app.ahrefs.com")
    return process.exit(1)
  }

  // 如果到了选择页面（导入/手动），点"手动添加"
  if (text.includes("手动添加") || text.includes("Add manually")) {
    stampAndClick(
      `[...document.querySelectorAll('button,a')].find(b=>/手动添加|Add manually/i.test(b.textContent))`,
      "手动添加按钮"
    )
    sleep(3000)
  }

  // 填写域名
  const domainInput = `document.querySelector('input[placeholder*="域" i],input[placeholder*="domain" i],input[placeholder*="路径" i],input[placeholder*="path" i]')`
  evalJs(`const el=${domainInput};if(!el)throw new Error('找不到域名输入框');el.focus();el.value='';`)
  cli(`type "${site}"`)
  sleep(1000)

  // 填写项目名称（如果输入框已自动填充则跳过）
  const nameInput = `document.querySelector('input[id*="name" i],input[placeholder*="name" i]')`
  const currentName = evalJs(`const el=${nameInput};return el?.value||''`)
  if (!currentName || currentName === "") {
    evalJs(`const el=${nameInput};if(el){el.focus();el.value='';}`)
    cli(`type "${name}"`)
    sleep(500)
  }

  // 等待域名可访问性检查
  console.log("等待域名可访问性检查...")
  sleep(8000)

  // 点击"继续"
  stampAndClick(
    `[...document.querySelectorAll('button')].find(b=>/继续|continue|next/i.test(b.textContent))`,
    "继续按钮"
  )
  sleep(3000)

  // 第 2 步：Web Analytics（跳过）
  const text2 = pageText()
  if (text2.includes("Web Analytics") || text2.includes("分析功能")) {
    stampAndClick(
      `[...document.querySelectorAll('button,a')].find(b=>/不使用.*继续|skip|跳过/i.test(b.textContent))`,
      "跳过分析按钮"
    )
    sleep(3000)
  }

  // 第 3 步：所有权验证（跳过）
  const text3 = pageText()
  if (text3.includes("验证所有权") || text3.includes("Verify ownership")) {
    stampAndClick(
      `[...document.querySelectorAll('button,a')].find(b=>/继续而不验证|skip.*verif|without.*verif/i.test(b.textContent))`,
      "跳过验证按钮"
    )
    sleep(2000)
    // 确认弹窗
    const confirm = pageText()
    if (confirm.includes("跳过验证") || confirm.includes("skip verification")) {
      stampAndClick(
        `[...document.querySelectorAll('button')].find(b=>/是的|yes|skip/i.test(b.textContent))`,
        "确认跳过按钮"
      )
      sleep(3000)
    }
  }

  // 第 4 步：网站审计（使用默认设置完成）
  const text4 = pageText()
  if (text4.includes("网站审计") || text4.includes("Site Audit")) {
    stampAndClick(
      `[...document.querySelectorAll('button')].find(b=>/完成|finish|done/i.test(b.textContent))`,
      "完成按钮"
    )
    sleep(5000)
  }

  console.log(`✅ Ahrefs 项目创建成功`)
  console.log(`   项目名: ${name}`)
  console.log(`   域名:   ${site}`)
  console.log(`   状态:   冻结（需验证所有权后激活 Site Audit）`)
  console.log(`\n验证方式推荐:`)
  console.log(`  - DNS TXT 记录（可通过 Cloudflare API 自动添加）`)
  console.log(`  - HTML 标签（写入站点 <head>）`)
  console.log(`  - 谷歌搜索控制台（如果已连接 Google 账号）`)
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
