/**
 * lib-submit-outcome.mjs — 「这次提交到底有没有被接受」的唯一判据。
 *
 * 存在的理由，一句话：**「确认页里出现了我们的 URL」不是一个判据。**
 * 见 SKILL.md 的 <law-ref id="readiness-must-bind-to-this-query"/>，第 4 个实例是
 * 同一个形状——「页面上出现了 X」永远要先回答「X 有没有可能由别处提供？」。
 * 提交表单这里，X 的另一个供应商就摆在眼前：**表单自己**。一个校验失败的
 * 目录站脚本会静默重新渲染同一张表单，把刚提交的值原样回填进
 * `<input value="https://our.site/">`。此时：
 *
 *   - `document.documentElement.innerHTML` 里有我们的 URL ✅
 *   - 页面上什么都没被接受 ❌
 *
 * 旧判据（`/thank|success|received|submitted|confirm/i` 扫全页文本，或
 * 「after.url !== before.url」）在这种页面上会输出 `submitted`，然后 ledger 记一条
 * 带证据的 `submitted`，而实际上那条外链从来不存在。
 *
 * 所以这里的判据一律**成对**：
 *   正向 —— 我们的 URL / 受理文案出现在**任何表单之外**的区域（表单里的 value
 *          不进 innerText，页面自己的回显因此进不了这个区域）；
 *   否定 —— 提交表单还在页面上、字段里还回显着我们刚填的值、表单区内出现
 *          error/invalid 标记、或者 URL 和标题都没变（还站在提交页上）。
 *
 * 两半都满足才是 `submitted`。正向成立但否定信号也在 → `submitted-inconclusive`，
 * **不是** `submitted`。这会让一批原本报「成功」的目标变成「不确定」，那是本仓库
 * 想要的方向：宁可显式失败，也不要一个看起来对的错结论。
 *
 * 本文件不碰浏览器。`readSubmitOutcome(document, url)` 被 `.toString()` 进 eval
 * 里执行（和 opencli-core.mjs 的 `releaseSubmitGuard` 一个套路），
 * `classifySubmitOutcome(evidence)` 是纯函数，可以离线喂假页面测。
 */

/** 表单里带这些名字的字段 = 这是一张「提交某个 URL」的表单，不是搜索框/订阅框。 */
export const SUBMISSION_FIELD = /url|website|site|link|homepage/i;

/** 表单区内的校验失败标记。命中任何一个都算否定信号。 */
export const FORM_ERROR_SELECTOR =
  '.error,.errors,.error-message,.is-invalid,.has-error,.invalid-feedback,.field-error,'
  + '[aria-invalid="true"],[role="alert"],.alert-danger,.text-danger';

/** 受理文案。只在「表单之外」的区域里匹配才算数。 */
export const ACCEPTANCE_COPY =
  /thank you|thanks for|success|received|has been submitted|been added|pending (approval|review)|awaiting (approval|review)|under review|提交成功|已提交|等待审核|审核中|感谢/i;

const norm = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();

/**
 * 页面侧探针。**只用最小 DOM 子集**（`forms` / `elements` / `querySelector` /
 * `innerText`），这样离线测试可以拿一个手搓的假 document 跑真正的这一段，
 * 而不是测一份抄写版。
 */
