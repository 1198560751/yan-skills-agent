#!/usr/bin/env node
/**
 * inspect-page.mjs — 一个目标页的**全表单普查** + 现场截图。
 *
 * 2026-08-30 双证人化：输出以普查为主体——每个 form 每个 field 的语义七元组
 * （tag/type/id/name/label/autocomplete/placeholder）+ 稳定 marker，含隐藏控件
 * （visible: false）；随后 captureScene 落一对现场（穿透 census + 截图）进
 * --evidence-dir。`fillable` / `blocker` / `reason` / `selectedForm` 是**启发式
 * 建议（见 suggested 字段），不是判决**：判断由 AI 基于 forms 普查 + 截图做，
 * 可推翻。safe-fill.mjs 只把 fillable 当机械前置条件用。截图链路待实盘验证。
 *
 * 用法：
 *   node inspect-page.mjs --url https://x/submit [--mode auto|directory|comment]
 *     [--out scan.json] [--evidence-dir dir] [--session s] [--wait n]
 */
import { writeFile } from 'node:fs/promises';
import { defaultSession, firstJson, openAndEval, parseFlags, printJson, required, validateSession, showHelpIfRequested} from './opencli-core.mjs';
import { captureScene, defaultSceneDir } from './lib-evidence-scene.mjs';

const flags = parseFlags(process.argv.slice(2));
showHelpIfRequested(flags, import.meta.url);
const url = new URL(required(flags, 'url'));
if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs are supported.');
const session = flags.session ? validateSession(flags.session) : defaultSession('backlink-work');
const waitSeconds = Math.max(0, Math.min(15, Number(flags.wait || 3)));
const windowMode = flags.window === 'foreground' ? 'foreground' : 'background';
const mode = ['auto', 'directory', 'comment'].includes(flags.mode) ? flags.mode : 'auto';

