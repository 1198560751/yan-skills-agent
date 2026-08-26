import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('form scan and fill both reject off-page honeypot fields', async () => {
  for (const file of ['inspect-page.mjs', 'safe-fill.mjs']) {
    const source = await readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8');
    const body = source.match(/const visible = \(element\) => \{([\s\S]*?)\n  \};/)?.[1];
    assert.ok(body, `${file} must define visible()`);
    const visible = vm.runInNewContext(`(element) => {${body}}`, {
      document: { documentElement: { clientWidth: 1200, scrollHeight: 3000 }, body: { scrollHeight: 3000 } },
      innerWidth: 1200,
      getComputedStyle: (element) => element.style,
    });
    const element = (rect) => ({ hidden: false, disabled: false, style: { display: 'block', visibility: 'visible', opacity: '1' }, getBoundingClientRect: () => rect });
    assert.equal(visible(element({ width: 100, height: 30, left: 10, right: 110, top: 200, bottom: 230 })), true);
    assert.equal(visible(element({ width: 100, height: 30, left: -9999, right: -9899, top: 200, bottom: 230 })), false);
    assert.equal(visible(element({ width: 100, height: 30, left: 10, right: 110, top: -9999, bottom: -9969 })), false);
    assert.equal(visible(element({ width: 100, height: 30, left: 10, right: 110, top: 9999, bottom: 10029 })), false);
  }
});
