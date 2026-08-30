#!/usr/bin/env node
/**
 * safe-fill.mjs — 按 inspect-page 的 scan 指纹回填 payload，装提交守卫，绝不提交。
 *
 * 2026-08-30 双证人化：拒绝路径（page_changed / form_changed / field_changed /
 * captcha / login / no_values）在 exit 2 之前 captureScene（穿透 census + 截图）
 * 落进 --evidence-dir，输出带 evidence——拒绝理由本来就精确，现在配上现场，
 * AI 能直接对质「页面到底变成了什么样」。截图链路已实盘验证。
 */
import { readFile } from 'node:fs/promises';
import { firstJson, makeSubmitGuard, opencli, parseFlags, printJson, required, validateSession, showHelpIfRequested} from './opencli-core.mjs';
import { captureScene, defaultSceneDir } from './lib-evidence-scene.mjs';

const flags = parseFlags(process.argv.slice(2));
showHelpIfRequested(flags, import.meta.url);
const session = validateSession(required(flags, 'session'));
const scan = JSON.parse(await readFile(required(flags, 'scan'), 'utf8'));
const payload = JSON.parse(await readFile(required(flags, 'payload'), 'utf8'));
const allowCaptcha = flags['allow-captcha'] === true && scan.blocker === 'captcha';
if ((!scan.fillable && !allowCaptcha) || !scan.fingerprint) throw new Error('The scan does not contain one safe fillable form.');
for (const key of ['url', 'name', 'email', 'description']) {
  if (payload[key] != null && typeof payload[key] !== 'string') throw new Error(`payload.${key} must be a string.`);
}

const invocation = JSON.stringify({ fingerprint: scan.fingerprint, payload, allowCaptcha });
const fillFunction = `(() => {
  const input = ${invocation};
  const makeSubmitGuard = ${makeSubmitGuard.toString()};
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
  const pageText = document.body?.innerText || '';
  const captcha = document.querySelector('[class*="captcha" i],[id*="captcha" i],[class*="turnstile" i],[id*="turnstile" i],[data-sitekey],iframe[src*="recaptcha" i],iframe[src*="hcaptcha" i],iframe[src*="turnstile" i],iframe[src*="challenges.cloudflare.com" i]');
  if (location.href !== input.fingerprint.url) return { ok: false, reason: 'page_changed', filled: [], submitAttempted: false };
  const form = [...document.forms].find((candidate) => candidate.__backlinkOpenCliScan === input.fingerprint.formMarker);
  if (!form) return { ok: false, reason: 'form_changed', filled: [], submitAttempted: false };
  if (!input.allowCaptcha && (captcha || /\\b(captcha|recaptcha|hcaptcha|turnstile|security challenge)\\b/i.test(pageText))) return { ok: false, reason: 'captcha', filled: [], submitAttempted: false };
  if (form.matches('form[action*="login" i]') || form.querySelector('input[type="password"]')) return { ok: false, reason: 'login', filled: [], submitAttempted: false };
  const nodes = {};
  for (const [kind, expected] of Object.entries(input.fingerprint.fields)) {
    if (!expected) { nodes[kind] = null; continue; }
    const field = [...form.querySelectorAll('input,textarea,select')].find((candidate) => candidate.__backlinkOpenCliScan === expected.marker);
    if (!field || !visible(field) || JSON.stringify(semantic(field)) !== JSON.stringify(expected.semantic)) {
      return { ok: false, reason: 'field_changed', filled: [], submitAttempted: false };
    }
    nodes[kind] = field;
  }
  if (!globalThis.__backlinkOpenCliSubmitGuard) {
    const guard = makeSubmitGuard(input.allowCaptcha);
    document.addEventListener('submit', guard.blockSubmit, true);
    document.addEventListener('click', guard.blockClick, true);
    globalThis.__backlinkOpenCliSubmitGuard = guard;
  } else if (input.allowCaptcha) {
    globalThis.__backlinkOpenCliSubmitGuard.handoffOnly = true;
  }
  const filled = [];
  for (const [kind, field] of Object.entries(nodes)) {
    const value = input.payload[kind];
    if (!field || typeof value !== 'string' || !value.trim()) continue;
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) return { ok: false, reason: 'unsupported_field', filled, submitAttempted: false };
    setter.call(field, value.slice(0, 5000));
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    filled.push(kind);
  }
  return { ok: filled.length > 0, reason: filled.length ? null : 'no_values', filled, submitGuardActive: true, handoffOnly: Boolean(globalThis.__backlinkOpenCliSubmitGuard?.handoffOnly), submitAttempted: false };
})()`;

const evaluated = await opencli(['browser', session, 'eval', fillFunction], { timeoutMs: 60_000 });
const result = firstJson(evaluated.stdout);
if (!result.ok) {
  // **先取证后死**：exit 2 之前把拒绝时刻的现场成对落盘。captureScene 永不 throw。
  const evidenceDir = typeof flags['evidence-dir'] === 'string'
    ? flags['evidence-dir']
    : defaultSceneDir({ script: 'safe-fill' });
  result.evidence = await captureScene({
    session, outDir: evidenceDir, tag: `refused-${result.reason || 'unknown'}`,
    note: `safe-fill refused: ${result.reason || 'unknown'}`,
  });
}
printJson(result);
if (!result.ok) process.exitCode = 2;
