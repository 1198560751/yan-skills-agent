// provider-capabilities.md and provider-capabilities.json state the same facts for
// two different audiences, and the Markdown says outright that nothing checks they
// agree. This is that check. It compares only the headline counts — the numbers a
// reader acts on and the ones that rot first when one file is updated alone.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalog = JSON.parse(readFileSync(path.join(root, 'rankup/data/provider-capabilities.json'), 'utf8'));
const doc = readFileSync(path.join(root, 'rankup/references/provider-capabilities.md'), 'utf8');

const totals = Object.fromEntries(Object.entries(catalog.providers).map(([name, capability]) => {
  const modules = capability.modules ?? [];
  return [name, {
    modules: modules.length,
    pages: modules.reduce((sum, module) => sum + (Number(module.pages) || 0), 0),
    separateProducts: (capability.liveAudit?.separateProducts ?? []).length,
  }];
}));

function headline(pattern) {
  const match = doc.match(pattern);
  assert.ok(match, `the Markdown no longer carries a headline matching ${pattern}`);
  return match.slice(1).map(Number);
}

test('the Semrush headline matches the catalog', () => {
  const [modules, pages] = headline(/^## 二、Semrush：(\d+) 个工具箱、(\d+) 个页面/m);
  assert.equal(modules, totals.semrush.modules, 'toolkit count drifted from provider-capabilities.json');
  assert.equal(pages, totals.semrush.pages, 'page count drifted from provider-capabilities.json');
});

test('the Similarweb headline matches the catalog', () => {
  const [modules, separate] = headline(/^## 三、Similarweb：(\d+) 个能用的模块 \+ (\d+) 个买不起的/m);
  assert.equal(modules, totals.similarweb.modules, 'module count drifted from provider-capabilities.json');
  assert.equal(separate, totals.similarweb.separateProducts, 'separate-product count drifted from provider-capabilities.json');
});

test('both documents agree that the programmatic interfaces are closed', () => {
  for (const capability of Object.values(catalog.providers)) {
    for (const surface of capability.interfaces) assert.equal(surface.access, 'blocked-shared-account');
  }
  assert.match(doc, /API \/ MCP：整条线判死/, 'the Markdown must keep stating the verdict the JSON records');
});
