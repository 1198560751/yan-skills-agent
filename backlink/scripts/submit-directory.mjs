#!/usr/bin/env node
/**
 * submit-directory.mjs — walk one directory's submission form in the owner's
 * real Chrome, from a reviewed product profile, and stop at the first thing a
 * human must decide.
 *
 * It never solves a CAPTCHA, never creates an account, never pays, and never
 * accepts terms on someone's behalf. When it meets any of those it fills what
 * it legitimately can, leaves the page sitting there, and reports the state so
 * the row lands in one manual queue instead of stalling the batch.
 *
 * The reason this exists rather than a hand-driven loop: a first screen with no
 * gate says nothing about the second. Measured on the first target attempted —
 * a form whose step 1 asked only for listing type, category, URL, title,
 * description, name and email, with no CAPTCHA anywhere in the raw HTML —
 * a security-code field appeared on the confirm step. Any cohort built from a
 * step-1 scan is therefore optimistic, and the only way to know is to walk it.
 *
 * Usage:
 *   node scripts/submit-directory.mjs --session <s> --profile profile.json \
 *     --url https://example.com/submit [--target-url https://…/deep-page] \
 *     [--submit] [--out result.json]
 *
 * Without --submit it fills and stops before the first state-changing click,
 * which is this Skill's default. With --submit it will advance through steps
 * that are not gated, and still stops dead at a CAPTCHA, login, payment or
 * terms checkbox.
 */

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const f = process.argv[i];
  if (f === '--submit') args.submit = true;
  else if (f.startsWith('--')) args[f.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = process.argv[++i];
}
if (!args.session || !args.profile || !args.url) {
  console.error('need --session, --profile and --url');
  process.exit(2);
}

const profile = JSON.parse(fs.readFileSync(args.profile, 'utf8'));
const targetUrl = args.targetUrl || profile.linkTargets?.default || profile.canonicalUrl;

// ONE SESSION PER STAGED SITE. A session name owns exactly one tab, so a staged
// queue of N forms needs N session names. `tab new` + `open --tab` looks like
// the answer and is not: measured on opencli 1.8.6, a session tracks only its
// newest tab (earlier ids drop out of `tab list`), `tab select` reports success
// with no effect on reads, and `open --tab <id>` opens a *new* tab while
// leaving the named one untouched. Driving the queue that way leaks tabs and
// silently reduces it to a queue of one while still reporting N staged.
// `adapter-phpld.mjs` derives its session names the same way.
const session = args.newTab
  ? `${args.session}-${new URL(args.url).hostname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40)}`
  : args.session;

