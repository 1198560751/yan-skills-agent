// demand/_lib.mjs 的失败留现场契约（2026-08-30 重构第一波）：
//
//   1. get 系列失败要把 {url,status,headers,body} 落进证据目录，异常里带落点路径；
//   2. 每次运行落 manifest.json，argv 剥敏，sources 逐源记 {source,status,rawCount,error}；
//   3. 「0 条 + 源失败」和「0 条 + 源成功」的输出必须长得不一样；
//   4. die() 先落 manifest（stopReason=died: …）再退出。
//
// 这些保证「配额 429/CAPTCHA/改版/超时」与「真的没有数据」在产出里可分辨——
// 契约破了，AI 就会把采集故障读成市场结论。
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const libPath = path.join(here, '../scripts/demand/_lib.mjs');
const lib = await import(libPath);

test('manifest 落盘：argv 剥敏、sources 逐源、stopReason', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'demand-lib-ev-'));
  lib.initEvidence('unit-test', { dir, argv: ['--query', 'x', '--token', 'sk_live_abc', '--api-key=hunter2'] });
  lib.recordSource({ source: 'a', status: 'http_429', rawCount: 0, error: 'HTTP 429' });
  lib.recordSource({ source: 'b', status: 'ok', rawCount: 3 });
  const file = lib.writeManifest('completed');
  const m = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(m.script, 'unit-test');
  assert.deepEqual(m.argv, ['--query', 'x', '--token', '<redacted>', '--api-key=<redacted>']);
  assert.equal(m.sources.length, 2);
  assert.equal(m.sources[0].status, 'http_429');
  assert.equal(m.stopReason, 'completed');
  const s = lib.sourceStatusSummary();
  assert.equal(s.failed, 1);
  assert.equal(s.ok, 1);
  assert.ok(s.lines.some((l) => l.includes('http_429')));
});

test('getJson 失败：{url,status,body} 进证据目录，异常带落点路径', async () => {
  const server = http.createServer((_, res) => {
    res.writeHead(429, { 'content-type': 'text/plain', 'retry-after': '60' });
    res.end('quota exhausted');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/x`;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'demand-lib-ev-'));
  lib.initEvidence('unit-test-fetch', { dir, argv: [] });
  try {
    await assert.rejects(
      () => lib.getJson(url, { retries: 0 }),
      (e) => e.message.includes('HTTP 429') && e.message.includes('现场已留'),
    );
  } finally {
    server.close();
  }
  const dump = readdirSync(dir).find((f) => f.startsWith('fetch-') && f.includes('429'));
  assert.ok(dump, `证据目录里没有 429 现场文件：${readdirSync(dir).join(', ')}`);
  const body = JSON.parse(readFileSync(path.join(dir, dump), 'utf8'));
  assert.equal(body.url, url);
  assert.equal(body.status, 429);
  assert.equal(body.body, 'quota exhausted');
  assert.equal(body.headers['retry-after'], '60');
});

test('空结果输出：源失败与源成功长得不一样；die() 先落 manifest 再退出', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'demand-lib-ev-'));
  const code = `
    import { initEvidence, recordSource, printTable, die } from ${JSON.stringify(libPath)};
    initEvidence('unit-test-die', { dir: ${JSON.stringify(dir)}, argv: [] });
    recordSource({ source: 'a', status: 'http_429', rawCount: 0, error: 'HTTP 429' });
    printTable([], [{ key: 'x', label: 'x' }]);
    die('桥没连上');
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  // 空表输出必须点名失败，而不是一句裸的 (无结果)。
  assert.ok(r.stdout.includes('采集失败'), `空表输出没有报源失败：${r.stdout}`);
  assert.ok(!/^\(无结果\)$/m.test(r.stdout.trim()));
  const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.ok(m.stopReason.startsWith('died: 桥没连上'), m.stopReason);
  assert.ok(r.stderr.includes('现场已留'));
});
