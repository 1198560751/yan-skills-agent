#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedVersion = "2.7.0";
const requiredReferences = [
  "lifecycle.md",
  "cloudflare-stack.md",
  "project-memory.md",
  "integrations.md",
  "seo-growth.md",
  "evolution.md",
];

const requiredContent = {
  "SKILL.md": [
    "npx skills add yan-labs/yan-skills --skill rankup -g -y",
    "npx skills update rankup -g -y",
    ".rankup/skill-state.json",
    "严禁在 Skill、`.rankup/`、Git、测试或回复中保存真实密钥",
    "## 可复用操作必须落成脚本",
    "三方对账门禁",
    "沉淀义务与是否调用本 Skill 无关",
    "本 Skill 必须保持项目中立与机器中立",
    "## 跨项目资产登记表",
    "### `rankup init`",
    "### `rankup review`",
    "scripts/sessions.mjs",
    "断言绝不能被 git 追踪",
    "--new-only",
    "review-state.json",
  ],
  "references/project-memory.md": [
    "## 沉淀义务",
    "## 可复用操作脚本",
    "## 三层归属",
    "roadmap.md",
    "iterations.md",
    "experience.md",
  ],
  "references/cloudflare-stack.md": [
    "pnpm dlx shadcn@latest init --preset b1D0eCA4 --template start --monorepo --rtl --pointer",
    "npx skills add cloudflare/skills --skill wrangler -g -y",
    "wrangler types",
  ],
  "references/integrations.md": [
    "npx skills add stripe/ai --skill stripe-best-practices -g -y",
    "npx skills add vercel-labs/skills --skill find-skills -g -y",
    "npx skills add yan-labs/yan-skills -g --all",
    "npx skills add yan-labs/yan-skills --skill backlink -g -y",
    "npx skills add yan-labs/yan-skills --skill backlink-analyzer -g -y",
  ],
  "references/evolution.md": [
    "失败分类",
    "证据阶梯",
    "Maker–Checker",
    "通用规则晋升门",
    "no-promotion",
  ],
};

