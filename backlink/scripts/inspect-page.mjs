#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { defaultSession, firstJson, opencli, parseFlags, printJson, required, validateSession } from './opencli-core.mjs';

const flags = parseFlags(process.argv.slice(2));
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
    return style.display !== 'none' && style.visibility !== 'hidden';
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
  const bodyText = document.body?.innerText || '';
  const captchaNode = document.querySelector('[class*="captcha" i],[id*="captcha" i],[class*="turnstile" i],[id*="turnstile" i],[data-sitekey],iframe[src*="recaptcha" i],iframe[src*="hcaptcha" i],iframe[src*="turnstile" i],iframe[src*="challenges.cloudflare.com" i]');
  const blocker = captchaNode || /\\b(captcha|recaptcha|hcaptcha|turnstile|security challenge)\\b/i.test(bodyText)
    ? 'captcha'
    : /\\b(sign in|log in|login|required to log in|continue with google)\\b/i.test(bodyText)
      ? 'login'
      : null;
  const summaries = [...document.forms].map((form, formIndex) => {
    const controls = [...form.querySelectorAll('input,textarea,select')].filter(visible);
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
      ambiguous,
      qualifies,
      submitLabels: [...form.querySelectorAll('button,input[type="submit"]')].filter(visible).map(label).filter(Boolean)
    };
  });
  const qualified = summaries.filter((form) => form.qualifies);
  const selected = !blocker && qualified.length === 1 ? qualified[0] : null;
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
    fillable: Boolean(selected),
    reason: blocker || (qualified.length > 1 ? 'ambiguous_forms' : qualified.length === 0 ? 'no_safe_submission_form' : null),
    selectedForm: selected,
    forms: summaries,
    fingerprint
  };
})()`;

await opencli(['browser', session, 'open', url.toString()], {
  env: { OPENCLI_WINDOW: windowMode },
  timeoutMs: 60_000,
});
if (waitSeconds > 0) await opencli(['browser', session, 'wait', 'time', String(waitSeconds)], { timeoutMs: 30_000 });
const evaluated = await opencli(['browser', session, 'eval', scanFunction], { timeoutMs: 60_000 });
const scan = firstJson(evaluated.stdout);
const output = { session, ...scan };
if (typeof flags.out === 'string') await writeFile(flags.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
printJson(output);
