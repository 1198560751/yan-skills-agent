#!/usr/bin/env node
/**
 * ads-transparency.mjs —— 从「谁在持续掏钱买流量」里挖需求。
 *
 * 核心假设：广告是要真金白银花钱的。一个广告主如果在同一个方向上持续投放几个月、
 * 上千条素材，说明这块业务的 ROI > 1，需求被验证过了。
 * 反过来，看他们的落地页和广告文案，就是看竞品认为最能打动付费用户的说法。
 *
 * 数据来自 Google 广告透明度中心（Ads Transparency Center）的内部 JSON RPC。
 * 无需 token、无需登录、纯 HTTP，可进 CI。
 *
 * 子命令：
 *   advertisers <关键词>   按品牌名/网域前缀搜，返回广告主（含 ID、所在国、在投广告数区间）
 *                          和相关网域两类建议
 *   creatives              拉某个网域或某个广告主的在投素材（含首末投放时间、落地域名）
 *
 * 用法：
 *   # 谁在这个赛道买广告？在投多少条？
 *   node <rankup-skill-dir>/scripts/demand/ads-transparency.mjs advertisers "<品牌或词>" --region US
 *
 *   # 某个域名当前在投的素材（持续时间越长 = ROI 越被验证）
 *   node <rankup-skill-dir>/scripts/demand/ads-transparency.mjs creatives --domain <域名> --region US --limit 50
 *
 *   # 按广告主 ID 拉（ID 来自 advertisers 子命令）
 *   node <rankup-skill-dir>/scripts/demand/ads-transparency.mjs creatives --advertiser-id AR... --region US
 *
 * 标志：
 *   --region <cc>        两位国家码，默认 US（内部用的是 2000+ISO3166数字码）
 *   --region-code <n>    直接给数字地区码，覆盖 --region（脚本没内置的国家用这个）
 *   --domain <域名>      creatives 用
 *   --advertiser-id <ID> creatives 用，形如 AR<数字>
 *   --limit <n>          默认 40，硬上限 100（见「已知坑」）
 *   --json               输出 JSON
 *   --out <file>         落盘（.jsonl 写 JSON Lines，其它写 JSON）
 *
 * 依赖：无。纯 HTTP，不需要 token，不需要登录。
 *
 * 输出字段（creatives）：
 *   {advertiserId, advertiserName, creativeId, domain, format,
 *    firstShown, lastShown, daysRunning, previewUrl, url}
 * 输出字段（advertisers）：
 *   {name, advertiserId, country, minAds, maxAds, verified, url}
 *
 * 已验证日期：2026-08-23
 *
 * 已知坑：
 *   - 这是逆向出来的内部 RPC（/anji/_/rpc/SearchService/*），字段名全是数字下标，
 *     Google 改一次协议就会断。断掉的表现是返回
 *     `BadRequestException: Trouble converting f.req...`（请求形状错）
 *     或者返回 `{}`（形状对但参数不被接受）。
 *     修复方法：用 opencli 打开 adstransparency.google.com，
 *     hook XMLHttpRequest.prototype.send 抓一次真实 f.req，照抄形状。
 *   - **翻页拿不到**：响应字段 "2" 是 nextPageToken，但把它塞回请求字段 "1"
 *     服务端返回 0 条（实测多种位置都不行，token 疑似绑定浏览器会话）。
 *     所以单次查询上限 = 一次请求能拿的条数，实测 limit=100 可以、limit=500 返回 0。
 *     要拿更多，只能换 --region 或按 --advertiser-id 分片查。
 *   - 响应里的 "4"/"5" 是该查询命中的广告总数区间（比如 600~700），
 *     Google 只给区间不给精确值，脚本原样透出为 totalAdsMin/totalAdsMax。
 *   - firstShown/lastShown 是秒级时间戳；daysRunning 由脚本算出，
 *     它才是「这条素材值不值得抄」的关键：跑了半年还在跑的素材一定是赚钱的。
 *   - 地区码是 2000 + ISO-3166 数字码（US=2840、GB=2826、JP=2392、DE=2276……）。
 *     脚本内置常用国家，其余用 --region-code 手填。
 */
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const RPC = "https://adstransparency.google.com/anji/_/rpc/SearchService"
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

// 地区码 = 2000 + ISO-3166-1 numeric
const ISO_NUM = {
  US: 840, GB: 826, CA: 124, AU: 36, NZ: 554, IE: 372,
  DE: 276, FR: 250, ES: 724, IT: 380, NL: 528, BE: 56, SE: 752, NO: 578,
  DK: 208, FI: 246, PL: 616, PT: 620, CH: 756, AT: 40, CZ: 203, GR: 300,
  JP: 392, KR: 410, CN: 156, TW: 158, HK: 344, SG: 702, MY: 458, TH: 764,
  ID: 360, PH: 608, VN: 704, IN: 356, PK: 586, BD: 50,
  BR: 76, MX: 484, AR: 32, CL: 152, CO: 170, PE: 604,
  ZA: 710, NG: 566, EG: 818, KE: 404, MA: 504,
  RU: 643, TR: 792, UA: 804, IL: 376, AE: 784, SA: 682, QA: 634,
}
const FORMAT = { 1: "image", 2: "video", 3: "text" }

