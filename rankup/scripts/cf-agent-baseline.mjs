#!/usr/bin/env node
/**
 * Cloudflare Radar「AI Agent Readiness」全网基线 —— 给单站分数配一个分母。
 *
 * 这不是站点扫描器。这个端点没有 `url` 参数，返回的是「全网抽样域名里
 * 有百分之多少通过每一项检查」的聚合统计，不针对任何具体网站。想扫单个
 * 站点用 scripts/is-agentic.mjs。
 *
 * 为什么需要它：is-agentic.mjs 给单站打分，报告里会出现「高级集成 0/8」
 * 这种读起来像缺陷的行。没有分母就没法判断这到底是「你没做」还是
 * 「全网基本没人做」。这份基线告诉你：webMcp 通过率是 0/107985——
 * 一个都没有。追一项全网 0.3% 都不到的检查，价值几乎总是低于它挤占的工作。
 *
 * 认证：零配置可跑。按以下顺序取 token：
 *   1. --token 参数
 *   2. CLOUDFLARE_API_TOKEN 环境变量
 *   3. 本机 wrangler OAuth token（~/.wrangler 或 ~/Library/Preferences/.wrangler
 *      下的 config/default.toml，字段名 oauth_token）——只要本机登录过 wrangler
 *      就有，零配置。
 * token 只用于发起请求，绝不打印、绝不写入任何输出文件、绝不提交。
 *
 * 已验证：2026-08-22，实测调用 https://api.cloudflare.com/client/v4/radar/
 * agent_readiness/summary/CHECK 成功，返回 2026-08-17 数据（107985/160188
 * 个域名扫描成功）。这份数字会漂移，不要凭记忆引用，重新拉一次。
 *
 * 用法：
 *   node cf-agent-baseline.mjs [fetch]                    拉基线，按通过率排序打印
 *   node cf-agent-baseline.mjs fetch --save                同上，并存入 .rankup/agentic/baseline/<date>.json
 *   node cf-agent-baseline.mjs fetch --category <name>     按 domainCategory 过滤
 *   node cf-agent-baseline.mjs fetch --json                原始 JSON，供管道使用
 *   node cf-agent-baseline.mjs --compare <scan.json>       对照 is-agentic.mjs 存下的单站扫描，
 *                                                           把失败项和全网通过率并排显示
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const API = "https://api.cloudflare.com/client/v4/radar/agent_readiness/summary/CHECK";
const UA = "rankup-skill/1.0 (+cf-agent-baseline.mjs)";

// 中文名只用于打印，不参与比对逻辑。
const CHECK_LABELS = {
  robotsTxt: "robots.txt 存在",
  robotsTxtAiRules: "robots.txt 含 AI 爬虫规则",
  sitemap: "sitemap 存在",
  markdownNegotiation: "Markdown 内容协商（Accept: text/markdown）",
  oauthDiscovery: "OAuth Discovery",
  linkHeaders: "HTTP Link 头（RFC 8288）",
  oauthProtectedResource: "OAuth Protected Resource",
  ucp: "UCP（Unified Commerce Protocol）",
  contentSignals: "Content Signals",
  apiCatalog: "API Catalog",
  agentSkills: "Agent Skills",
  mcpServerCard: "MCP Server Card",
  webBotAuth: "Web Bot Auth",
  a2aAgentCard: "A2A Agent Card",
  acp: "ACP（Agentic Commerce Protocol）",
  mpp: "MPP",
  x402: "x402",
  ap2: "AP2",
  webMcp: "WebMCP",
};

/**
 * is-agentic.mjs 单站扫描 issue.id → 本端点检查项 key 的映射。
 *
 * 只收录「同一个检查行为」的确认对应，不猜、不硬凑。目前只有一条：
 * is-agentic 的 markdown-negotiation-vary 检查的正是 Accept: text/markdown
 * 内容协商 + Vary: Accept 头，与 Radar 的 markdownNegotiation 是同一件事。
 *
 * is-agentic 的其余检查项（404 语义、无 JS 内容、品牌可发现性、
 * agent-instruction 文件措辞、Organization schema 完整度、trust anchor
 * 页面）在这个端点里没有对应的全网统计——Radar 不测这些。不要为了凑数
 * 硬映射，宁可留空。
 */
const ID_MAP = {
  "markdown-negotiation-vary": "markdownNegotiation",
};

// ── 参数解析 ─────────────────────────────────────────────────────────────

