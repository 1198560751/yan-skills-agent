// 「确认页里出现了我们的 URL」不是一个判据 —— 见 backlink/SKILL.md 的
// <law-ref id="readiness-must-bind-to-this-query"/>，第 4 个实例是同一个形状。
//
// 这里的测试都是**行为断言**：构造假页面 → 跑真正的探针 `readSubmitOutcome`
// （生产环境是把同一个函数 `.toString()` 进 eval 执行的）→ 跑真正的判据
// `classifySubmitOutcome`。不扫源码文本。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifySubmitOutcome,
  readSubmitOutcome,
  submitOutcomeProbeSource,
} from '../scripts/lib-submit-outcome.mjs';

const OUR_URL = 'https://product.example/';

/** 最小假 DOM。只实现探针真正用到的那几个成员。 */
function makeElement({ name = '', id = '', placeholder = '', value = '' } = {}) {
  return { name, id, placeholder, value };
}
function makeForm({ elements = [], innerText = '', errors = false } = {}) {
  return {
    elements,
    innerText,
    querySelector: () => (errors ? { tagName: 'DIV' } : null),
  };
}
function makeDocument({ forms = [], bodyText = '', title = '' } = {}) {
  return { forms, title, body: { innerText: bodyText } };
}

const submissionFields = (urlValue) => [
  makeElement({ name: 'URL', value: urlValue }),
  makeElement({ name: 'TITLE', value: 'Truthful Product' }),
];

test('a form that silently re-renders with our value echoed back is NOT a success', () => {
  // 这就是那张危险的页面：脚本静默重画同一张表单，把刚提交的 URL 原样回填进 input，
  // 页面顶上还留着一句 "Thank you for your interest"。旧判据（整页扫 thank/success，
  // 或「页面上出现了我们的 URL」）在这上面输出 submitted。
  const document = makeDocument({
    forms: [makeForm({
      elements: submissionFields(OUR_URL),
      innerText: 'Website URL Title Submit listing',
    })],
    bodyText: 'Thank you for your interest Website URL Title Submit listing',
    title: 'Submit a site',
  });
  const probe = readSubmitOutcome(document, OUR_URL);
  assert.equal(probe.formStillPresent, true);
  assert.equal(probe.echoedSubmittedValue, true);
  // 关键：URL 只活在 input.value 里，进不了「表单之外」的区域。
  assert.equal(probe.urlInConfirmationRegion, false);

  const verdict = classifySubmitOutcome({
    ...probe, beforeUrl: 'https://dir.example/submit', afterUrl: 'https://dir.example/submit',
    beforeTitle: 'Submit a site',
  });
  assert.notEqual(verdict.state, 'submitted');
  assert.equal(verdict.state, 'submitted-inconclusive');
  assert.ok(verdict.negative.includes('submission-form-redisplayed-with-our-value'));
  assert.ok(verdict.negative.includes('still-on-the-submit-page'));
});

test('a real confirmation page — our URL outside any form, no form left — is a success', () => {
  const document = makeDocument({
    forms: [],
    bodyText: `Thank you! ${OUR_URL} has been submitted and is pending review.`,
    title: 'Submission received',
  });
  const probe = readSubmitOutcome(document, OUR_URL);
  assert.equal(probe.formStillPresent, false);
  assert.equal(probe.urlInConfirmationRegion, true);
  const verdict = classifySubmitOutcome({
    ...probe, beforeUrl: 'https://dir.example/submit', afterUrl: 'https://dir.example/thanks',
    beforeTitle: 'Submit a site',
  });
  assert.equal(verdict.state, 'submitted');
  assert.deepEqual(verdict.negative, []);
});

test('acceptance copy plus a validation error inside the form is inconclusive, never submitted', () => {
  const document = makeDocument({
    forms: [makeForm({
      elements: submissionFields(OUR_URL),
      innerText: 'Website URL Title Please fix the errors below',
      errors: true,
    })],
    bodyText: `Thanks for submitting. ${OUR_URL} Website URL Title Please fix the errors below`,
    title: 'Submit a site',
  });
  const probe = readSubmitOutcome(document, OUR_URL);
  assert.equal(probe.validationError, true);
  const verdict = classifySubmitOutcome({
    ...probe, beforeUrl: 'https://dir.example/submit', afterUrl: 'https://dir.example/submit',
    beforeTitle: 'Submit a site',
  });
  assert.equal(verdict.state, 'submitted-inconclusive');
  assert.ok(verdict.negative.includes('validation-error-inside-the-form'));
});

test('a newsletter box left on the confirmation page does not spoil a real success', () => {
  // 否定信号必须绑在**提交表单**上：一张没有 URL 字段的邮件订阅表单不是它。
  const document = makeDocument({
    forms: [makeForm({
      elements: [makeElement({ name: 'newsletter_email' })],
      innerText: 'Subscribe to our newsletter Email',
    })],
    bodyText: `Your listing ${OUR_URL} was received. Subscribe to our newsletter Email`,
    title: 'Submission received',
  });
  const probe = readSubmitOutcome(document, OUR_URL);
  assert.equal(probe.formStillPresent, false);
  const verdict = classifySubmitOutcome({
    ...probe, beforeUrl: 'https://dir.example/submit', afterUrl: 'https://dir.example/thanks',
    beforeTitle: 'Submit a site',
  });
  assert.equal(verdict.state, 'submitted');
});

test('nothing happened at all is outcome-unknown, not submitted-unconfirmed', () => {
  const document = makeDocument({
    forms: [makeForm({ elements: submissionFields(''), innerText: 'Website URL Title' })],
    bodyText: 'Website URL Title',
    title: 'Submit a site',
  });
  const verdict = classifySubmitOutcome({
    ...readSubmitOutcome(document, OUR_URL),
    beforeUrl: 'https://dir.example/submit', afterUrl: 'https://dir.example/submit',
    beforeTitle: 'Submit a site',
  });
  assert.equal(verdict.state, 'outcome-unknown');
});

test('a challenge on the confirm step outranks every other signal', () => {
  const verdict = classifySubmitOutcome({
    challenge: true, urlInConfirmationRegion: true, confirmationText: 'Thank you',
    beforeUrl: 'a', afterUrl: 'b',
  });
  assert.equal(verdict.state, 'gated-captcha-on-confirm');
});

test('the browser-side probe source carries the whole function, not a copy', () => {
  // 生产环境跑的必须是上面这些测试跑过的同一份代码。
  const source = submitOutcomeProbeSource(OUR_URL);
  assert.ok(source.includes('urlInConfirmationRegion'), 'probe source must ship the real function body');
  assert.ok(!source.includes('ERROR_SELECTOR_LITERAL'), 'the module-scope binding must be inlined for the browser');
  assert.ok(source.includes('aria-invalid'), 'the error selector must be inlined');
  assert.ok(source.includes(JSON.stringify(OUR_URL)), 'the submitted URL must be passed in');
});

test('both submit drivers route their verdict through the shared criterion', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const name of ['submit-directory.mjs', 'adapter-phpld-submit.mjs']) {
    const source = await readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
    assert.match(source, /classifySubmitOutcome\(/, `${name} must use the shared criterion`);
    assert.match(source, /submitOutcomeProbeSource\(/, `${name} must use the shared probe`);
    // 旧的整页文本判据不许留在原地：它就是那条会输出假 submitted 的分支。
    assert.doesNotMatch(source, /thank\|success\|received\|submitted\|confirm/,
      `${name} still carries the whole-page text criterion`);
  }
});
