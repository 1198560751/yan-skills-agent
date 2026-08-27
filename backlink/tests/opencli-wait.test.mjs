// Pins the opencli `wait time` defect that sleepStep() exists to work around.
//
// opencli 1.8.7 accepts `wait time <seconds>`, echoes the seconds back, and then
// returns in well under a second. Scripts that trusted it read pages before they
// had rendered. `wait selector` and `wait text` are fine; only `time` is broken.
//
// When this test starts failing because the sleep became accurate, opencli fixed
// it: drop sleepStep() and go back to the native wait.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { sleepStep } from '../scripts/opencli-core.mjs';

const REQUESTED_SECONDS = 6;
const session = `opencli-wait-probe-${process.pid}`;
const opencli = (...args) => spawnSync('opencli', args, { encoding: 'utf8', timeout: 120_000 });
const available = () => {
  const probe = spawnSync('opencli', ['--version'], { encoding: 'utf8', timeout: 20_000 });
  return probe.status === 0;
};
function elapsedSeconds(run) {
  const started = Date.now();
  const result = run();
  return { seconds: (Date.now() - started) / 1000, result };
}

test('sleepStep asks the page for the delay rather than the broken wait command', () => {
  const step = sleepStep(2);
  assert.equal(step.cmd, 'eval', 'a real sleep has to run in the page');
  assert.match(step.args.js, /setTimeout\(resolve, 2000\)/);
  assert.equal(sleepStep(0.25).args.js.includes('250'), true, 'fractional seconds become milliseconds');
  assert.match(sleepStep(-5).args.js, /setTimeout\(resolve, 0\)/, 'a negative delay clamps to zero');
});

test('opencli `wait time` still returns early, so sleepStep is still needed', { skip: !available() && 'opencli is not installed' }, (t) => {
  const opened = opencli('browser', session, 'open', 'https://example.com');
  if (opened.status !== 0) return t.skip('no browser bridge available in this environment');
  try {
    const native = elapsedSeconds(() => opencli('browser', session, 'wait', 'time', String(REQUESTED_SECONDS)));
    const inPage = elapsedSeconds(() => opencli('browser', session, 'eval', sleepStep(REQUESTED_SECONDS).args.js));

    assert.ok(
      inPage.seconds >= REQUESTED_SECONDS,
      `the in-page sleep must actually sleep; waited ${inPage.seconds.toFixed(2)}s for ${REQUESTED_SECONDS}s`,
    );
    assert.ok(
      native.seconds < REQUESTED_SECONDS / 2,
      `opencli fixed \`wait time\` (${native.seconds.toFixed(2)}s for ${REQUESTED_SECONDS}s) — drop sleepStep and use the native wait again`,
    );
  } finally {
    opencli('browser', session, 'close');
  }
});
