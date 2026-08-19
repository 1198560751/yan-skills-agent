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
    // 版本从 skill.json 读取,避免每次发版都要手改断言而漏改。
    const { version } = JSON.parse(
      await readFile(path.join(skillRoot, "skill.json"), "utf8"),
    );
    assert.equal(result.stdout.trim(), `rankup ${version} validation passed`);
  });
});

// Skill 必须保持项目中立:项目可归属内容属于 <project>/.rankup/。
// 每种泄漏形态都单独负向测试,否则闸门可能只是看起来存在。
for (const [label, leak] of [
  ["project identifier", "实证:bettercallsaul 的首页转化率。"],
  ["absolute host path", "脚本位于 /Users/someone/Project/site/run.mjs。"],
  ["hardcoded local proxy", "代理走 127.0.0.1:7890。"],
]) {
  test(`release validator rejects a ${label} leak`, async () => {
    await withSkillCopy(async (skillRoot) => {
      const target = path.join(skillRoot, "references", "lifecycle.md");
      await writeFile(target, `${await readFile(target, "utf8")}\n${leak}\n`);
      const result = validate(skillRoot);
      assert.equal(result.status, 1, "泄漏内容必须让验证失败");
      assert.match(result.stderr, new RegExp(label));
    });
  });
}

test("release validator ignores leak patterns inside its own source", async () => {
  await withSkillCopy(async (skillRoot) => {
    const validator = path.join(skillRoot, "scripts", "validate-rankup.mjs");
    const text = await readFile(validator, "utf8");
    assert.ok(
      text.includes("bettercallsaul"),
      "验证脚本自身含有模式字面量,本测试才有意义",
    );
    assert.equal(validate(skillRoot).status, 0, "守卫不得自我告警");
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

test("release validator requires the individual backlink install command", async () => {
  await withSkillCopy(async (skillRoot) => {
    const integrationPath = path.join(
      skillRoot,
      "references",
      "integrations.md",
    );
    const original = await readFile(integrationPath, "utf8");
    await writeFile(
      integrationPath,
      original.replace(
        "npx skills add yan-labs/yan-skills --skill backlink -g -y",
        "npx skills add yan-labs/yan-skills -g --all",
      ),
    );

    const result = validate(skillRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /missing required content in references\/integrations\.md/,
    );
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
