#!/usr/bin/env node
/**
 * AI Agent 就绪度扫描 —— 包装 is-agentic.com 的公开 API。
 *
 * 用法：
 *   node <rankup-skill-dir>/scripts/is-agentic.mjs scan <domain>
 *   node <rankup-skill-dir>/scripts/is-agentic.mjs scan <domain> --save   # 存入 .rankup/
 *   node <rankup-skill-dir>/scripts/is-agentic.mjs diff <domain>          # 与上次对比
 *   node <rankup-skill-dir>/scripts/is-agentic.mjs history <domain>       # 查看历史分数
 *
 * 零配置可跑：公开 API，无需令牌，120 请求/分钟/IP。
 * 扫描由 Ora AI 执行，6 小时内相同域名返回缓存结果。
 *
 * 已验证：2026-08-22
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const API = "https://is-agentic.com/api/v1/report";
const REPORT_URL = "https://is-agentic.com/scan";

const TIER_WEIGHT = { essential: 3, recommended: 2, bonus: 1 };
const RESULT_ICON = { failed: "✗", partial: "△", passed: "✓" };

// ── helpers ──────────────────────────────────────────────────────────────

function usage() {
  console.log(`用法：
  node is-agentic.mjs scan <domain>            扫描并输出报告
  node is-agentic.mjs scan <domain> --save     扫描并存入 .rankup/agentic/
  node is-agentic.mjs diff <domain>            与上次扫描对比
  node is-agentic.mjs history <domain>         查看历史分数曲线

选项：
  --save        将结果写入 .rankup/agentic/<domain>/<date>.json
  --project     项目根目录（默认 cwd）
  --help        显示帮助`);
  process.exit(0);
}

function req(v, name) {
  if (!v) { console.error(`缺少参数 ${name}`); process.exit(1); }
  return v;
}

function normDomain(input) {
  return input
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function agenticDir(projectRoot, domain) {
  return join(projectRoot, ".rankup", "agentic", domain);
}

function latestSnapshot(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();
  if (!files.length) return null;
  return JSON.parse(readFileSync(join(dir, files[0]), "utf8"));
}

function allSnapshots(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .sort()
    .map(f => {
      const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
      return { file: f, ...data };
    });
}

// ── API ──────────────────────────────────────────────────────────────────

async function fetchReport(domain) {
  const url = `${API}?url=https://${domain}`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "rankup-skill/1.0" }
  });

  if (res.status === 404) {
    console.log(`· 没有已完成的报告，正在通过 CLI 触发扫描…`);
    try {
      const raw = execSync(`npx is-agentic ${domain} --json 2>/dev/null`, {
        timeout: 180_000,
        encoding: "utf8",
      });
      return JSON.parse(raw);
    } catch (e) {
      console.error(`扫描失败：${e.message}`);
      process.exit(1);
    }
  }

  if (res.status === 429) {
    const retry = res.headers.get("Retry-After") || "60";
    console.error(`限流（429），${retry} 秒后重试。`);
    process.exit(1);
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`API 错误 ${res.status}：${body}`);
    process.exit(1);
  }

  return res.json();
}

// ── 报告格式化 ────────────────────────────────────────────────────────────

function printReport(report) {
  const { score, score_label, score_breakdown: sb, issues, scanned_at } = report;
  const domain = report.display_target;

  console.log(`\n═══ ${domain} ═══`);
  console.log(`分数：${score}/100  ${score_label}`);
  console.log(`扫描时间：${new Date(scanned_at).toLocaleString("zh-CN")}`);
  console.log(`报告：${REPORT_URL}/${domain}`);
  console.log();

  // 分数细分
  console.log(`┌─ Essential    ${sb.essential.passing}/${sb.essential.total} 通过    ${sb.essential.earned}/${sb.essential.available} 分`);
  console.log(`├─ Recommended  ${sb.recommended.passing}/${sb.recommended.total} 通过    ${sb.recommended.earned}/${sb.recommended.available} 分`);
  console.log(`└─ Bonus        ${sb.bonus.positive_signals} 个信号    +${sb.bonus.points} 分`);
  console.log();

  if (!issues || !issues.length) {
    console.log("✓ 全部通过，无待修项。");
    return;
  }

  // 按优先级排序：essential > recommended > bonus，failed > partial
  const sorted = [...issues].sort((a, b) => {
    const tw = (TIER_WEIGHT[b.tier] || 0) - (TIER_WEIGHT[a.tier] || 0);
    if (tw !== 0) return tw;
    if (a.result === "failed" && b.result !== "failed") return -1;
    if (b.result === "failed" && a.result !== "failed") return 1;
    return 0;
  });

  console.log(`待修项（${sorted.length} 项，按优先级排序）：`);
  console.log("─".repeat(72));

  for (const issue of sorted) {
    const icon = RESULT_ICON[issue.result] || "?";
    const tier = issue.tier.toUpperCase().padEnd(11);
    console.log(`${icon} [${tier}] ${issue.name}`);
    if (issue.details) console.log(`  现状：${issue.details}`);
    if (issue.recommendation) {
      const rec = issue.recommendation.length > 200
        ? issue.recommendation.slice(0, 200) + "…"
        : issue.recommendation;
      console.log(`  建议：${rec}`);
    }
    console.log();
  }
}

function printDiff(current, previous) {
  const domain = current.display_target;
  const scoreDelta = current.score - previous.score;
  const sign = scoreDelta > 0 ? "+" : "";

  console.log(`\n═══ ${domain} 变化对比 ═══`);
  console.log(`上次：${previous.score}/100  （${new Date(previous.scanned_at).toLocaleDateString("zh-CN")}）`);
  console.log(`本次：${current.score}/100  （${new Date(current.scanned_at).toLocaleDateString("zh-CN")}）`);
  console.log(`变化：${sign}${scoreDelta} 分`);
  console.log();

  const prevIds = new Set((previous.issues || []).map(i => i.id));
  const currIds = new Set((current.issues || []).map(i => i.id));
  const currMap = Object.fromEntries((current.issues || []).map(i => [i.id, i]));
  const prevMap = Object.fromEntries((previous.issues || []).map(i => [i.id, i]));

  const fixed = [...prevIds].filter(id => !currIds.has(id));
  const newIssues = [...currIds].filter(id => !prevIds.has(id));
  const changed = [...currIds].filter(id => prevIds.has(id) && currMap[id].result !== prevMap[id].result);

  if (fixed.length) {
    console.log(`✓ 已修复（${fixed.length}）：`);
    for (const id of fixed) console.log(`  + ${prevMap[id].name}`);
    console.log();
  }

  if (changed.length) {
    console.log(`△ 状态变化（${changed.length}）：`);
    for (const id of changed) {
      console.log(`  ~ ${currMap[id].name}: ${prevMap[id].result} → ${currMap[id].result}`);
    }
    console.log();
  }

  if (newIssues.length) {
    console.log(`✗ 新问题（${newIssues.length}）：`);
    for (const id of newIssues) console.log(`  - ${currMap[id].name}`);
    console.log();
  }

  if (!fixed.length && !newIssues.length && !changed.length) {
    console.log("无变化。");
  }
}

function printHistory(snapshots, domain) {
  if (!snapshots.length) {
    console.log(`没有 ${domain} 的历史记录。先 scan --save 存一次。`);
    return;
  }
  console.log(`\n═══ ${domain} 历史 ═══`);
  console.log(`${"日期".padEnd(14)}${"分数".padEnd(8)}${"Essential".padEnd(14)}${"Recommended".padEnd(14)}${"Bonus"}`);
  console.log("─".repeat(60));
  for (const s of snapshots) {
    const date = s.file.replace(".json", "");
    const sb = s.score_breakdown;
    console.log(
      `${date.padEnd(14)}` +
      `${String(s.score).padEnd(8)}` +
      `${sb.essential.earned}/${sb.essential.available}`.padEnd(14) +
      `${sb.recommended.earned}/${sb.recommended.available}`.padEnd(14) +
      `+${sb.bonus.points}`
    );
  }
  console.log();
}

// ── 存盘 ─────────────────────────────────────────────────────────────────

function saveSnapshot(report, projectRoot) {
  const domain = normDomain(report.display_target);
  const dir = agenticDir(projectRoot, domain);
  mkdirSync(dir, { recursive: true });
  const date = new Date(report.scanned_at).toISOString().slice(0, 10);
  const file = join(dir, `${date}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  console.log(`· 已存入 ${file}`);
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) usage();

  const cmd = args[0];
  const domain = normDomain(req(args[1], "<domain>"));
  const flags = new Set(args.slice(2));
  const projectRoot = (() => {
    const idx = args.indexOf("--project");
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : process.cwd();
  })();

  if (cmd === "scan") {
    const report = await fetchReport(domain);
    printReport(report);
    if (flags.has("--save")) saveSnapshot(report, projectRoot);
  } else if (cmd === "diff") {
    const dir = agenticDir(projectRoot, domain);
    const prev = latestSnapshot(dir);
    if (!prev) {
      console.log(`没有 ${domain} 的历史快照，无法对比。先 scan --save 存一次基线。`);
      process.exit(1);
    }
    const report = await fetchReport(domain);
    printReport(report);
    printDiff(report, prev);
    if (flags.has("--save")) saveSnapshot(report, projectRoot);
  } else if (cmd === "history") {
    const dir = agenticDir(projectRoot, domain);
    const snapshots = allSnapshots(dir);
    printHistory(snapshots, domain);
  } else {
    console.error(`未知命令 ${cmd}。scan / diff / history`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
