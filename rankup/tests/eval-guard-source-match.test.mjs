// Eval for references/evolution.md §10 — "一个匹配源代码文本的门禁,只要把它保护的
// 那一行注释掉就能通过".
//
// This is not a test of any script in this Skill; it is a runnable demonstration
// that the rule catches the failure mode it describes. It ships two guard
// implementations side by side:
//
//   naiveSourceGuard  — matches raw file text with String#includes(), the pattern
//                        that was hit three times in one real codebase in one day.
//   disciplinedGuard  — strips comments before matching, per the rule.
//
// Run: node --test rankup/tests/eval-guard-source-match.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

// A component that is actually rendered.
const activeSource = `
function Footer() {
  return (
    <div>
      <Disclaimer text="Not medical advice" />
    </div>
  );
}
`;

// The same file after someone comments the render line out during a layout
// experiment, leaving an explanatory comment behind — the realistic trigger
// named in the rule.
const commentedOutSource = `
function Footer() {
  return (
    <div>
      {/* <Disclaimer text="Not medical advice" /> temporarily disabled while
          we test the new footer layout */}
    </div>
  );
}
`;

/**
 * The flawed pattern: assert on raw source text. A guard built this way
 * cannot tell "rendered" from "commented out and described in prose" —
 * both contain the matched string.
 */
function naiveSourceGuard(source) {
  return source.includes("<Disclaimer");
}

/** Minimal comment stripper: JS/JSX line and block comments. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * The disciplined pattern: strip comments before matching source text.
 * This is the fallback path for when a value genuinely can't be read
 * (e.g. proving JSX is actually emitted) — the rule's first preference is
 * always "assert on the value", this function only demonstrates the second
 * best option working correctly.
 */
function disciplinedGuard(source) {
  return stripComments(source).includes("<Disclaimer");
}

test("pre-rule state: a raw-text guard is fooled by commenting out the protected line", () => {
  // This is the bug the rule exists to prevent, captured as a passing
  // assertion about the naive guard's (wrong) behavior: it reports the
  // disclosure as present when it has actually been removed from output.
  assert.equal(
    naiveSourceGuard(commentedOutSource),
    true,
    "naive guard should be fooled — this documents the failure mode, not a desired outcome",
  );
});

test("post-rule state: a comment-stripped guard correctly reports the disclosure as absent", () => {
  assert.equal(
    disciplinedGuard(commentedOutSource),
    false,
    "disciplined guard must catch the commented-out render",
  );
});

test("post-rule state: the disciplined guard still passes when the component is genuinely rendered", () => {
  assert.equal(
    disciplinedGuard(activeSource),
    true,
    "disciplined guard must not false-positive on real renders",
  );
});

test("the litmus test from the rule: does commenting out the protected line still pass the guard?", () => {
  // "before shipping a source-matching guard, ask whether commenting out the
  // protected line still passes. If it does, there is no guard."
  const naivePasses = naiveSourceGuard(commentedOutSource);
  const disciplinedPasses = disciplinedGuard(commentedOutSource);
  assert.equal(naivePasses, true, "naive guard: commenting out still passes (this is the bug)");
  assert.equal(disciplinedPasses, false, "disciplined guard: commenting out now fails (this is the fix)");
});
