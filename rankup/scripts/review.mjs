#!/usr/bin/env node
// 项目记忆体检:把 `rankup review` 里可机械判定的部分压成脚本,人只处理需要判断的部分。
//
//   node scripts/review.mjs --project-root <项目目录> [--days 30] [--json]
//
// 只读,不修改任何文件。输出缺口清单交给 review 流程去补。
// 报告分四块:缺失文件、陈旧记录、脚本体检、经验库信号。

import { readdir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REQUIRED = ["INDEX.md", "PROJECT.md", "plan.md", "decisions.md"];
const RECOMMENDED = ["roadmap.md", "iterations.md", "experience.md", "baseline.md"];

function parseArgs(argv) {
  const options = { projectRoot: process.cwd(), days: 30, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project-root") options.projectRoot = argv[++index] ?? options.projectRoot;
    else if (arg === "--days") options.days = Number(argv[++index]);
    else if (arg === "--json") options.json = true;
    else throw new TypeError(`未知参数: ${arg}`);
  }
  if (!Number.isFinite(options.days) || options.days <= 0) {
    throw new TypeError("--days 必须是正数");
  }
  return options;
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function ageInDays(file, now) {
  try {
    return Math.floor((now - (await stat(file)).mtimeMs) / 86_400_000);
  } catch {
    return null;
  }
}

// 记录是否落后于代码:有提交而记忆没动,就是漂移信号。滞后指标不能当进度依据。
async function commitsSince(projectRoot, since) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", projectRoot, "log", "--oneline", `--since=${since}`],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    return stdout.trim() ? stdout.trim().split("\n").length : 0;
  } catch {
    return null;
  }
}

function splitEntries(text) {
  return text
    .split(/(?=^- \*\*\[20)/m)
    .filter((block) => block.startsWith("- **["))
    .map((block) => block.trim());
}

function headline(entry) {
  return (entry.match(/^- \*\*\[[^\]]+\]\s*([^*]+)/) ?? [, ""])[1].trim();
}