function ocli(...argv) {
  const out = execFileSync('opencli', ['browser', session, '--window', 'background', ...argv], {
    encoding: 'utf8', timeout: 90_000, maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\n').filter((l) => !/UNDICI|trace-warnings/.test(l)).join('\n').trim();
}
const evalJs = (js) => {
  const raw = ocli('eval', js);
  try { return JSON.parse(raw); } catch { return raw; }
};

// Field mapping is fuzzy on purpose: directory scripts name the same field
// `url`, `vurl`, `site_url`, `LINK_URL`, `website`. Matching on a canonical
// intent rather than an exact name is what makes one driver cover many sites.
const INTENT = [
  ['url', /(^|_|\b|v)(url|website|site|link|homepage)(_|\b|$)/i],
  ['title', /(title|sitename|site_name|productname|product_name|^name$|vname|company)/i],
  ['description', /(desc|description|about|summary|details|content|body|message)/i],
  ['email', /(mail)/i],
  ['owner', /(yourname|your_name|contact|submitter|firstname|fullname|author|vname)/i],
];

const FILL_JS = (payload) => `
(() => {
  const P = ${JSON.stringify(payload)};
  const forms = [...document.forms];
  const score = (f) => [...f.elements].filter(e => /text|email|url|textarea/i.test(e.type||e.tagName)).length
    + (/(submit|add|suggest|list|post)/i.test(f.action||'') ? 3 : 0)
    - (/(search|newsletter|subscribe|login|signin)/i.test((f.action||'') + (f.name||'') + (f.id||'')) ? 10 : 0);
  const f = forms.sort((a,b) => score(b) - score(a))[0];
  if (!f || score(f) < 2) return JSON.stringify({ ok:false, reason:'no qualifying form' });

  // HARD GUARD. A directory submission always carries a URL field. A form that
  // has none is something else on the page, and the something else is usually a
  // newsletter box — which means the alternative to this check is subscribing
  // the brand's official mailbox to strangers' mailing lists, one site at a
  // time, while reporting it as backlink work. Measured: the generic scorer
  // picked exactly such a form on a real target.
  const elsAll = [...f.elements].filter(e => e.name && !e.disabled);
  const hasUrlField = elsAll.some(e => /url|website|site|link|homepage/i.test((e.name||'') + (e.id||'') + (e.placeholder||'')));
  const looksLikeNewsletter = elsAll.length <= 3
    && elsAll.some(e => e.type === 'email')
    && /subscribe|newsletter|signup|sign-up|join|convertkit|mailchimp|beehiiv/i.test((f.action||'') + (f.className||'') + (f.id||''));
  if (!hasUrlField) return JSON.stringify({ ok:false, reason:'no URL field — this is not a submission form' });
  if (looksLikeNewsletter) return JSON.stringify({ ok:false, reason:'newsletter form, refusing' });

  const els = elsAll;
  const has = (re) => els.find(e => re.test(e.name) || re.test(e.id||'') || re.test(e.placeholder||''));
  if (els.some(e => e.type === 'password')) return JSON.stringify({ ok:false, reason:'account required (password field)' });

  const captcha = /recaptcha|hcaptcha|turnstile|sitekey/i.test(document.documentElement.innerHTML)
    || els.some(e => /captcha|imagehash|security_code|vercode|scode|verif/i.test(e.name));

  const terms = els.find(e => e.type === 'checkbox' && /(agree|terms|accept|consent|policy)/i.test((e.name||'')+(e.id||'')));

  const filled = {};
  const put = (el, v) => { if (!el || v == null) return; el.value = v;
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
    filled[el.name] = String(v).slice(0,60); };

  for (const [intent, re] of ${JSON.stringify(INTENT.map(([k, r]) => [k, r.source]))}.map(([k,s]) => [k, new RegExp(s,'i')])) {
    const el = els.find(e => e.type !== 'hidden' && e.type !== 'submit' && (re.test(e.name) || re.test(e.id||'')));
    if (!el || filled[el.name]) continue;
    const isArea = el.tagName === 'TEXTAREA';
    const cap = Number(el.getAttribute('maxlength')) || (isArea ? 800 : 200);
    if (intent === 'url') put(el, P.url);
    else if (intent === 'title') put(el, P.brand);
    else if (intent === 'description') put(el, cap >= 700 ? P.long : cap >= 400 ? P.medium : cap >= 160 ? P.short150 : P.short50);
    else if (intent === 'email') put(el, P.email);
    else if (intent === 'owner') put(el, P.owner);
  }

  // Second pass over what the intent pass skipped. One form often carries two
  // URL fields (the submitter site and the tool being listed) plus a bare
  // subject field; leaving those empty is how a submission is silently
  // rejected while the driver reports success.
  for (const el of els) {
    if (filled[el.name] || ['hidden','submit','button','image','checkbox','radio','file'].includes(el.type)) continue;
    const key = ((el.name||'') + ' ' + (el.id||'') + ' ' + (el.placeholder||'')).toLowerCase();
    if (/url|link|website|site/.test(key)) put(el, P.url);
    else if (/subject|title|topic|headline/.test(key)) put(el, P.brand);
    else if (/name/.test(key)) put(el, P.owner);
  }

  return JSON.stringify({
    ok: Object.keys(filled).length > 0,
    captcha,
    filled,
    termsCheckbox: terms ? (terms.name||terms.id) : null,
    action: f.action, method: f.method,
    submitLabels: [...f.querySelectorAll('input[type=submit],button')].map(b => (b.value||b.innerText||'').trim()).slice(0,4),
    unfilled: els.filter(e => !filled[e.name] && !['hidden','submit','button','image'].includes(e.type)).map(e => e.name).slice(0,12),
  });
})()`;

const payload = {
  url: targetUrl,
  brand: profile.brand,
  email: profile.contactEmail,
  owner: profile.submitterName || profile.brand,
  short50: profile.descriptions.short50,
  short150: profile.descriptions.short150,
  medium: profile.descriptions.medium500,
  long: profile.descriptions.long800,
};

const result = { url: args.url, targetUrl, at: new Date().toISOString() };
try {
  // --new-tab gives this target its OWN SESSION so a staged form can be LEFT on
  // screen. The queue is only useful if every staged form is still sitting
  // there when the person sits down; reusing one session overwrites the
  // previous form and the queue silently becomes a queue of one.
  ocli('open', args.url);
  if (args.newTab) result.session = session;
  const page = evalJs('JSON.stringify({url:location.href,title:document.title,len:document.body.innerText.length})');
  result.page = page;
  if (typeof page === 'object' && /just a moment|attention required|bot challenge/i.test(page.title || '')) {
    result.state = 'blocked-by-antibot';
  } else {
    const fill = evalJs(FILL_JS(payload));
    result.fill = fill;
    if (!fill.ok) result.state = /account/.test(fill.reason || '') ? 'gated-account' : 'no-form';
    // Two lanes, and the CAPTCHA lane is not a failure lane. Everything the
    // driver may legitimately fill is filled and left on screen, so the person
    // clearing the queue types a code and clicks — seconds per site instead of
    // re-entering a whole listing.
    else if (fill.captcha) result.state = 'staged-captcha';
    else if (fill.termsCheckbox) result.state = 'staged-terms';
    else if (!args.submit) result.state = 'filled-stopped';
    else {
      // The state-changing click. Everything above refuses to reach here when a
      // human must decide: CAPTCHA, account, or a terms checkbox.
      const before = evalJs('JSON.stringify({url:location.href,len:document.body.innerText.length})');
      // Click the real control. requestSubmit()/form.submit() bypass a handler
      // bound to the BUTTON's click, which is how AJAX forms are wired — the
      // network capture then shows no request at all while the page looks
      // unchanged, i.e. a silent no-op that reads exactly like a silent success.
      const sel = evalJs(`(()=>{const f=[...document.forms].sort((a,b)=>[...b.elements].length-[...a.elements].length)[0];
        const b=f.querySelector('input[type=submit],button[type=submit],button');
        if(!b) return JSON.stringify({sel:null});
        b.setAttribute('data-bl-submit','1');
        return JSON.stringify({sel:'[data-bl-submit="1"]',label:(b.value||b.innerText||'').trim()});})()`);
      result.submitControl = sel;
      // Refuse to click a control that is not plausibly this form's submit.
      // One target's "submit labels" came back as four product names, i.e. the
      // scorer had found page buttons, not the form's own action.
      const label = (sel && sel.label || '').toLowerCase();
      const plausible = !label || /submit|send|add|post|save|continue|next|go|提交|发送|投稿/.test(label);
      if (!plausible) { result.state = 'no-submit-control'; result.refusedControl = sel.label; }
      else if (sel && sel.sel) { try { ocli('click', sel.sel); } catch (e) { result.clickError = String(e.message).slice(0, 200); } }
      execFileSync('sleep', ['4']);
      const after = evalJs('JSON.stringify({url:location.href,title:document.title,text:document.body.innerText.replace(/\\s+/g," ").slice(0,400)})');
      result.after = after;
      const txt = `${after.text || ''} ${after.title || ''}`;
      // A thank-you page is not proof the listing exists; it is proof the form
      // was accepted. The ledger state that follows is `submitted`, never
      // `public` — that needs the anchor seen on a live page later.
      if (/scode|captcha|security code|verification/i.test(txt)) result.state = 'gated-captcha-on-confirm';
      else if (/thank|success|received|submitted|confirm/i.test(txt)) result.state = 'submitted';
      else if (after.url !== before.url) result.state = 'submitted-unconfirmed';
      else result.state = 'outcome-unknown';
    }
  }
} catch (e) {
  result.state = 'error';
  result.error = String(e.message).slice(0, 300);
}

if (args.out) fs.writeFileSync(args.out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
