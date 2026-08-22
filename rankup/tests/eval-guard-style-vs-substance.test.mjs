// Eval for references/evolution.md §10 — "风格门禁不能靠删掉实质内容来满足".
//
// Demonstrates that a style-only validator can be satisfied by deleting the
// substantive content it was never designed to protect, and that adding a
// substance check (required-terms coverage) alongside the style check closes
// the gap — while a correctly *restructured* rewrite (one sentence split into
// two) still satisfies both.
//
// Run: node --test rankup/tests/eval-guard-style-vs-substance.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

// Stand-in for a banned rhetorical construction (a real guard might ban
// "not just X, but Y" or a specific negative-parallelism shape). Here: a
// single sentence carrying two negations chained with "and".
const BANNED_CONSTRUCTION = /\bnot\b[^.]*\band does not\b/i;

// The specific things a disclosure sentence must keep naming. Standing in
// for "the object of the negation must survive the rewrite".
const REQUIRED_TERMS = ["medical treatment", "cure"];

const original =
  "This gemstone is not a medical treatment and does not cure any disease.";

// Style-guard-satisfying rewrite that deletes the substantive clauses
// instead of restructuring the sentence — the failure mode the rule names.
const substanceDeletedRewrite = "This gemstone is a beautiful addition to any collection.";

// Style-guard-satisfying rewrite that also preserves substance, by splitting
// one sentence into two — the fix the rule prescribes.
const restructuredRewrite =
  "This gemstone is not a medical treatment. It does not cure any disease.";

function styleGuard(sentence) {
  return !BANNED_CONSTRUCTION.test(sentence);
}

function substanceGuard(sentence, requiredTerms) {
  return requiredTerms.every((term) => sentence.toLowerCase().includes(term.toLowerCase()));
}

/** Pre-rule validation: style only. This is the guard that shipped the bug. */
function naiveValidate(sentence) {
  return styleGuard(sentence);
}

/** Post-rule validation: style and substance both have to hold. */
function disciplinedValidate(sentence, requiredTerms) {
  return styleGuard(sentence) && substanceGuard(sentence, requiredTerms);
}

test("pre-rule state: a style-only guard accepts a rewrite that deleted the disclosure", () => {
  // Documents the bug: style guard alone waves through a rewrite that lost
  // the substantive content — this is what let four disclosures vanish in
  // the real incident this rule is drawn from.
  assert.equal(
    naiveValidate(substanceDeletedRewrite),
    true,
    "naive style-only guard should wrongly accept the substance-deleted rewrite",
  );
});

test("post-rule state: the combined guard rejects the substance-deleted rewrite", () => {
  assert.equal(
    disciplinedValidate(substanceDeletedRewrite, REQUIRED_TERMS),
    false,
    "combined guard must catch the deleted disclosure",
  );
});

test("post-rule state: the combined guard accepts a restructured rewrite that keeps both style and substance", () => {
  assert.equal(
    disciplinedValidate(restructuredRewrite, REQUIRED_TERMS),
    true,
    "splitting one sentence into two must satisfy both the style rule and the substance rule",
  );
});

test("post-rule state: the combined guard still flags the original for its banned construction", () => {
  assert.equal(
    disciplinedValidate(original, REQUIRED_TERMS),
    false,
    "the original sentence still needs rewriting — it trips the style rule even though substance is intact",
  );
});
