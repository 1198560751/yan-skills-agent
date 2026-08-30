// lib-probe-classifier：从 probe-submission-targets 拆出的分类层（建议，非判决）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_DIRECTORY_RE, classifyKind, decide, gatesFrom } from '../scripts/lib-probe-classifier.mjs';

const signals = (over = {}) => ({
  forms: 1,
  captchaModern: false,
  captchaLegacy: false,
  hasPassword: false,
  loginWall: false,
  reciprocal: false,
  personalContact: false,
  emailVerify: false,
  submitLinks: [],
  ...over,
});

test('gatesFrom 收齐每一道闸门，不是只报第一道', () => {
  assert.deepEqual(gatesFrom(signals()), ['open-form']);
  assert.deepEqual(
    gatesFrom(signals({ captchaModern: true, loginWall: true, emailVerify: true })),
    ['captcha-interactive', 'account', 'email-verify'],
  );
  assert.deepEqual(gatesFrom(signals({ forms: 0 })), ['none-found']);
});

test('decide：所有分支都标 suggested，负向声明保持弱势', () => {
  const unreachable = decide({ status: null, error: 'timeout' }, signals());
  assert.equal(unreachable.suggested, true);
  assert.equal(unreachable.status, 'unverified');

  const server = decide({ status: 503 }, signals());
  assert.equal(server.status, 'unverified');

  const gone = decide({ status: 404 }, signals());
  assert.equal(gone.status, 'unverified');
  assert.deepEqual(gone.gates, ['none-found']);

  // 没表单但有 submit 链接：unverified + 提示走浏览器，绝不是 dead
  const noForm = decide({ status: 200 }, signals({ forms: 0, submitLinks: ['/submit'] }));
  assert.equal(noForm.status, 'unverified');
  assert.match(noForm.why, /follow it in a browser/);

  const open = decide({ status: 200 }, signals());
  assert.equal(open.status, 'usable');
  assert.equal(open.suggested, true);

  const gated = decide({ status: 200 }, signals({ captchaLegacy: true }));
  assert.equal(gated.status, 'gated');
  assert.ok(gated.gates.includes('captcha-interactive'));
});

test('classifyKind：中文 AI 导航与英文措辞都认，unknown 是「没认出」不是判决', () => {
  assert.equal(classifyKind('AI工具集官网 | 1000+ AI工具集合', '<html></html>'), 'ai-directory');
  assert.equal(classifyKind('Best AI Tools Directory 2026', '<html></html>'), 'ai-directory');
  assert.equal(classifyKind('Shanghai网站导航', '<html></html>') === 'ai-directory', false);
  assert.equal(classifyKind('随便一个页面', '<html></html>'), 'unknown');
  assert.ok(AI_DIRECTORY_RE.test('人工智能'));
});

test('probe-submission-targets 仍然 re-export classifyKind（旧测试与调用方兼容）', async () => {
  const mod = await import('../scripts/probe-submission-targets.mjs');
  assert.equal(mod.classifyKind, classifyKind);
  assert.equal(mod.AI_DIRECTORY_RE, AI_DIRECTORY_RE);
});
