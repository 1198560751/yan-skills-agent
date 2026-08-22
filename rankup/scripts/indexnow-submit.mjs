#!/usr/bin/env node
/**
 * indexnow-submit.mjs —— 把站点的 URL 主动推给 IndexNow。
 *
 * IndexNow 是本 Skill 里**唯一不需要任何第三方账号**的索引通道：一个密钥文件
 * 就是全部凭据。Bing、Yandex、Seznam、Naver 共用同一张网，推一次全都收到。
 * Google 不参与——Google 那侧只有 sitemap 和 Search Console。
 *
 * 用法：
 *   # 全量推送（URL 列表从线上 sitemap 取）
 *   node <rankup-skill-dir>/scripts/indexnow-submit.mjs \
 *     --site-url https://example.com --key <32位十六进制>
 *
 *   # 只推指定路径（内容刚改完时用这个，不要每次都全量）
 *   node ... --site-url https://example.com --key <key> /pricing /zh/pricing
 *
 *   # 生成一枚新密钥（只打印，不写文件——写去哪里由项目决定）
 *   node ... --generate-key
 *
 * 标志：
 *   --site-url <url>      站点规范源，含协议，不带尾斜杠。必填（除非 --generate-key）
 *   --key <hex>           IndexNow 密钥。必填。也可用环境变量 INDEXNOW_KEY
 *   --key-location <url>  密钥文件地址（默认 <site-url>/<key>.txt）
 *   --sitemap <url>       URL 列表来源（默认 <site-url>/sitemap.xml）
 *   --file <路径>          从文件读 URL/路径，每行一个（# 开头与空行忽略）
 *   --endpoint <url>      提交端点（默认 https://api.indexnow.org/indexnow）
 *   --max <n>             最多提交多少条（默认 10000，协议上限）
 *   --skip-key-check      跳过密钥文件校验。**不建议**，理由见下
 *   --dry-run             只打印将要提交的 URL
 *   --generate-key        生成一枚合法密钥并退出
 *
 * 依赖：无。纯 HTTP，可无人值守，可进 CI。
 *
 * ── 三个必须知道的坑 ──────────────────────────────────────
 *
 * 1. **密钥文件不可达时，提交被整批丢弃，而接口照样回 200。**
 *    这是本脚本默认先 GET 一次密钥文件的唯一原因：没有这一步，
 *    「推送成功」这句话在密钥没部署、拼错、或被静态资源绑定抢答时**完全一样**地打印出来。
 *    判据是密钥文件的响应体 trim 后**逐字节等于**密钥本身。
 *
 * 2. **URL 列表要从线上 sitemap 取，不要在脚本里维护数组。**
 *    硬编码的数组会和站点实际发布的页面漂移，而漂移的方向永远是「新页面没推」。
 *    从 sitemap 取则天然同步——sitemap 已经是那份清单了。
 *
 * 3. **`host` 必须和 urlList 里每一条的主机名一致**，否则整批 422。
 *    子域算不同主机；`www.` 与非 `www.` 也算不同主机。本脚本会先自查再提交。
 *
 * 已验证：2026-08-23（对一个真实站点连续提交 76 条，HTTP 200；
 *          另测密钥文件返回 404 时本脚本在提交前就退出）
 */
import { readFileSync, existsSync } from "node:fs"
import { randomBytes } from "node:crypto"

// ── 参数解析 ──────────────────────────────────────────────
const argv = process.argv.slice(2)
let siteUrl = null
let key = process.env.INDEXNOW_KEY ?? null
let keyLocation = null
let sitemapUrl = null
let listFile = null
let endpoint = "https://api.indexnow.org/indexnow"
let max = 10000
let skipKeyCheck = false
let dryRun = false
const inputs = []

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === "--site-url" && argv[i + 1]) { siteUrl = argv[++i].replace(/\/+$/, ""); continue }
  if (a === "--key" && argv[i + 1]) { key = argv[++i]; continue }
  if (a === "--key-location" && argv[i + 1]) { keyLocation = argv[++i]; continue }
  if (a === "--sitemap" && argv[i + 1]) { sitemapUrl = argv[++i]; continue }
  if (a === "--file" && argv[i + 1]) { listFile = argv[++i]; continue }
  if (a === "--endpoint" && argv[i + 1]) { endpoint = argv[++i]; continue }
  if (a === "--max" && argv[i + 1]) { max = Number(argv[++i]); continue }
  if (a === "--skip-key-check") { skipKeyCheck = true; continue }
  if (a === "--dry-run") { dryRun = true; continue }
  if (a === "--generate-key") { generateKey(); process.exit(0) }
  if (a === "-h" || a === "--help") { usage(); process.exit(0) }
  if (a.startsWith("-")) { console.error(`未知参数: ${a}`); usage(); process.exit(1) }
  inputs.push(a)
}

function usage() {
  console.log(`用法:
  node indexnow-submit.mjs --site-url <url> --key <hex> [路径或 URL ...]
  node indexnow-submit.mjs --generate-key
  node indexnow-submit.mjs --help

不带路径参数时，URL 列表从 --sitemap（默认 <site-url>/sitemap.xml）读取。`)
}

/**
 * 协议要求密钥是 8–128 位的 [a-zA-Z0-9-]。16 字节十六进制（32 位）
 * 是各家文档里的常见形态，够长且不含需要转义的字符。
 */