const argv = process.argv.slice(2)
if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
  usage()
  process.exit(argv.length === 0 ? 1 : 0)
}
const cmd = argv[0]
if (!["advertisers", "creatives"].includes(cmd)) fail(`未知子命令：${cmd}`)

const opt = {
  query: null, region: "US", regionCode: null,
  domain: null, advertiserId: null, limit: 40, json: false, out: null,
}
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  if (a === "--region" && argv[i + 1]) { opt.region = argv[++i].toUpperCase(); continue }
  if (a === "--region-code" && argv[i + 1]) { opt.regionCode = Number(argv[++i]); continue }
  if (a === "--domain" && argv[i + 1]) { opt.domain = argv[++i]; continue }
  if (a === "--advertiser-id" && argv[i + 1]) { opt.advertiserId = argv[++i]; continue }
  if (a === "--limit" && argv[i + 1]) { opt.limit = Math.min(100, Number(argv[++i])); continue }
  if (a === "--json") { opt.json = true; continue }
  if (a === "--out" && argv[i + 1]) { opt.out = argv[++i]; continue }
  if (!a.startsWith("--") && !opt.query) { opt.query = a; continue }
  fail(`未知参数：${a}`)
}

const regionCode = opt.regionCode ?? (ISO_NUM[opt.region] ? 2000 + ISO_NUM[opt.region] : null)
if (!regionCode) fail(`不认识地区 ${opt.region}，请用 --region-code <数字>（= 2000 + ISO-3166 数字码）`)

const { rows, meta } = cmd === "advertisers" ? await advertisers() : await creatives()

if (opt.out) {
  const body = opt.out.endsWith(".jsonl")
    ? rows.map((r) => JSON.stringify(r)).join("\n") + "\n"
    : JSON.stringify(rows, null, 2)
  writeFileSync(opt.out, body)
  process.stderr.write(`已写入 ${opt.out}（${rows.length} 条）\n`)
}
if (meta) process.stderr.write(`[meta] ${JSON.stringify(meta)}\n`)
if (opt.json) console.log(JSON.stringify(rows, null, 2))
else printTable(rows)
if (!rows.length) process.stderr.write("没有取到条目：换个关键词/域名，或换 --region；也可能是 RPC 协议变了（见文件头「已知坑」）\n")

// ── advertisers ──────────────────────────────────────────
async function advertisers() {
  if (!opt.query) fail("advertisers 需要一个关键词，例如：advertisers \"<品牌名或域名>\"")
  const j = await rpc("SearchSuggestions", {
    1: opt.query, 2: opt.limit, 3: opt.limit, 4: [regionCode], 5: { 1: 1 },
  })
  const rows = (j?.["1"] ?? []).map((it) => {
    // 建议项有两类：it["1"] 是广告主，it["2"] 是网域
    if (it["2"]?.["1"]) {
      return {
        kind: "domain",
        name: it["2"]["1"],
        advertiserId: null, country: null, minAds: null, maxAds: null, verified: false,
        url: `https://adstransparency.google.com/?region=${opt.region}&domain=${encodeURIComponent(it["2"]["1"])}`,
      }
    }
    const a = it["1"] ?? {}
    return {
      kind: "advertiser",
      name: a["1"] ?? null,
      advertiserId: a["2"] ?? null,
      country: a["3"] ?? null,
      minAds: a["4"]?.["2"]?.["1"] != null ? Number(a["4"]["2"]["1"]) : null,
      maxAds: a["4"]?.["2"]?.["2"] != null ? Number(a["4"]["2"]["2"]) : null,
      verified: a["5"] === true,
      url: a["2"]
        ? `https://adstransparency.google.com/advertiser/${a["2"]}?region=${opt.region}`
        : null,
    }
  })
  rows.sort((x, y) => (y.maxAds ?? 0) - (x.maxAds ?? 0))
  return { rows, meta: null }
}