function usage() {
  console.log(`用法：
  node cf-agent-baseline.mjs [fetch]                拉全网基线，按通过率排序打印
  node cf-agent-baseline.mjs fetch --save           同上，存入 .rankup/agentic/baseline/<date>.json
  node cf-agent-baseline.mjs fetch --category <name> 按 domainCategory 过滤（有效值见输出中的报错）
  node cf-agent-baseline.mjs fetch --json            原始 JSON（供管道）
  node cf-agent-baseline.mjs --compare <scan.json>   对照 is-agentic.mjs 的单站扫描 JSON，
                                                      把失败/部分通过项和全网通过率并排显示

选项：
  --save            结果写入当前目录下 .rankup/agentic/baseline/<date>.json
  --category <name> 按 domainCategory 过滤（如 Technology）
  --json            原始 JSON 输出
  --token <token>   显式传 Cloudflare API token（否则按 env → wrangler 配置的顺序找）
  --project <dir>   项目根目录（默认 cwd），配合 --save 使用
  --help            显示帮助

这不是站点扫描器：这个 Cloudflare Radar 端点没有 url 参数，返回的是全网
抽样统计，不针对任何具体网站。扫单个站点用 scripts/is-agentic.mjs。`);
  process.exit(0);
}

function flagValue(args, name) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}

// ── token 解析 ───────────────────────────────────────────────────────────

function findWranglerToken() {
  const candidates = [
    join(homedir(), "Library", "Preferences", ".wrangler", "config", "default.toml"),
    join(homedir(), ".wrangler", "config", "default.toml"),
    join(homedir(), ".config", ".wrangler", "config", "default.toml"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf8");
      const m = raw.match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } catch {
      // 忽略单个候选路径的读取失败，继续尝试下一个
    }
  }
  return null;
}

function resolveToken(args) {
  const fromFlag = flagValue(args, "--token");
  if (fromFlag) return fromFlag;
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const fromWrangler = findWranglerToken();
  if (fromWrangler) return fromWrangler;
  console.error(
    `没找到 Cloudflare API token。三种方式任选一种：\n` +
    `  1. --token <token>\n` +
    `  2. 设置环境变量 CLOUDFLARE_API_TOKEN\n` +
    `  3. 本机登录过 wrangler（~/.wrangler 或 ~/Library/Preferences/.wrangler 下\n` +
    `     的 config/default.toml 里要有 oauth_token 字段）`
  );
  process.exit(1);
}

// ── API ──────────────────────────────────────────────────────────────────

async function fetchBaseline(token, { category } = {}) {
  const url = new URL(API);
  if (category) url.searchParams.set("domainCategory", category);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": UA, // 缺这个头会拿到 HTML 错误页而不是 JSON，解析失败还很难定位
    },
  });

  let body;
  try {
    body = await res.json();
  } catch {
    console.error(`响应不是 JSON（HTTP ${res.status}）。多半是缺 User-Agent 或被拦截，脚本已带 UA，检查网络/token。`);
    process.exit(1);
  }

  if (!res.ok || body.success === false) {
    const msg = (body.errors || []).map(e => `[${e.code}] ${e.message}`).join("; ") || `HTTP ${res.status}`;
    console.error(`Cloudflare API 返回失败：${msg}`);
    process.exit(1);
  }

  return body.result;
}

function validCategoryNames(result) {
  return (result.meta.domainCategories || []).map(c => c.name);
}

// ── 格式化 ───────────────────────────────────────────────────────────────

function computeRows(result, category) {
  const counts = result.summary_0;
  // 分母坑：加了 domainCategory 过滤后，summary_0 的计数会按分类收窄，
  // 但 meta.successfulDomains 仍是全网口径，不会跟着收窄。拿全网分母去除
  // 分类后的计数会算出偏低、误导性的百分比。有分类时改用
  // meta.domainCategories 里该分类自己声明的域名数做分母——这是这个端点
  // 能给到的最接近的分母，但它统计的是「打了这个分类标签的域名总数」，
  // 不保证等于「该分类里扫描成功的域名数」，视为近似值。
  let denom = result.meta.successfulDomains;
  let denomIsApprox = false;
  if (category) {
    const entry = (result.meta.domainCategories || []).find(c => c.name === category);
    if (entry) {
      denom = entry.value;
      denomIsApprox = true;
    }
  }
  return Object.entries(counts)
    .map(([key, countStr]) => {
      const count = Number(countStr);
      return {
        key,
        label: CHECK_LABELS[key] || key,
        count,
        denom,
        denomIsApprox,
        pct: denom > 0 ? (count / denom) * 100 : 0,
      };
    })
    .sort((a, b) => b.pct - a.pct);
}

