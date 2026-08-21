import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reviewScript = path.join(skillRoot, "scripts", "review.mjs");

function runReview(projectRoot, extra = []) {
  return spawnSync(process.execPath, [reviewScript, "--project-root", projectRoot, ...extra], {
    encoding: "utf8",
  });
}

async function withProject(run) {
  const root = await mkdtemp(path.join(tmpdir(), "rankup-review-test-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function seed(root, files) {
  const rankupDir = path.join(root, ".rankup");
  await mkdir(rankupDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(rankupDir, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return rankupDir;
}

test("没有 .rankup 时指向 init，而不是报一堆缺失文件", async () => {
  await withProject(async (root) => {
    const result = runReview(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /rankup init/);
  });
});

test("报出缺失的必需与建议文件", async () => {
  await withProject(async (root) => {
    await seed(root, { "INDEX.md": "# index\n" });
    const report = JSON.parse(runReview(root, ["--json"]).stdout);
    assert.ok(report.missingRequired.includes("PROJECT.md"));
    assert.ok(report.missingRecommended.includes("roadmap.md"));
    assert.ok(!report.missingRequired.includes("INDEX.md"));
  });
});

test("超过阈值未更新的记录被标为陈旧", async () => {
  await withProject(async (root) => {
    const rankupDir = await seed(root, { "plan.md": "# plan\n", "INDEX.md": "# index\n" });
    const old = new Date(Date.now() - 90 * 86_400_000);
    await utimes(path.join(rankupDir, "plan.md"), old, old);

    const report = JSON.parse(runReview(root, ["--json", "--days", "30"]).stdout);
    const stalePlan = report.stale.find((item) => item.file === "plan.md");
    assert.ok(stalePlan, "plan.md 应被判为陈旧");
    assert.ok(stalePlan.days >= 89);
    assert.ok(!report.stale.some((item) => item.file === "INDEX.md"));
  });
});

test("脚本缺已验证日期或写死具体值时被点名", async () => {
  await withProject(async (root) => {
    await seed(root, {
      "scripts/good.mjs": "// 导出 GSC 查询表\n// 已验证:2026-08-02\nprocess.argv.slice(2);\n",
      "scripts/bad.mjs": "// 导出某个固定站点的数据\nconst property = 'fixed-value';\n",
    });
    const report = JSON.parse(runReview(root, ["--json"]).stdout);
    const good = report.scripts.find((item) => item.name === "good.mjs");
    const bad = report.scripts.find((item) => item.name === "bad.mjs");
    assert.equal(good.hasVerifiedDate, true);
    assert.equal(good.parameterized, true);
    // 没有已验证日期就无从判断脚本是否还能跑;写死具体值等于没有复用价值。
    assert.equal(bad.hasVerifiedDate, false);
    assert.equal(bad.parameterized, false);
  });
});

test("经验库重复条目与候选回流条目被分别识别", async () => {
  await withProject(async (root) => {
    await seed(root, {
      "experience.md": [
        "- **[2026-08-01] LCP 图被 lazy 拖死**:通用机制说明。",
        "- **[2026-08-02] LCP 图被 lazy 拖死**:又写了一遍。",
        "- **[2026-08-02] 本站首页转化**:example.com 实测 3%。",
      ].join("\n\n"),
    });
    const report = JSON.parse(runReview(root, ["--json"]).stdout);
    assert.equal(report.experience.total, 3);
    assert.equal(report.experience.duplicates.length, 1);
    // 提到具体域名的条目属于项目侧,不该被建议回流到要开源的 Skill。
    assert.equal(report.experience.promotionCandidates.length, 2);
    assert.ok(report.experience.promotionCandidates.every((item) => !item.includes("本站首页转化")));
  });
});

test("非法 --days 直接报错而不是静默取默认值", async () => {
  await withProject(async (root) => {
    const result = runReview(root, ["--days", "0"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--days/);
  });
});

test("用 ## 分条的经验库被判为格式异常,而不是静默报 0 条", async () => {
  await withProject(async (root) => {
    // 这是本协议里最容易发生的静默失效:切分器认 `- **[日期] 标题**`,
    // 用 `## 标题` 分条会读出 0 条,于是重复检测与回流候选长期空转,
    // 而报告看起来完全正常。实测有过一个 12 条的库被静默报成 0 条。
    await seed(root, {
      "experience.md": ["# 经验", "", "## 一条结论", "", "正文。", "", "## 又一条", "", "正文。"].join("\n"),
    });
    const report = JSON.parse(runReview(root, ["--json"]).stdout);
    assert.equal(report.experience.total, 0);
    assert.equal(report.experience.malformed, true);
    assert.match(runReview(root).stdout, /格式异常/);
  });
});

test("空的经验库不报格式异常", async () => {
  await withProject(async (root) => {
    await seed(root, { "experience.md": "# 本项目可复用经验\n\n还没有条目。\n" });
    const report = JSON.parse(runReview(root, ["--json"]).stdout);
    assert.equal(report.experience.total, 0);
    assert.equal(report.experience.malformed, false);
  });
});