const secretPatterns = [
  ["Stripe secret key", /\bsk_(?:live|test)_[A-Za-z0-9]{8,}\b/g],
  ["Stripe webhook secret", /\bwhsec_[A-Za-z0-9]{8,}\b/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  [
    "private key",
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  ],
  [
    "assigned bearer token",
    /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  ],
];

// Skill 必须保持项目中立与机器中立:任何可归属到某个具体项目、账号或本机环境的内容
// 都属于 <project>/.rankup/,不进本 Skill。经验条目只保留"剥离站点后仍成立"的规则,
// 证据出处、流量数字、凭据位置一律留在项目侧。
const projectLeakPatterns = [
  ["project identifier", /\b(?:bettercallsaul|birthstonemeaning|crystalhealing|sbti)\b/gi],
  ["absolute host path", /\/Users\/[A-Za-z0-9._-]+\//g],
  ["hardcoded local proxy", /\b127\.0\.0\.1:\d{2,5}\b/g],
  ["credential store location", /\.claude\.json\b/g],
  ["shared account portal", /\bdash\.3ue\.co\b/gi],
];

// 这两个文件按职责必须包含上述模式的字面量(守卫本体与它的负向测试夹具),
// 扫描时排除,否则守卫永远自我告警。除此之外任何文件都不得豁免。
const leakScanExcludes = new Set([
  "scripts/validate-rankup.mjs",
  "tests/validate-rankup.test.mjs",
  // 跨项目登记表按定义就含项目名与绝对路径。豁免它参与项目中立扫描是安全的,
  // 但**唯一**的依据是下面 assertRegistryUntracked 证明它绝不会进 git;
  // 那条断言若被删掉,这一行豁免立刻变成一个泄漏口子。
  "registry.md",
]);

// .gitignore 只是约定,一个 `git add -f` 就能绕过。把"名单绝不被追踪"变成断言。
// 非 git 环境(已安装副本)下无从判断,跳过而不是误报。
async function assertRegistryUntracked(errors) {
  try {
    await execFileAsync("git", ["-C", skillRoot, "rev-parse", "--git-dir"]);
  } catch {
    return;
  }
  const { stdout } = await execFileAsync("git", [
    "-C",
    skillRoot,
    "ls-files",
    "--",
    "registry.md",
  ]);
  if (stdout.trim().length > 0) {
    errors.push(
      "registry.md 已被 git 追踪 — 它含项目名与绝对路径,绝不能提交;" +
        "执行 git rm --cached rankup/registry.md 并确认 rankup/.gitignore 生效",
    );
  }
}

async function read(relativePath) {
  return readFile(path.join(skillRoot, relativePath), "utf8");
}

async function collectTextFiles(directory = skillRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTextFiles(absolutePath)));
    } else if (/\.(?:md|json|mjs)$/.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function validate() {
  const errors = [];
  let manifest;
  let skillMarkdown = "";

  try {
    manifest = JSON.parse(await read("skill.json"));
  } catch (error) {
    errors.push(`skill.json is not valid JSON: ${error.message}`);
  }

  try {
    skillMarkdown = await read("SKILL.md");
  } catch (error) {
    errors.push(`SKILL.md cannot be read: ${error.message}`);
  }

  const frontmatterVersion = skillMarkdown.match(
    /^---[\s\S]*?^metadata:\s*\n(?: {2}.+\n)*? {2}version:\s*["']?([^"'\n]+)["']?\s*$/m,
  )?.[1];

  if (manifest?.version !== expectedVersion) {
    errors.push(
      `skill.json version must be ${expectedVersion}, found ${manifest?.version ?? "missing"}`,
    );
  }
  if (frontmatterVersion !== expectedVersion) {
    errors.push(
      `SKILL.md metadata.version must be ${expectedVersion}, found ${frontmatterVersion ?? "missing"}`,
    );
  }

  for (const reference of requiredReferences) {
    try {
      await read(path.join("references", reference));
    } catch {
      errors.push(`missing reference: references/${reference}`);
    }
    if (!skillMarkdown.includes(`references/${reference}`)) {
      errors.push(`SKILL.md does not link references/${reference}`);
    }
  }

  for (const [relativePath, snippets] of Object.entries(requiredContent)) {
    let text;
    try {
      text = await read(relativePath);
    } catch {
      errors.push(`missing required content file: ${relativePath}`);
      continue;
    }
    for (const snippet of snippets) {
      if (!text.includes(snippet)) {
        errors.push(`missing required content in ${relativePath}: ${snippet}`);
      }
    }
  }

  const linkedReferences = [
    ...skillMarkdown.matchAll(/\]\((references\/[^)#?]+\.md)\)/g),
  ].map((match) => match[1]);
  for (const linkedReference of new Set(linkedReferences)) {
    try {
      await read(linkedReference);
    } catch {
      errors.push(`broken local Markdown link in SKILL.md: ${linkedReference}`);
    }
  }

  const allFiles = await collectTextFiles();
  const contents = await Promise.all(
    allFiles.map(async (file) => ({
      file,
      text: await readFile(file, "utf8"),
    })),
  );
  for (const { file, text } of contents) {
    const relativePath = path.relative(skillRoot, file);
    for (const [label, pattern] of secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        errors.push(`${label} pattern found in ${relativePath}`);
      }
    }
    if (leakScanExcludes.has(relativePath)) {
      continue;
    }
    for (const [label, pattern] of projectLeakPatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(text);
      if (match) {
        errors.push(
          `${label} "${match[0]}" found in ${relativePath} — 项目可归属内容属于 <project>/.rankup/,不进 Skill`,
        );
      }
    }
  }

  await assertRegistryUntracked(errors);

  for (const requiredFile of [
    "scripts/check-version.mjs",
    "scripts/registry.mjs",
    "scripts/review.mjs",
    "scripts/sessions.mjs",
    "tests/check-version.test.mjs",
    "tests/registry.test.mjs",
    "tests/review.test.mjs",
    "tests/sessions.test.mjs",
  ]) {
    try {
      await read(requiredFile);
    } catch {
      errors.push(`missing required file: ${requiredFile}`);
    }
  }

  return errors;
}

const errors = await validate();
if (errors.length > 0) {
  for (const error of errors) {
    console.error(`ERROR: ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`rankup ${expectedVersion} validation passed`);
}
