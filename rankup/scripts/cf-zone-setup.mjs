#!/usr/bin/env node
/**
 * Cloudflare zone 接入（wrangler 没有 zone 命令，这是补它的缺口）。
 *
 * 用法：
 *   node <rankup-skill-dir>/scripts/cf-zone-setup.mjs status <domain>
 *   node <rankup-skill-dir>/scripts/cf-zone-setup.mjs create <domain>
 *
 * 凭据：只从环境变量 CLOUDFLARE_API_TOKEN 读，读不到就退到 <repo>/.cf-token
 * （该文件已被 .gitignore 排除）。真实值不打印、不落盘、不进日志。
 *
 * 需要的权限：Zone > Zone > Edit，资源范围必须是 **All zones**。
 * zone 还不存在，所以 zone-scoped 的 token 建不了它——这是官方文档明确写的。
 * 不要用 Global API Key：它不能限定 scope，泄露即等于整个账号。
 *
 * 已验证：2026-08-21
 */
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const API = "https://api.cloudflare.com/client/v4"

function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN.trim()
  const f = join(process.cwd(), ".cf-token")  // 项目根，须被 gitignore
  if (existsSync(f)) return readFileSync(f, "utf8").trim()
  console.error(`找不到 API token。二选一：
  export CLOUDFLARE_API_TOKEN=...        （当前 shell 有效）
  echo '...' > .cf-token                 （已 gitignore）

token 在 dash.cloudflare.com → My Profile → API Tokens → Create Token → Custom：
  权限  Zone > Zone > Edit
  范围  Zone Resources = All zones      ← 必须 All zones，不能选具体某个 zone
不要用 Global API Key。`)
  process.exit(2)
}

/**
 * 两种凭据的 header 完全不同，认错会得到一个极具误导性的
 * `6003 Invalid request headers`（看着像请求写错了，其实是凭据类型不匹配）：
 *   - API Token（40 字符）  → Authorization: Bearer <token>
 *   - Global API Key（37 字符）→ X-Auth-Email + X-Auth-Key，还必须带账号邮箱
 * 按长度判别，并允许 CLOUDFLARE_EMAIL 覆盖。
 */
function authHeaders() {
  const t = token()
  if (t.length === 37 && /^[0-9a-f]+$/.test(t)) {
    const email = process.env.CLOUDFLARE_EMAIL
    if (!email) {
      console.error(`检测到 Global API Key。它必须配合账号邮箱使用：
  export CLOUDFLARE_EMAIL=你的Cloudflare账号邮箱

强烈建议改用 scoped API Token（Zone>Zone>Edit，范围 All zones）：
Global Key 不能限定范围，泄露即等于整个账号。`)
      process.exit(2)
    }
    return { "X-Auth-Email": email, "X-Auth-Key": t }
  }
  return { Authorization: `Bearer ${t}` }
}

async function cf(path, init = {}) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  })
  const j = await r.json().catch(() => ({}))
  if (!j.success) {
    const msg = (j.errors || []).map((e) => `${e.code} ${e.message}`).join("; ")
    throw new Error(`${init.method || "GET"} ${path} → HTTP ${r.status}: ${msg || "未知错误"}`)
  }
  return j.result
}

function reportZone(z) {
  console.log(`zone       ${z.name}`)
  console.log(`状态       ${z.status}`)
  console.log(`zone id    ${z.id}`)
  if (z.original_name_servers?.length) console.log(`原 NS      ${z.original_name_servers.join(", ")}`)
  console.log(`\n把注册商的 NS 整体替换成这两个（是替换，不是追加）：`)
  for (const ns of z.name_servers || []) console.log(`  ${ns}`)
  if (z.status !== "active") {
    console.log(`\n⚠️ 状态还不是 active。换 NS 之前先在注册商关掉 DNSSEC——`)
    console.log(`   带着旧 DS 记录换 NS 会 SERVFAIL，症状伪装成「NS 还没生效」。`)
    console.log(`   核验：whois -h whois.registry.co ${z.name} | grep -i dnssec   → 要看到 unsigned`)
  }
}

const [cmd, domain] = process.argv.slice(2)
const askedForHelp = process.argv.slice(2).some((a) => a === "-h" || a === "--help")
if (askedForHelp || !cmd || !domain) {
  // 显式 `--help` 是成功，退出码 0；什么都不给才是用法错误。
  const out = askedForHelp ? console.log : console.error
  out("用法: cf-zone-setup.mjs <status|create> <domain>")
  process.exit(askedForHelp ? 0 : 2)
}

const found = await cf(`/zones?name=${encodeURIComponent(domain)}`)
if (found.length) {
  console.log(`zone 已存在，直接读回：\n`)
  reportZone(found[0])
  process.exit(0)
}
if (cmd === "status") {
  console.log(`${domain} 尚未加入这个 Cloudflare 账号。跑 create 加进去。`)
  process.exit(0)
}

const accounts = await cf("/accounts")
if (!accounts.length) throw new Error("这个 token 看不到任何账号——检查 Account Resources 范围")
if (accounts.length > 1) {
  console.error("token 能看到多个账号，请用 CF_ACCOUNT_ID 指定：")
  for (const a of accounts) console.error(`  ${a.name}  ${a.id}`)
  if (!process.env.CF_ACCOUNT_ID) process.exit(2)
}
const accountId = process.env.CF_ACCOUNT_ID || accounts[0].id

const zone = await cf("/zones", {
  method: "POST",
  body: JSON.stringify({ account: { id: accountId }, name: domain, type: "full" }),
})
console.log(`✅ 已创建 zone\n`)
reportZone(zone)
