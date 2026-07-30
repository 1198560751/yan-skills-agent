import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function withSkillCopy(run) {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "rankup-validator-test-"),
  );
  const skillRoot = path.join(temporaryRoot, "rankup");
  try {
    await cp(sourceRoot, skillRoot, { recursive: true });
    return await run(skillRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function validate(skillRoot) {
  return spawnSync(
    process.execPath,
    [path.join(skillRoot, "scripts", "validate-rankup.mjs")],
    { encoding: "utf8" },
  );
}

test("release validator accepts the complete installed Skill", async () => {
  await withSkillCopy(async (skillRoot) => {
    const result = validate(skillRoot);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /rankup 2\.0\.0 validation passed/);
  });
});

test("release validator cannot satisfy commands from its own source", async () => {
  await withSkillCopy(async (skillRoot) => {
    const referencePath = path.join(
      skillRoot,
      "references",
      "cloudflare-stack.md",
    );
    const original = await readFile(referencePath, "utf8");
    await writeFile(
      referencePath,
      original.replace(
        "pnpm dlx shadcn@latest init --preset b1D0eCA4 --template start --monorepo --rtl --pointer",
        "pnpm dlx shadcn@latest init",
      ),
    );

    const result = validate(skillRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required content in references\/cloudflare-stack\.md/);
  });
});

test("release validator requires the secret prohibition in SKILL.md", async () => {
  await withSkillCopy(async (skillRoot) => {
    const skillPath = path.join(skillRoot, "SKILL.md");
    const original = await readFile(skillPath, "utf8");
    await writeFile(
      skillPath,
      original.replace(
        "严禁在 Skill、`.rankup/`、Git、测试或回复中保存真实密钥",
        "不要在项目中保存敏感材料",
      ),
    );

    const result = validate(skillRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required content in SKILL\.md/);
  });
});

test("release validator rejects a broken linked reference", async () => {
  await withSkillCopy(async (skillRoot) => {
    await unlink(
      path.join(skillRoot, "references", "project-memory.md"),
    );
    const result = validate(skillRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing reference: references\/project-memory\.md/);
    assert.match(result.stderr, /broken local Markdown link/);
  });
});
