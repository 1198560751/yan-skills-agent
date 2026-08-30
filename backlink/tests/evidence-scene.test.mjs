// lib-evidence-scene 的纯函数与注入式采集测试：不碰浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  captureScene, defaultSceneDir, sanitizeSceneTag, sceneFileNames, sceneSummaryLine,
} from '../scripts/lib-evidence-scene.mjs';

test('sanitizeSceneTag 只留安全字符，空值落成 scene', () => {
  assert.equal(sanitizeSceneTag('Values Never Settled!'), 'values-never-settled');
  assert.equal(sanitizeSceneTag('kw-3/错误 路径'), 'kw-3');
  assert.equal(sanitizeSceneTag(''), 'scene');
  assert.equal(sanitizeSceneTag(null), 'scene');
  // 超长 tag 截断，不会生成溢出文件名
  assert.ok(sanitizeSceneTag('x'.repeat(300)).length <= 80);
});

test('sceneFileNames 成对且带 scene- 前缀', () => {
  const { censusFile, shotFile } = sceneFileNames('timed-out');
  assert.equal(censusFile, 'scene-timed-out-census.json');
  assert.equal(shotFile, 'scene-timed-out.png');
});

test('defaultSceneDir：有 out 贴着输出文件，没 out 进 .backlink/evidence', () => {
  assert.equal(defaultSceneDir({ out: 'x/y.json', script: 'foo' }), 'x/y.json.evidence');
  const bare = defaultSceneDir({ script: 'foo', runTag: 'r1' });
  assert.equal(bare, path.join('.backlink', 'evidence', 'foo', 'r1'));
});

test('captureScene：双证人成对落盘，census 剥敏，截图注入', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'scene-'));
  const fakeCapture = {
    when: '2026-08-30T00:00:00.000Z',
    // token 参数要整个删除；__gmitm 只留空值键名
    href: '/analytics/overview/?q=example.com&token=SECRET123&__gmitm=TOK456',
    title: 'report',
    scrollY: 0,
    census: { deep: { filledCells: 42, textLength: 1234 } },
  };
  const record = await captureScene({
    session: 'test-session',
    outDir: dir,
    tag: 'Unit Test!',
    note: 'why we are here',
    evalPage: async () => ({ ...fakeCapture }),
    screenshot: async (abs) => writeFileSync(abs, Buffer.from([0x89, 0x50])),
  });
  assert.equal(record.tag, 'unit-test');
  assert.equal(record.censusFile, 'scene-unit-test-census.json');
  assert.equal(record.shotFile, 'scene-unit-test.png');
  assert.equal(record.filledCells, 42);
  assert.equal(record.deepTextLength, 1234);
  assert.equal(record.censusError, null);
  assert.equal(record.screenshotError, null);
  const written = readFileSync(path.join(dir, record.censusFile), 'utf8');
  assert.ok(!written.includes('SECRET123'), 'token 参数必须被整个删除');
  assert.ok(!written.includes('TOK456'), '__gmitm 值必须被剥掉');
  assert.ok(written.includes('why we are here'), 'note 要写进 census 文件');
  assert.ok(existsSync(path.join(dir, record.shotFile)));
});

test('captureScene：census 失败不 throw，截图照拍；反向亦然', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'scene-'));
  const record = await captureScene({
    session: 's',
    outDir: dir,
    tag: 'half',
    evalPage: async () => { throw new Error('eval blew up with token=SECRET789'); },
    screenshot: async (abs) => writeFileSync(abs, 'png'),
  });
  assert.equal(record.censusFile, null);
  assert.ok(record.censusError, '失败原因要记进记录');
  assert.ok(!record.censusError.includes('SECRET789'), '错误消息也要剥敏');
  assert.equal(record.shotFile, 'scene-half.png', 'census 挂了截图也要拍');

  const record2 = await captureScene({
    session: 's',
    outDir: dir,
    tag: 'other-half',
    evalPage: async () => ({ href: '/x', title: 't', census: { deep: { filledCells: 0, textLength: 1 } } }),
    screenshot: async () => { throw new Error('no screenshot backend'); },
  });
  assert.equal(record2.censusFile, 'scene-other-half-census.json');
  assert.equal(record2.shotFile, null);
  assert.ok(record2.screenshotError);
});

test('captureScene：没有 outDir 也不 throw，只报原因', async () => {
  const record = await captureScene({ session: 's', tag: 'nowhere' });
  assert.equal(record.censusFile, null);
  assert.equal(record.shotFile, null);
  assert.ok(record.censusError);
});

test('sceneSummaryLine 带出路径或失败原因，绝不空手', () => {
  assert.match(sceneSummaryLine(null), /未执行/);
  const line = sceneSummaryLine({ dir: '/tmp/e', censusFile: 'scene-a-census.json', shotFile: null, screenshotError: 'x' });
  assert.ok(line.includes('scene-a-census.json'));
  assert.ok(line.includes('截图失败'));
});
