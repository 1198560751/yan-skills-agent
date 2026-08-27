// Scripts that carry a --self-test are only as good as something running it.
//
// game-opportunity.mjs has sixteen offline checks and revenue-site-audit.mjs has
// a fixture-driven one, but neither was reachable from `node --test`, so a break
// in either stayed invisible until someone ran the pipeline by hand. This file is
// the wiring. Both self-tests are offline — they build fixtures in a temp dir.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runSelfTest = (script) => spawnSync(process.execPath, [path.join(root, script), '--self-test'], { encoding: 'utf8', timeout: 120_000 });

test('game-opportunity self-test passes and still covers every named check', () => {
  const result = runSelfTest('game-opportunity/scripts/game-opportunity.mjs');
  assert.equal(result.status, 0, `self-test failed:\n${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  // Named so a silently dropped check fails here instead of quietly shrinking coverage.
  for (const check of ['normalize-and-merge', 'decision', 'strict-build-gate', 'checklist-output', 'candidate-priority', 'campaign-dedupe', 'new-games-dedupe', 'global-demand-plan', 'challenge-filter', 'markdown-links', 'stable-latest']) {
    assert.ok(report.checks.includes(check), `self-test no longer covers ${check}`);
  }
});

test('revenue-site-audit self-test passes', () => {
  const result = runSelfTest('rankup/scripts/demand/revenue-site-audit.mjs');
  assert.equal(result.status, 0, `self-test failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /self-test passed/);
});