export function readSubmitOutcome(documentTarget, submittedUrl) {
  const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const target = clean(submittedUrl);
  const forms = [...(documentTarget.forms || [])];
  const fieldKey = (element) => `${element.name || ''} ${element.id || ''} ${element.placeholder || ''}`;
  const isSubmissionForm = (form) =>
    [...(form.elements || [])].some((element) => /url|website|site|link|homepage/i.test(fieldKey(element)));

  const live = forms.filter(isSubmissionForm);
  const echoed = target !== ''
    && live.some((form) => [...(form.elements || [])]
      .some((element) => clean(element.value) === target));
  const validationError = live.some((form) => {
    try { return Boolean(form.querySelector(ERROR_SELECTOR_LITERAL)); } catch { return false; }
  });

  // 「表单之外」的文本。表单里的 input value 本来就不进 innerText，这里再把整段
  // 表单文字从 body 文字里减掉，剩下的才是这次提交**之后页面新讲的话**。
  const bodyText = clean(documentTarget.body && documentTarget.body.innerText);
  let confirmationText = bodyText;
  for (const form of live) {
    const formText = clean(form.innerText);
    if (formText) confirmationText = confirmationText.split(formText).join(' ');
  }
  confirmationText = clean(confirmationText);

  return {
    submittedUrl: target,
    formStillPresent: live.length > 0,
    echoedSubmittedValue: echoed,
    validationError,
    urlInConfirmationRegion: target !== '' && confirmationText.includes(target),
    confirmationText: confirmationText.slice(0, 600),
    bodyText: bodyText.slice(0, 600),
    title: clean(documentTarget.title),
  };
}

// `readSubmitOutcome` 会被 `.toString()` 塞进浏览器里执行，届时它引用不到本模块的
// 任何绑定。所以选择器以字面量的形式在源码里替换进去——见 submitOutcomeProbeSource。
const ERROR_SELECTOR_LITERAL = FORM_ERROR_SELECTOR;

/**
 * 生成一段可以直接喂给 `opencli browser <s> eval` 的源码。
 * 把探针函数整体序列化过去，浏览器里跑的和离线测的是同一份代码。
 */
export function submitOutcomeProbeSource(submittedUrl) {
  const body = readSubmitOutcome.toString()
    .replace(/ERROR_SELECTOR_LITERAL/g, JSON.stringify(FORM_ERROR_SELECTOR));
  return `(() => {
    const readSubmitOutcome = ${body};
    const probe = readSubmitOutcome(document, ${JSON.stringify(String(submittedUrl || ''))});
    return JSON.stringify({ ...probe, afterUrl: location.href });
  })()`;
}

/**
 * 纯判据。输入是探针的产物加上点击前记下的 URL/标题，输出一个 state 和它凭什么。
 *
 * state:
 *   `gated-captcha-on-confirm`  确认步骤上又来了一道人来做的关卡
 *   `submitted`                 正向成立且**没有任何**否定信号
 *   `submitted-inconclusive`    正向成立但表单还在/还回显着我们的值/有校验错误
 *   `submitted-unconfirmed`     没有正向证据，但页面确实离开了提交页且无否定信号
 *   `outcome-unknown`           什么都没发生，或者只有否定信号
 */
export function classifySubmitOutcome(evidence = {}) {
  const positive = [];
  const negative = [];

  if (evidence.urlInConfirmationRegion) positive.push('our-url-outside-any-form');
  if (ACCEPTANCE_COPY.test(String(evidence.confirmationText || ''))) positive.push('acceptance-copy-outside-any-form');

  if (evidence.formStillPresent && evidence.echoedSubmittedValue) {
    negative.push('submission-form-redisplayed-with-our-value');
  } else if (evidence.formStillPresent) {
    negative.push('submission-form-still-present');
  }
  if (evidence.validationError) negative.push('validation-error-inside-the-form');

  const urlUnchanged = Boolean(evidence.beforeUrl) && evidence.afterUrl === evidence.beforeUrl;
  const titleUnchanged = Boolean(evidence.beforeTitle) && norm(evidence.title) === norm(evidence.beforeTitle);
  if (urlUnchanged && titleUnchanged) negative.push('still-on-the-submit-page');

  const detail = { positive, negative };
  if (evidence.challenge) return { state: 'gated-captcha-on-confirm', ...detail };
  if (positive.length && !negative.length) return { state: 'submitted', ...detail };
  if (positive.length) return { state: 'submitted-inconclusive', ...detail };
  if (!negative.length && evidence.beforeUrl && evidence.afterUrl && evidence.afterUrl !== evidence.beforeUrl) {
    return { state: 'submitted-unconfirmed', ...detail };
  }
  return { state: 'outcome-unknown', ...detail };
}