// ── creatives ────────────────────────────────────────────
async function creatives() {
  if (!opt.domain && !opt.advertiserId) fail("creatives 需要 --domain 或 --advertiser-id")
  const filter = { 8: [regionCode] }
  if (opt.domain) filter[12] = { 1: opt.domain, 2: true }
  if (opt.advertiserId) filter[1] = opt.advertiserId
  const j = await rpc("SearchCreatives", {
    2: opt.limit, 3: filter, 7: { 1: 1, 2: opt.limit },
  })
  const now = Date.now() / 1000
  const rows = (j?.["1"] ?? []).map((c) => {
    const first = c["6"]?.["1"] ? Number(c["6"]["1"]) : null
    const last = c["7"]?.["1"] ? Number(c["7"]["1"]) : null
    return {
      advertiserId: c["1"] ?? null,
      advertiserName: c["12"] ?? null,
      creativeId: c["2"] ?? null,
      domain: c["14"] ?? null,
      format: FORMAT[c["4"]] ?? c["4"] ?? null,
      firstShown: first ? new Date(first * 1000).toISOString().slice(0, 10) : null,
      lastShown: last ? new Date(last * 1000).toISOString().slice(0, 10) : null,
      daysRunning: first ? Math.round(((last ?? now) - first) / 86400) : null,
      previewUrl: c["3"]?.["1"]?.["4"] ?? null,
      html: c["3"]?.["3"]?.["2"] ?? null,
      url: c["1"] && c["2"]
        ? `https://adstransparency.google.com/advertiser/${c["1"]}/creative/${c["2"]}?region=${opt.region}`
        : null,
    }
  })
  rows.sort((a, b) => (b.daysRunning ?? 0) - (a.daysRunning ?? 0))
  return {
    rows,
    meta: {
      totalAdsMin: j?.["4"] != null ? Number(j["4"]) : null,
      totalAdsMax: j?.["5"] != null ? Number(j["5"]) : null,
      note: "totalAds 是 Google 给的区间估计；单次最多取 100 条，翻页 token 不可复用",
    },
  }
}

// ── RPC ──────────────────────────────────────────────────
async function rpc(method, payload) {
  const url = `${RPC}/${method}?authuser=`
  const body = new URLSearchParams({ "f.req": JSON.stringify(payload) })
  let text
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
      body,
    })
    text = await res.text()
  } catch (e) {
    const code = e?.cause?.code ?? ""
    if (!/CERT|SSL|TLS/i.test(String(code))) throw e
    process.stderr.write(`[info] fetch 因证书链失败（${code}），降级用 curl\n`)
    text = execFileSync(
      "curl",
      ["-sS", "-m", "40", "-A", UA, "-H", "content-type: application/x-www-form-urlencoded",
        "--data-urlencode", `f.req=${JSON.stringify(payload)}`, url],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    )
  }
  let j
  try { j = JSON.parse(text) } catch { fail(`${method} 返回的不是 JSON：${text.slice(0, 200)}`) }
  if (typeof j?.["2"] === "string" && j["2"].includes("Exception")) {
    fail(`${method} 请求形状被拒（协议可能变了，见文件头「已知坑」）：\n  ${j["2"].slice(0, 200)}`)
  }
  return j
}

// ── 输出 ──────────────────────────────────────────────────
function printTable(rows) {
  if (!rows.length) return
  const w = (s, n) => String(s ?? "-").replace(/\s+/g, " ").slice(0, n).padEnd(n)
  if (cmd === "advertisers") {
    console.log(`${w("类型", 11)}${w("广告主/网域", 38)}${w("国", 4)}${w("在投广告数", 14)}${w("广告主 ID", 24)}`)
    console.log("-".repeat(93))
    for (const r of rows) {
      console.log(`${w(r.kind, 11)}${w(r.name, 38)}${w(r.country, 4)}${w(`${r.minAds ?? "?"}~${r.maxAds ?? "?"}`, 14)}${w(r.advertiserId, 24)}`)
    }
  } else {
    console.log(`${w("广告主", 26)}${w("落地域名", 22)}${w("类型", 7)}${w("首投", 11)}${w("末投", 11)}${w("跑了(天)", 8)}`)
    console.log("-".repeat(86))
    for (const r of rows) {
      console.log(`${w(r.advertiserName, 26)}${w(r.domain, 22)}${w(r.format, 7)}${w(r.firstShown, 11)}${w(r.lastShown, 11)}${w(r.daysRunning, 8)}`)
    }
  }
  console.log(`\n共 ${rows.length} 条 · region=${opt.region}(${regionCode})`)
}

function fail(msg) { process.stderr.write(`错误：${msg}\n\n`); usage(); process.exit(1) }

function usage() {
  process.stdout.write(`ads-transparency.mjs —— 从 Google 广告透明度中心看「谁在持续掏钱买这块流量」

子命令：
  advertisers <关键词>    搜广告主，看在投广告数量级
  creatives               拉在投素材（--domain 或 --advertiser-id 二选一）

标志：
  --region <cc>         两位国家码，默认 US
  --region-code <n>     数字地区码（= 2000 + ISO-3166 数字码），覆盖 --region
  --domain <域名>       creatives 用
  --advertiser-id <ID>  creatives 用
  --limit <n>           默认 40，上限 100
  --json                输出 JSON
  --out <file>          落盘（.jsonl 为 JSON Lines）

不需要 token，不需要登录。
`)
}