const scanFunction = `(() => {
  const requestedMode = ${JSON.stringify(mode)};
  const visible = (element) => {
    if (!element || element.hidden || element.disabled) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const pageWidth = Math.max(document.documentElement.clientWidth, innerWidth || 0);
    const pageHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
      && rect.width >= 2 && rect.height >= 2
      && rect.right > 0 && rect.left < pageWidth && rect.bottom > 0 && rect.top < pageHeight;
  };
  const label = (element) => {
    const explicit = element.id ? document.querySelector('label[for="' + CSS.escape(element.id) + '"]')?.innerText : '';
    return (explicit || element.closest('label')?.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.name || element.id || '').trim();
  };
  const semantic = (element) => [
    element.tagName.toLowerCase(),
    element.getAttribute('type') || '',
    element.id || '',
    element.name || '',
    label(element),
    element.getAttribute('autocomplete') || '',
    element.getAttribute('placeholder') || ''
  ];
  const marker = (element) => {
    if (!element.__backlinkOpenCliScan) element.__backlinkOpenCliScan = crypto.randomUUID();
    return element.__backlinkOpenCliScan;
  };
  const text = (element) => semantic(element).join(' ');
  const directoryPatterns = {
    url: /(url|website|web.?site|homepage|site.?link|product.?link)/i,
    email: /(e-?mail)/i,
    name: /(product|tool|site|company|business).{0,8}(name|title)|(name|title).{0,8}(product|tool|site|company|business)/i,
    description: /(description|summary|about|details|introduction|tagline)/i
  };
  const commentPatterns = {
    url: /(url|website|web.?site|homepage)/i,
    email: /(e-?mail)/i,
    name: /(^|\\b)(name|author|nickname)(\\b|$)/i,
    description: /(comment|reply|message|response)/i
  };
  const classifyBlocker = (captcha, login, qualifiedForms) => captcha ? 'captcha' : login && qualifiedForms === 0 ? 'login' : null;
  const bodyText = document.body?.innerText || '';
  const captchaNode = document.querySelector('[class*="captcha" i],[id*="captcha" i],[class*="turnstile" i],[id*="turnstile" i],[data-sitekey],iframe[src*="recaptcha" i],iframe[src*="hcaptcha" i],iframe[src*="turnstile" i],iframe[src*="challenges.cloudflare.com" i]');
  const captchaDetected = Boolean(captchaNode || /\\b(captcha|recaptcha|hcaptcha|turnstile|security challenge)\\b/i.test(bodyText));
  const loginDetected = /\\b(sign in|log in|login|required to log in|continue with google)\\b/i.test(bodyText);
  const summaries = [...document.forms].map((form, formIndex) => {
    // 全字段普查：每个控件的语义七元组 + 稳定 marker + 可见性。隐藏控件也进普查
    // （visible: false）——CSRF token、蜜罐字段、被折叠的步骤都在这里现形，
    // AI 判「这张表单是什么」要看全量，不能只看启发式挑出来的四个字段。
    const allControls = [...form.querySelectorAll('input,textarea,select,button')];
    const controls = allControls.filter((el) => el.matches('input,textarea,select')).filter(visible);
    const fieldCensus = allControls.map((el) => ({
      marker: marker(el),
      semantic: semantic(el),
      visible: visible(el),
      required: el.required || false,
    }));
    const looksLikeComment = controls.some((field) => field.tagName === 'TEXTAREA' && commentPatterns.description.test(text(field)));
    const detectedMode = looksLikeComment ? 'comment' : 'directory';
    const patterns = detectedMode === 'comment' ? commentPatterns : directoryPatterns;
    const candidates = {};
    for (const kind of Object.keys(patterns)) {
      candidates[kind] = controls.filter((field) => {
        if (kind === 'url' && field.type === 'url') return true;
        if (kind === 'email' && field.type === 'email') return true;
        if (kind === 'description' && field.tagName === 'TEXTAREA') return true;
        return patterns[kind].test(text(field));
      });
    }
    const ambiguous = Object.entries(candidates).filter(([, fields]) => fields.length > 1).map(([kind]) => kind);
    const fields = Object.fromEntries(Object.entries(candidates).map(([kind, fieldsForKind]) => {
      const field = fieldsForKind.length === 1 ? fieldsForKind[0] : null;
      return [kind, field ? { marker: marker(field), semantic: semantic(field) } : null];
    }));
    const modeMatches = requestedMode === 'auto' || requestedMode === detectedMode;
    const requiredFields = detectedMode === 'comment'
      ? Boolean(fields.url && fields.description)
      : Boolean(fields.url && (fields.name || fields.description));
    const qualifies = modeMatches && requiredFields && ambiguous.length === 0 && !form.querySelector('input[type="password"]');
    return {
      formIndex,
      mode: detectedMode,
      action: form.action,
      method: (form.method || 'get').toLowerCase(),
      marker: marker(form),
      fields,
      fieldCensus,
      ambiguous,
      qualifies,
      submitLabels: [...form.querySelectorAll('button,input[type="submit"]')].filter(visible).map(label).filter(Boolean)
    };
  });
  const qualified = summaries.filter((form) => form.qualifies);
  const blocker = classifyBlocker(captchaDetected, loginDetected, qualified.length);
  const selected = qualified.length === 1 ? qualified[0] : null;
  const fingerprint = selected ? {
    url: location.href,
    formMarker: selected.marker,
    fields: selected.fields,
    signature: JSON.stringify({ url: location.href, formMarker: selected.marker, fields: selected.fields })
  } : null;
  return {
    version: 1,
    scannedAt: new Date().toISOString(),
    url: location.href,
    title: document.title,
    language: document.documentElement.lang || '',
    requestedMode,
    blocker,
    formCount: summaries.length,
    qualifiedFormCount: qualified.length,
    fillable: Boolean(selected && !blocker),
    reason: blocker || (qualified.length > 1 ? 'ambiguous_forms' : qualified.length === 0 ? 'no_safe_submission_form' : null),
    selectedForm: selected,
    forms: summaries,
    fingerprint
  };
})()`;

const evalResult = await openAndEval(session, url.toString(), scanFunction, {
  wait: waitSeconds,
  windowMode,
  timeoutMs: 120_000,
});
const scan = typeof evalResult === 'string' ? JSON.parse(evalResult) : evalResult;
// 普查之外的第二证人：穿透 census + 截图。判断（这页能不能填、卡在什么闸门）
// 由 AI 拿 forms 普查和这对现场做；captureScene 永不 throw。
const evidenceDir = typeof flags['evidence-dir'] === 'string'
  ? flags['evidence-dir']
  : defaultSceneDir({ out: typeof flags.out === 'string' ? flags.out : null, script: 'inspect-page' });
const scene = await captureScene({
  session, outDir: evidenceDir, windowMode, tag: 'scan',
  note: `inspect-page ${url.toString()}`,
});
const output = {
  session,
  // fillable/blocker/reason/selectedForm 是下面 suggested.note 说明的启发式建议。
  suggested: {
    fields: ['fillable', 'blocker', 'reason', 'selectedForm', 'qualifies'],
    note: '这些字段是脚本内正则/计数的启发式建议，不是判决——判断由 AI 基于 forms 普查（每表单 fieldCensus）+ evidence 现场做，可推翻。safe-fill 只把 fillable 当机械前置条件。',
  },
  evidence: scene,
  ...scan,
};
if (typeof flags.out === 'string') await writeFile(flags.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
printJson(output);