function generateKey() {
  const k = randomBytes(16).toString("hex")
  console.log(k)
  console.log()
  console.log(`把它做成两处，缺一不可：`)
  console.log(`  1. 站点上 https://<你的域名>/${k}.txt 返回这一行纯文本（且只有这一行）`)
  console.log(`  2. 提交时用 --key ${k}`)
  console.log()
  console.log(`密钥是公开值——协议就是靠「你能在自己域名上放出它」来证明所有权的，`)
  console.log(`所以它可以进源码、进 git，但要在注释里写明它不是机密，否则后人会当泄露删掉。`)
}

if (!siteUrl) { console.error("错误：缺少 --site-url"); usage(); process.exit(1) }
if (!key) { console.error("错误：缺少 --key（也可设环境变量 INDEXNOW_KEY）"); usage(); process.exit(1) }
if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) {
  console.error(`错误：密钥不合法。协议要求 8–128 位的 [a-zA-Z0-9-]，当前长度 ${key.length}`)
  process.exit(1)
}

let host
try { host = new URL(siteUrl).hostname } catch { console.error(`错误：--site-url 不是合法 URL: ${siteUrl}`); process.exit(1) }
keyLocation ??= `${siteUrl}/${key}.txt`
sitemapUrl ??= `${siteUrl}/sitemap.xml`

// ── 1. 收集 URL ───────────────────────────────────────────
const toAbsolute = (s) => (s.startsWith("http") ? s : `${siteUrl}${s.startsWith("/") ? "" : "/"}${s}`)

let urlList = inputs.map(toAbsolute)

if (listFile) {
  if (!existsSync(listFile)) { console.error(`文件不存在: ${listFile}`); process.exit(1) }
  for (const line of readFileSync(listFile, "utf8").split("\n")) {
    const t = line.trim()
    if (t && !t.startsWith("#")) urlList.push(toAbsolute(t))
  }
}

if (urlList.length === 0) {
  const res = await fetch(sitemapUrl, { headers: { accept: "application/xml" } })
  if (!res.ok) {
    console.error(`sitemap 返回 ${res.status}: ${sitemapUrl}`)
    console.error(`没有 URL 可推。要么修 sitemap，要么用位置参数/--file 显式给出列表。`)
    process.exit(1)
  }
  const xml = await res.text()
  urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
  // sitemap 索引（<sitemapindex>）里的 <loc> 指向的是子 sitemap 而不是页面。
  // 不静默地把它们当页面推上去——那会推一批 XML 文件的地址。
  if (/<sitemapindex/i.test(xml)) {
    console.error(`${sitemapUrl} 是 sitemap 索引，不是 URL 集。`)
    console.error(`逐个子 sitemap 跑本脚本，或用 --file 给出合并后的列表：`)
    urlList.forEach((u) => console.error(`  --sitemap ${u}`))
    process.exit(1)
  }
  console.log(`从 sitemap 取到 ${urlList.length} 条：${sitemapUrl}`)
}

// 去重并保序。sitemap 里出现重复 <loc> 不是罕见事（多语言站尤其），
// 重复条目会白占配额。
urlList = [...new Set(urlList)]

// 坑 3：host 必须与每条 URL 的主机名一致，否则整批 422。
const foreign = urlList.filter((u) => { try { return new URL(u).hostname !== host } catch { return true } })
if (foreign.length > 0) {
  console.error(`错误：${foreign.length} 条 URL 的主机名不是 ${host}，整批会被拒。前几条：`)
  foreign.slice(0, 5).forEach((u) => console.error(`  ${u}`))
  process.exit(1)
}

if (urlList.length > max) {
  console.log(`URL 数 ${urlList.length} 超过 --max ${max}，只提交前 ${max} 条。`)
  urlList = urlList.slice(0, max)
}

if (urlList.length === 0) { console.error("没有 URL 可提交。"); process.exit(1) }

if (dryRun) {
  console.log(`dry-run —— host=${host}, keyLocation=${keyLocation}`)
  urlList.forEach((u, i) => console.log(`  [${i + 1}] ${u}`))
  process.exit(0)
}

// ── 2. 校验密钥文件（坑 1） ────────────────────────────────
if (skipKeyCheck) {
  console.log(`⚠︎ 跳过密钥文件校验。密钥不可达时接口仍会回 200，本次「成功」不构成任何证据。`)
} else {
  let body = ""
  let status = 0
  try {
    const res = await fetch(keyLocation)
    status = res.status
    body = res.ok ? (await res.text()).trim() : ""
  } catch (e) {
    console.error(`密钥文件请求失败: ${keyLocation}\n  ${e.message}`)
    process.exit(1)
  }
  if (body !== key) {
    console.error(`密钥文件校验未通过（HTTP ${status}）：${keyLocation}`)
    console.error(`  期望正文恰好是: ${key}`)
    console.error(`  实际读到:       ${body ? JSON.stringify(body.slice(0, 80)) : "(空)"}`)
    console.error(`\n先把密钥文件部署好再推——现在提交会被整批丢弃，而接口照样回 200。`)
    process.exit(1)
  }
  console.log(`✓ 密钥文件已校验：${keyLocation}`)
}

// ── 3. 提交 ───────────────────────────────────────────────
console.log(`提交 ${urlList.length} 条，host=${host}`)
const res = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host, key, keyLocation, urlList }),
})

// 200 = 已接受；202 = 已接受，密钥待校验。其余都是真拒绝，正文会说原因。
if (res.status !== 200 && res.status !== 202) {
  const text = await res.text().catch(() => "")
  console.error(`IndexNow 拒绝了这批提交：${res.status} ${text}`)
  process.exit(1)
}
console.log(`✓ IndexNow 已接受 ${urlList.length} 条（HTTP ${res.status}）`)
console.log(`  接受 ≠ 收录。收录情况去 Bing Webmaster 看，通常滞后数小时到数天。`)
