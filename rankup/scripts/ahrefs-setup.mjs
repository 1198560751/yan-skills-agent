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
 *   # 通过 GSC 验证项目所有权
 *   node <rankup-skill-dir>/scripts/ahrefs-setup.mjs verify --site shindan.co
 *
 *   # 启用 Web Analytics（总访问量监控）并获取追踪脚本
 *   node <rankup-skill-dir>/scripts/ahrefs-setup.mjs enable-wa --site shindan.co
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
 * `verify` 子命令通过 GSC（谷歌搜索控制台）自动完成验证：
 *   导航到所有权设置 → 展开 GSC 区域 → 选择 Google 账号 → 等待验证 → 保存。
 * 前提：浏览器已登录 Google 且该 Google 账号在 GSC 中拥有目标站点。
 * 如果 Google 弹出授权窗口，需要用户手动点击同意。
 *
 * ── 关于 Web Analytics ──────────────────────────────────────
 *
 * Ahrefs Web Analytics 是 Ahrefs 自有的流量追踪（独立于 GA4）。
 * Dashboard「总访问量」列需要启用它才会显示数据。
 * `enable-wa` 子命令：导航到 Web Analytics 设置 → 提取 data-key → 保存。
 * 保存后需要将输出的 <script> 标签写入站点 <head> 并部署。
 * 注意：TanStack Start 的 head() scripts 不支持 data-* 属性，
 * 需要在 RootDocument 的 JSX <head> 中直接写 <script> 标签。
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
  node ahrefs-setup.mjs create --site <域名> [--name <项目名>]
  node ahrefs-setup.mjs verify --site <域名>
  node ahrefs-setup.mjs enable-wa --site <域名>`)
}

if (!["status", "create", "verify", "enable-wa"].includes(action)) { usage(); process.exit(1) }
if (["create", "verify", "enable-wa"].includes(action) && !site) { console.error(`错误：${action} 需要 --site`); process.exit(1) }
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

// ── 共通：Dashboard から項目 ID を取得 ──────────────────────
function findProjectId() {
  open("https://app.ahrefs.com/dashboard")
  sleep(8000)

  const text = pageText(8000)
  if (text.includes("Log in") || text.includes("Sign in")) {
    console.error("❌ 未登录 Ahrefs。请先在浏览器中登录 app.ahrefs.com")
    process.exit(1)
  }

  let projectId = evalJs(`
    const links = [...document.querySelectorAll('a[href*="/project-settings/"]')];
    const card = links.find(a => {
      const container = a.closest('[class*="Project"],[class*="project"],article,section,div');
      return container?.textContent?.includes('${site}');
    });
    if (!card) {
      const settingsLink = [...document.querySelectorAll('a')].find(a =>
        a.href?.includes('/project-settings/') &&
        document.body.textContent.includes('${site}')
      );
      if (settingsLink) return settingsLink.href.match(/project-settings\\/(\\d+)/)?.[1] || '';
      return '';
    }
    return card.href.match(/project-settings\\/(\\d+)/)?.[1] || '';
  `)

  if (!projectId) {
    projectId = evalJs(`
      const html = document.body.innerHTML;
      const sitePattern = '${site}'.replace(/\\./g, '\\\\.');
      const re = new RegExp('project-settings/(\\\\d+).*?' + sitePattern + '|' + sitePattern + '.*?project-settings/(\\\\d+)');
      const m = html.match(re);
      return m?.[1] || m?.[2] || '';
    `)
  }

  if (!projectId) {
    console.error(`❌ 找不到域名 ${site} 对应的 Ahrefs 项目。请先用 create 创建。`)
    process.exit(1)
  }

  return projectId
}

// ── verify：通过 GSC 验证所有权 ─────────────────────────────
async function doVerify() {
  const projectId = findProjectId()
  await doVerifyWithId(projectId)
}

async function doVerifyWithId(projectId) {
  console.log(`项目 ID: ${projectId}，导航到所有权验证页面...`)

  // 1. 导航到所有权验证设置页
  open(`https://app.ahrefs.com/project-settings/${projectId}/ownership`)
  sleep(5000)

  // 2. 展开「谷歌搜索控制台（建议）」折叠区域
  const alreadyExpanded = evalJs(`
    const gsc = [...document.querySelectorAll('[class*="accordion"],[class*="Accordion"],details,section')]
      .find(el => /谷歌搜索控制台|Google Search Console/i.test(el.textContent));
    if (!gsc) return 'not_found';
    const expanded = gsc.querySelector('[aria-expanded="true"]') ||
                     gsc.querySelector('.open,[class*="expanded"],[class*="Expanded"]') ||
                     gsc.hasAttribute('open');
    return expanded ? 'expanded' : 'collapsed';
  `)

  if (alreadyExpanded === 'collapsed') {
    stampAndClick(
      `[...document.querySelectorAll('button,[role="button"],summary,h3,h4,div[class*="header"]')].find(el=>/谷歌搜索控制台|Google Search Console/i.test(el.textContent))`,
      "GSC 折叠标题"
    )
    sleep(2000)
  } else if (alreadyExpanded === 'not_found') {
    console.error("❌ 找不到 GSC 验证区域。页面结构可能已变化。")
    return process.exit(1)
  }

  // 3. 检查是否已验证
  const verified = evalJs(`return document.body.innerText.includes('所有权已验证') || document.body.innerText.includes('Ownership verified')`)
  if (verified === "true") {
    console.log(`✅ ${site} 已通过 GSC 验证，无需再次操作。`)
    return
  }

  // 4. 点击「选择谷歌账号」下拉框
  stampAndClick(
    `[...document.querySelectorAll('button,[role="button"],[role="listbox"],[class*="select"],[class*="Select"],[class*="dropdown"],[class*="Dropdown"]')].find(el=>/选择谷歌账号|Select.*Google.*account|选择帐号/i.test(el.textContent))`,
    "选择谷歌账号下拉框"
  )
  sleep(3000)

  // 5. 从下拉选项中选择第一个 Google 账号
  stampAndClick(
    `[...document.querySelectorAll('[role="option"],li[class*="option"],div[class*="option"],button[class*="option"]')].find(el => el.textContent.includes('@'))`,
    "Google 账号选项"
  )
  sleep(8000)

  // 6. 等待验证完成（绿色横幅出现）
  let attempts = 0
  let isVerified = false
  while (attempts < 6 && !isVerified) {
    const check = evalJs(`return document.body.innerText.includes('所有权已验证') || document.body.innerText.includes('Ownership verified') || document.body.innerText.includes('已通过谷歌搜索控制台验证')`)
    if (check === "true") {
      isVerified = true
      break
    }
    sleep(5000)
    attempts++
  }

  if (!isVerified) {
    console.log("⚠️ 验证可能需要 Google 授权弹窗，请在浏览器中手动完成授权后重新运行。")
    return process.exit(1)
  }

  // 7. 点击「保存」按钮
  stampAndClick(
    `[...document.querySelectorAll('button')].find(b=>/^保存$|^Save$/i.test(b.textContent.trim()))`,
    "保存按钮"
  )
  sleep(3000)

  console.log(`✅ ${site} 所有权验证完成并已保存`)
}

