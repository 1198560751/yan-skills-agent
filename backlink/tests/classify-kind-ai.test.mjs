import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = path.join(skillRoot, "scripts", "probe-submission-targets.mjs");
const { classifyKind } = await import(modulePath);

// Real escapees from a target-selection run: a batch of 76 submission
// candidates was supposed to have 22 AI directories stripped out because the
// consuming site has a hard "no AI" constraint, but these four reached the
// human-facing shortlist because classifyKind never recognised them as
// ai-directory (it fell through to 'unknown', which the kind filter did not
// exclude). Their titles are Chinese-language AI-nav copy with no English
// "ai tools"/"ai directory" string anywhere on the page.
const truePositives = [
  ["AI工具集官网 | 1000+ AI工具集合，国内外AI工具集导航大全", "ai-bot.cn"],
  ["AI工具网 | AI工具集导航大全 | 精选AI人工智能工具推荐", "ai138.com"],
  ["AI工具导航站|AI写作,AI编程,AI绘画,AI论文,AI视频,AI生图,AI办公,AI学习,AI生成", "ai-nav.net"],
  ["提交AI产品 | AI导航网站", "aiheron.com"],
];

// English phrasing the old regex already caught — must still work.
const englishPositives = [
  "Best AI Tools Directory 2026",
  "Submit your AI tool to our AI directory",
];

test("classifyKind recognises Chinese-language AI-nav directories (the class, not just the four escapees)", () => {
  for (const [title, host] of truePositives) {
    assert.equal(classifyKind(title, "<html></html>"), "ai-directory", `${host} (${title}) should classify as ai-directory`);
  }
});

test("classifyKind still recognises English AI-directory phrasing", () => {
  for (const title of englishPositives) {
    assert.equal(classifyKind(title, "<html></html>"), "ai-directory", `${title} should classify as ai-directory`);
  }
});

// Domains/words that merely contain the letters "ai" and must NOT be
// misclassified as an AI directory by an over-broad substring rule.
const falsePositiveTraps = [
  "SupplyChain Partners Directory",
  "Free Email Marketing Tools List",
  "Domain Appraisal Directory",
  "Package Maintainer Registry",
  "Retail Business Directory",
  "Air Quality Data Portal",
  "Get Paid to Write Reviews",
  "As Said in the Press",
  "Available Now: Startup Launch Directory",
];

test("classifyKind does not over-match domains/titles that merely contain the letters 'ai'", () => {
  for (const title of falsePositiveTraps) {
    assert.notEqual(classifyKind(title, "<html></html>"), "ai-directory", `"${title}" must not classify as ai-directory`);
  }
});