async function reviewProject(projectRoot, days) {
  const now = Date.now();
  const rankupDir = path.join(projectRoot, ".rankup");
  const report = {
    projectRoot,
    hasRankup: await exists(rankupDir),
    missingRequired: [],
    missingRecommended: [],
    stale: [],
    scripts: [],
    experience: { total: 0, malformed: false, duplicates: [], promotionCandidates: [] },
    commitsSince: null,
  };
  if (!report.hasRankup) return report;

  for (const file of REQUIRED) {
    if (!(await exists(path.join(rankupDir, file)))) report.missingRequired.push(file);
  }
  for (const file of RECOMMENDED) {
    if (!(await exists(path.join(rankupDir, file)))) report.missingRecommended.push(file);
  }

  for (const file of [...REQUIRED, ...RECOMMENDED]) {
    const age = await ageInDays(path.join(rankupDir, file), now);
    if (age !== null && age > days) report.stale.push({ file, days: age });
  }
  report.stale.sort((a, b) => b.days - a.days);

  const scriptsDir = path.join(rankupDir, "scripts");
  if (await exists(scriptsDir)) {
    for (const entry of await readdir(scriptsDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      const file = path.join(scriptsDir, entry.name);
      const text = await readFile(file, "utf8");
      const head = text.split("\n").slice(0, 20).join("\n");
      report.scripts.push({
        name: entry.name,
        // 脚本会因页面改版而腐坏,所以头部必须留"已验证"日期;没有就无从判断新鲜度。
        hasVerifiedDate: /已验证|verified/i.test(head),
        // 写死具体值的脚本换个站/换个词就得改,等于没有复用价值。
        parameterized: /process\.argv|argparse|sys\.argv|getopts/.test(text),
        days: await ageInDays(file, now),
      });
    }
    report.scripts.sort((a, b) => a.name.localeCompare(b.name));
  }

  const experiencePath = path.join(rankupDir, "experience.md");
  if (await exists(experiencePath)) {
    const raw = await readFile(experiencePath, "utf8");
    const entries = splitEntries(raw);
    report.experience.total = entries.length;

    // 文件里明明有内容却一条都切不出来 = 格式不对(多半是用 `## 标题` 分的条),
    // 而不是「还没积累经验」。不报出来的话重复检测与回流候选会长期空转,
    // 报告却完全正常——实测有过一个 12 条的库被静默报成 0 条。
    // 判据取「有 `##` 分条却切不出条目」为主,纯长度阈值为辅——
    // 只用长度会漏掉短条目的库(标题行被剔掉后正文可能不足两百字)。
    const hasHeadingSections = /^##\s+\S/m.test(raw);
    const bodyLength = raw.replace(/^#.*$/gm, "").trim().length;
    if (entries.length === 0 && (hasHeadingSections || bodyLength > 200)) {
      report.experience.malformed = true;
    }

    const seen = new Map();
    for (const entry of entries) {
      const key = headline(entry).slice(0, 24);
      if (!key) continue;
      if (seen.has(key)) report.experience.duplicates.push(key);
      else seen.set(key, true);
    }

    // 既不提本站域名、也不含本站专属数字的条目,很可能是通用规则,值得考虑回流 Skill。
    const projectName = path.basename(projectRoot).toLowerCase();
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      const mentionsSite =
        lower.includes(projectName) || /https?:\/\/|\b[a-z0-9-]+\.(com|store|guide|support|io|dev)\b/.test(lower);
      if (!mentionsSite) report.experience.promotionCandidates.push(headline(entry).slice(0, 60));
    }
  }

  report.commitsSince = await commitsSince(projectRoot, `${days} days ago`);
  return report;
}

function renderText(report, days) {
  const lines = [`# .rankup 体检 — ${report.projectRoot}`, ""];
  if (!report.hasRankup) {
    lines.push("未找到 `.rankup/`。先运行 `rankup init` 初始化项目记忆。", "");
    return lines.join("\n");
  }

  lines.push("## 缺失文件", "");
  if (report.missingRequired.length === 0 && report.missingRecommended.length === 0) {
    lines.push("无。", "");
  } else {
    for (const file of report.missingRequired) lines.push(`- 必需：\`${file}\``);
    for (const file of report.missingRecommended) lines.push(`- 建议：\`${file}\``);
    lines.push("");
  }

  lines.push(`## 超过 ${days} 天未更新`, "");
  if (report.stale.length === 0) {
    lines.push("无。", "");
  } else {
    for (const item of report.stale) lines.push(`- \`${item.file}\` — ${item.days} 天`);
    if (report.commitsSince !== null && report.commitsSince > 0) {
      lines.push(
        "",
        `同期仓库有 ${report.commitsSince} 个提交：记录已落后于代码，进度以 git、路由与 sitemap 为准。`,
      );
    }
    lines.push("");
  }

  lines.push("## 脚本体检", "");
  if (report.scripts.length === 0) {
    lines.push("尚无可复用脚本。会做第二次的操作，第一次跑通就该固化到 `.rankup/scripts/`。", "");
  } else {
    lines.push("| 脚本 | 已验证日期 | 参数化 | 距上次改动 |", "|---|---|---|---|");
    for (const script of report.scripts) {
      lines.push(
        `| \`${script.name}\` | ${script.hasVerifiedDate ? "有" : "**缺**"} | ${script.parameterized ? "是" : "**否**"} | ${script.days ?? "?"} 天 |`,
      );
    }
    lines.push("");
  }

  lines.push("## 经验库信号", "");
  lines.push(`- 条目总数：${report.experience.total}`);
  if (report.experience.malformed) {
    lines.push(
      "- **格式异常**：文件有内容但一条都切不出来。条目必须以 `- **[YYYY-MM-DD] 标题**` 起头,",
      "  用 `## 标题` 分条会让本脚本读出 0 条,重复检测与回流候选因此全部空转。",
    );
  }
  if (report.experience.duplicates.length > 0) {
    lines.push(`- 疑似重复（应合并）：${report.experience.duplicates.join("、")}`);
  }
  if (report.experience.promotionCandidates.length > 0) {
    lines.push(`- 候选回流 Skill（未提及本站，疑为通用规则）：${report.experience.promotionCandidates.length} 条`);
    for (const candidate of report.experience.promotionCandidates.slice(0, 10)) {
      lines.push(`  - ${candidate}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const report = await reviewProject(path.resolve(options.projectRoot), options.days);
process.stdout.write(
  options.json ? `${JSON.stringify(report, null, 2)}\n` : renderText(report, options.days),
);