// ── enable-wa：启用 Web Analytics 并获取追踪脚本 ────────────
async function doEnableWa() {
  const projectId = findProjectId()
  console.log(`项目 ID: ${projectId}，导航到 Web Analytics 设置...`)

  // 1. 导航到 Web Analytics 设置页
  open(`https://app.ahrefs.com/project-settings/${projectId}/web-analytics`)
  sleep(5000)

  // 2. 提取 data-key
  const dataKey = evalJs(`
    const codeBlock = document.querySelector('code,pre,[class*="code"],[class*="Code"]');
    if (codeBlock) {
      const m = codeBlock.textContent.match(/data-key="([^"]+)"/);
      if (m) return m[1];
    }
    const text = document.body.innerText;
    const m2 = text.match(/data-key="([^"]+)"/);
    if (m2) return m2[1];
    const m3 = text.match(/数据密钥值[：:] *([A-Za-z0-9+/=]+)/);
    return m3?.[1] || '';
  `)

  if (!dataKey) {
    console.error("⚠️ 无法提取 data-key，页面结构可能已变化。请手动查看浏览器。")
    return process.exit(1)
  }

  console.log(`   data-key: ${dataKey}`)

  // 3. 点击「保存」按钮
  stampAndClick(
    `[...document.querySelectorAll('button')].find(b=>/^保存$|^Save$/i.test(b.textContent.trim()))`,
    "保存按钮"
  )
  sleep(5000)

  console.log(`\n✅ Web Analytics 已启用`)
  console.log(`   项目 ID: ${projectId}`)
  console.log(`   域名:    ${site}`)
  console.log(`   data-key: ${dataKey}`)
  console.log(`\n追踪脚本（写入站点 <head>）:`)
  console.log(`<script async src="https://analytics.ahrefs.com/analytics.js" data-key="${dataKey}"></script>`)
  console.log(`\n⚠️  TanStack Start 注意: head() 的 scripts 不支持 data-* 属性，`)
  console.log(`   需要在 RootDocument 的 JSX <head> 中直接写 <script> 标签。`)
}

// ── 执行 ──────────────────────────────────────────────────
try {
  if (action === "status") await doStatus()
  else if (action === "verify") await doVerify()
  else if (action === "enable-wa") await doEnableWa()
  else await doCreate()
} finally {
  if (!keepSession) {
    try { cli("close") } catch {}
  }
}
