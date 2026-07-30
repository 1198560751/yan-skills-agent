#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedVersion = "2.0.0";
const requiredReferences = [
  "lifecycle.md",
  "cloudflare-stack.md",
  "project-memory.md",
  "integrations.md",
  "seo-growth.md",
];

const requiredContent = {
  "SKILL.md": [
    "npx skills add yan-labs/yan-skills --skill rankup -g -y",
    "npx skills update rankup -g -y",
    ".rankup/skill-state.json",
    "严禁在 Skill、`.rankup/`、Git、测试或回复中保存真实密钥",
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
    for (const [label, pattern] of secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        errors.push(
          `${label} pattern found in ${path.relative(skillRoot, file)}`,
        );
      }
    }
  }

  for (const requiredFile of [
    "scripts/check-version.mjs",
    "tests/check-version.test.mjs",
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
