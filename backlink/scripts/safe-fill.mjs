#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { firstJson, opencli, parseFlags, printJson, required, validateSession } from './opencli-core.mjs';

const flags = parseFlags(process.argv.slice(2));
const session = validateSession(required(flags, 'session'));
const scan = JSON.parse(await readFile(required(flags, 'scan'), 'utf8'));
const payload = JSON.parse(await readFile(required(flags, 'payload'), 'utf8'));
if (!scan.fillable || !scan.fingerprint) throw new Error('The scan does not contain one safe fillable form.');
for (const key of ['url', 'name', 'email', 'description']) {
  if (payload[key] != null && typeof payload[key] !== 'string') throw new Error(`payload.${key} must be a string.`);
}

const invocation = JSON.stringify({ fingerprint: scan.fingerprint, payload });
const fillFunction = `(() => {
  const input = ${invocation};
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
  const pageText = document.body?.innerText || '';
  const captcha = document.querySelector('[class*="captcha" i],[id*="captcha" i],[class*="turnstile" i],[id*="turnstile" i],[data-sitekey],iframe[src*="recaptcha" i],iframe[src*="hcaptcha" i],iframe[src*="turnstile" i],iframe[src*="challenges.cloudflare.com" i]');
  if (captcha || /\\b(captcha|recaptcha|hcaptcha|turnstile|security challenge)\\b/i.test(pageText)) return { ok: false, reason: 'captcha', filled: [], submitAttempted: false };
  if (/\\b(sign in|log in|login|required to log in|continue with google)\\b/i.test(pageText)) return { ok: false, reason: 'login', filled: [], submitAttempted: false };
  if (location.href !== input.fingerprint.url) return { ok: false, reason: 'page_changed', filled: [], submitAttempted: false };
  const form = [...document.forms].find((candidate) => candidate.__backlinkOpenCliScan === input.fingerprint.formMarker);
  if (!form) return { ok: false, reason: 'form_changed', filled: [], submitAttempted: false };
  const nodes = {};
  for (const [kind, expected] of Object.entries(input.fingerprint.fields)) {
    if (!expected) { nodes[kind] = null; continue; }
    const field = [...form.querySelectorAll('input,textarea,select')].find((candidate) => candidate.__backlinkOpenCliScan === expected.marker);
    if (!field || JSON.stringify(semantic(field)) !== JSON.stringify(expected.semantic)) {
      return { ok: false, reason: 'field_changed', filled: [], submitAttempted: false };
    }
    nodes[kind] = field;
  }
  if (!globalThis.__backlinkOpenCliSubmitGuard) {
    const blockSubmit = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const blockClick = (event) => {
      if (event.target?.closest?.('button[type="submit"],input[type="submit"]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener('submit', blockSubmit, true);
    document.addEventListener('click', blockClick, true);
    globalThis.__backlinkOpenCliSubmitGuard = { blockSubmit, blockClick };
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
  return { ok: filled.length > 0, reason: filled.length ? null : 'no_values', filled, submitGuardActive: true, submitAttempted: false };
})()`;

const evaluated = await opencli(['browser', session, 'eval', fillFunction], { timeoutMs: 60_000 });
const result = firstJson(evaluated.stdout);
printJson(result);
if (!result.ok) process.exitCode = 2;
