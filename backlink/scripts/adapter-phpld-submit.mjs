#!/usr/bin/env node
/**
 * adapter-phpld-submit.mjs — Lane A for the PHPLD family: press Continue on the
 * rows that showed no challenge, and read what actually came back.
 *
 * Kept separate from the staging adapter on purpose. Staging is safe to run over
 * a whole family; pressing submit is not, and the two must not share a flag that
 * someone can set by accident.
 *
 * It refuses to submit a form that acquired a challenge since staging — PHPLD
 * installs vary, and the challenge sometimes only renders on the second view.
 *
 * Usage: node scripts/adapter-phpld-submit.mjs --queue q.tsv --out result.json
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const a = {};
for (let i = 2; i < process.argv.length; i++) { const f = process.argv[i]; if (f.startsWith('--')) a[f.slice(2)] = process.argv[++i]; }
if (!a.queue) { console.error('need --queue'); process.exit(2); }

const rows = fs.readFileSync(a.queue, 'utf8').split(/\r?\n/).filter(Boolean)
  .map((l) => { const [session, url, state] = l.split('\t'); return { session, url, state }; })
  .filter((r) => r.state === 'filled-no-captcha');

const ocli = (s, ...argv) => execFileSync('opencli', ['browser', s, '--window', 'background', ...argv],
  { encoding: 'utf8', timeout: 90_000, maxBuffer: 16 * 1024 * 1024 })
  .split('\n').filter((l) => !/UNDICI|trace-warnings/.test(l)).join('\n').trim();
const ev = (s, js) => { try { return JSON.parse(ocli(s, 'eval', js)); } catch { return null; } };

const out = [];
for (const r of rows) {
  const res = { url: r.url, session: r.session };
  try {
    const pre = ev(r.session, `(()=>{const f=[...document.forms].find(x=>x.elements.URL&&x.elements.TITLE);
      if(!f) return JSON.stringify({gone:1});
      const challenge=/recaptcha|hcaptcha|turnstile/i.test(document.documentElement.innerHTML)||!!f.elements['g-recaptcha-response']
        ||!!f.querySelector('[name*=captcha i],[name=IMAGEHASH],[name=scode]');
      const b=f.querySelector('input[type=submit],button[type=submit]');
      if(b) b.setAttribute('data-bl-go','1');
      return JSON.stringify({challenge,sel:b?'[data-bl-go="1"]':null,label:b?(b.value||b.innerText||'').trim():null,
        filled:{TITLE:f.elements.TITLE.value,URL:f.elements.URL.value},before:location.href});})()`);
    if (!pre || pre.gone) { res.state = 'form-gone'; out.push(res); continue; }
    if (pre.challenge) { res.state = 'challenge-appeared'; out.push(res); continue; }
    if (!pre.sel) { res.state = 'no-submit-control'; out.push(res); continue; }
    if (!pre.filled.URL) { res.state = 'not-filled'; out.push(res); continue; }
    res.label = pre.label;
    ocli(r.session, 'click', pre.sel);
    execFileSync('sleep', ['3']);
    const after = ev(r.session, `JSON.stringify({url:location.href,title:document.title,
      text:document.body.innerText.replace(/\\s+/g," ").slice(0,400),
      challenge:/recaptcha|hcaptcha|turnstile/i.test(document.documentElement.innerHTML)||!!document.querySelector('[name*=captcha i],[name=IMAGEHASH],[name=scode]')})`);
    res.after = after;
    const t = after?.text || '';
    if (after?.challenge) res.state = 'challenge-on-next-step';
    else if (/thank you|success|received|has been submitted|pending (approval|review)|awaiting (approval|review)/i.test(t)) res.state = 'submitted';
    else if (after?.url !== pre.before) res.state = 'advanced-unconfirmed';
    else res.state = 'outcome-unknown';
  } catch (e) { res.state = 'error'; res.error = String(e.message).slice(0, 160); }
  out.push(res);
  process.stderr.write(`${res.state.padEnd(24)} ${res.url}\n`);
  if (a.out) fs.writeFileSync(a.out, JSON.stringify(out, null, 2) + '\n');
}
process.stderr.write('\n' + JSON.stringify(out.reduce((m, r) => ((m[r.state] = (m[r.state] || 0) + 1), m), {})) + '\n');