function printTable(result, category) {
  const rows = computeRows(result, category);
  const meta = result.meta;
  console.log(`\n═══ Cloudflare Radar · AI Agent Readiness 全网基线 ═══`);
  console.log(`数据日期：${meta.date}（lastUpdated ${meta.lastUpdated}）`);
  if (category) {
    console.log(`分类过滤：${category}（分母是该分类声明的域名数，是近似值，不是`);
    console.log(`该分类里「扫描成功」的精确数——这个端点没有暴露那个数字）`);
  } else {
    console.log(`样本：${meta.successfulDomains}/${meta.totalDomains} 个域名扫描成功`);
  }
  console.log();

  const nameWidth = Math.max(...rows.map(r => r.label.length)) + 2;
  for (const r of rows) {
    const pctStr = `${r.pct.toFixed(1)}%`.padStart(6);
    console.log(`${r.label.padEnd(nameWidth)} ${pctStr}   (${r.count}/${r.denom})`);
  }
  console.log();
  console.log(`解读规则：单站分数只有对着这份分母看才有意义。追一项全网通过率`);
  console.log(`个位数甚至 0% 的检查，价值几乎总是低于它挤占的工作——那不是你的`);
  console.log(`缺陷，是 2026 年互联网的常态。`);
}

// ── 存盘 ─────────────────────────────────────────────────────────────────

function saveBaseline(result, projectRoot) {
  const dir = join(projectRoot, ".rankup", "agentic", "baseline");
  mkdirSync(dir, { recursive: true });
  const date = result.meta.date || new Date().toISOString().slice(0, 10);
  const file = join(dir, `${date}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
  console.log(`· 已存入 ${file}`);
}

// ── --compare ────────────────────────────────────────────────────────────

function printCompare(result, scanPath) {
  let scan;
  try {
    scan = JSON.parse(readFileSync(scanPath, "utf8"));
  } catch (e) {
    console.error(`读不了 ${scanPath}：${e.message}`);
    process.exit(1);
  }

  const issues = scan.issues || [];
  if (!issues.length) {
    console.log(`${scan.display_target || scanPath} 的扫描里没有待修项，无需对照。`);
    return;
  }

  const rows = computeRows(result);
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]));

  const mapped = [];
  const unmapped = [];
  for (const issue of issues) {
    const radarKey = ID_MAP[issue.id];
    if (radarKey && byKey[radarKey]) {
      mapped.push({ issue, baseline: byKey[radarKey] });
    } else {
      unmapped.push(issue);
    }
  }

  console.log(`\n═══ ${scan.display_target || scanPath} 待修项 × 全网基线 ═══`);
  console.log(`站点分数：${scan.score ?? "?"}/100  待修项 ${issues.length} 条\n`);

  if (mapped.length) {
    console.log(`可对照（${mapped.length} 项，站点检查 ↔ Radar 全网检查为已确认的同一件事）：`);
    console.log("─".repeat(72));
    for (const { issue, baseline } of mapped) {
      console.log(`✗ [${issue.tier}] ${issue.name}`);
      console.log(`  站点现状：${issue.result}`);
      console.log(`  全网通过率：${baseline.pct.toFixed(1)}%（${baseline.count}/${baseline.denom} 个域名）`);
      if (baseline.pct < 15) {
        console.log(`  → 全网本就极少通过，这项优先级应该让位给下面「不适用」以外的其他修复。`);
      } else {
        console.log(`  → 全网多数站点都过了这项，是真实的差距，值得修。`);
      }
      console.log();
    }
  } else {
    console.log(`没有一条待修项能对照到这个端点的检查项——见下方「未能对照」。\n`);
  }

  console.log(`未能对照（${unmapped.length} 项，Radar 这个端点不测这些，映射表故意留空，不做`);
  console.log(`凑数假映射）：`);
  for (const issue of unmapped) {
    console.log(`  · [${issue.tier}] ${issue.name}（id: ${issue.id}）`);
  }
  if (unmapped.length) {
    console.log(`\n这份对照不是全量映射：is-agentic.mjs 的检查项和这个端点的检查项`);
    console.log(`只在概念完全一致时才连线，其余需要人工判断，不要当成「全网也不管这项」。`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) usage();

  const comparePath = flagValue(args, "--compare");
  const category = flagValue(args, "--category");
  const projectRoot = flagValue(args, "--project") || process.cwd();
  const asJson = args.includes("--json");
  const shouldSave = args.includes("--save");

  const token = resolveToken(args);
  const result = await fetchBaseline(token, { category: category || undefined });

  // 客户端校验 domainCategory：这个端点对未知取值不报错，只是静默忽略过滤，
  // 会让人误以为筛选生效了。自己拿 meta.domainCategories 校验一遍。
  if (category) {
    const valid = validCategoryNames(result);
    if (!valid.includes(category)) {
      console.error(`未知的 domainCategory：「${category}」。`);
      console.error(`这个端点对无效取值不报错、只是静默忽略过滤，所以在这里先挡一道。`);
      console.error(`有效取值：\n  ${valid.join("\n  ")}`);
      process.exit(1);
    }
  }

  if (comparePath) {
    if (asJson) {
      console.error(`--compare 和 --json 不能同时用。`);
      process.exit(1);
    }
    printCompare(result, comparePath);
    if (shouldSave) saveBaseline(result, projectRoot);
    return;
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printTable(result, category);
  }
  if (shouldSave) saveBaseline(result, projectRoot);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
