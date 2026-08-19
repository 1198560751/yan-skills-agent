#!/usr/bin/env node
/**
 * probe-submission-targets.mjs — first-pass screen over a lead list.
 *
 * Answers, per domain, only what plain HTTP can honestly answer:
 *   does it resolve · where does it end up after redirects · what does the page
 *   say it is · is there a submission route · what is the earliest gate · is
 *   there a price on the page.
 *
 * It deliberately does NOT decide relevance or authority. Per
 * references/acquisition-doctrine.md those rank targets, they never gate them.
 * The only exclusions here are: unreachable, no submission route, or the domain
 * has been repurposed into something that is not a submission surface.
 *
 * Negative claims stay weak on purpose. Plain HTTP cannot prove absence
 * (client-rendered pages, 403-to-scripts), so "no form found" is recorded as
 * `none-found`/`unverified`, never as `dead`. Only a redirect into an unrelated
 * live product marks `dead`, because that IS an observation of presence.
 *
 * CAPTCHA detection follows CONTRIBUTING.md: grep the RAW HTML for the modern
 * services AND for legacy server-rendered field names, because a classic PHP
 * image CAPTCHA loads no third-party script and reads clean otherwise.
 *
 * Usage:
 *   node scripts/probe-submission-targets.mjs \
 *     --input leads.json --out probed.json --concurrency 12 [--limit 50] [--resume]
 *
 * --input accepts the output of third-party-list-ingest.mjs, a JSON array of
 * {domain,urls}, or one domain/URL per line. Writes after every completed batch
 * so an interrupted run keeps everything it already learned; --resume skips
 * domains already present in --out.
 */

import fs from 'node:fs';
import https from 'node:https';
import { cohortOf, primaryGate } from './lib-cohort.mjs';

// An expired or mismatched certificate is a TLS fact, not evidence that a site
// is gone. Measured on one sweep: several domains that failed outright came back
// as live, working directories on a retry that skipped verification. Treating
// them as unreachable would have deleted real targets from the library.
// The retry is used ONLY to learn what the page is; the insecure fetch is
// recorded in the evidence so nobody later mistakes it for a clean read, and no
// credential is ever sent over one — this Skill never authenticates here.
function insecureGet(url, depth = 0) {
  return new Promise((resolve) => {
    if (depth > 4) return resolve({ status: null, finalUrl: null, body: '', error: 'too many redirects' });
    const req = https.get(url, { rejectUnauthorized: false, timeout: TIMEOUT_MS, headers: { 'user-agent': UA, accept: 'text/html,*/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(insecureGet(new URL(res.headers.location, url).toString(), depth + 1));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 400_000) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, finalUrl: url, body }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: null, finalUrl: null, body: '', error: 'timeout' }); });
    req.on('error', (e) => resolve({ status: null, finalUrl: null, body: '', error: String(e.message).slice(0, 160) }));
  });
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const TIMEOUT_MS = 15_000;

function parseArgs(argv) {
  const a = { input: null, out: null, concurrency: 10, limit: Infinity, resume: false };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    const v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${f} needs a value`); return x; };
    if (f === '--input') a.input = v();
    else if (f === '--out') a.out = v();
    else if (f === '--concurrency') a.concurrency = Number(v());
    else if (f === '--limit') a.limit = Number(v());
    else if (f === '--resume') a.resume = true;
    else throw new Error(`unknown flag ${f}`);
  }
  if (!a.input || !a.out) throw new Error('--input and --out are required');
  return a;
}

function loadLeads(file) {
  const raw = fs.readFileSync(file, 'utf8');
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* line list */ }
  if (parsed) {
    const rows = Array.isArray(parsed) ? parsed : parsed.records || parsed.targets || [];
    return rows.map((r) => (typeof r === 'string' ? { domain: r, urls: [] } : { domain: r.domain, urls: r.urls || [], notes: (r.sourceText || []).join(' ').slice(0, 400) }))
      .filter((r) => r.domain);
  }
  return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((d) => ({ domain: d.replace(/^https?:\/\//, '').split('/')[0], urls: [] }));
}

async function once(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const opts = { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA, accept: 'text/html,*/*' } };
    const res = await fetch(url, opts);
    const body = (await res.text()).slice(0, 400_000);
    return { status: res.status, finalUrl: res.url, body };
  } catch (e) {
    const msg = [e.message, e.cause?.message, e.cause?.code].filter(Boolean).join(' ');
    return { status: null, finalUrl: null, body: '', error: String(e.name === 'AbortError' ? 'timeout' : msg).slice(0, 160) };
  } finally { clearTimeout(t); }
}

const TLS_FAIL = /certificate|CERT_|ERR_TLS|SSL|self.signed|ALT_NAME|EPROTO/i;

async function get(url) {
  const first = await once(url);
  if (first.status !== null || !TLS_FAIL.test(first.error || '')) return first;
  if (!url.startsWith('https://')) return first;
  const retry = await insecureGet(url);
  if (retry.status === null) return first;
  return { ...retry, tlsInvalid: true, tlsError: first.error };
}

const stripScripts = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
const titleOf = (html) => (html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim() || null;

// raw HTML — invisible gating lives here and rendering hides it
const CAPTCHA_MODERN = /recaptcha|hcaptcha|turnstile|sitekey|site_key|friendlycaptcha|geetest/i;
// legacy server-rendered image CAPTCHAs load no third-party script at all
const CAPTCHA_LEGACY = /name=["']?(?:captcha|imagehash|security_code|vercode|verifycode|captcha_code)["']?/i;

const SUBMIT_HINT = /(submit|add[-_]?(?:site|url|listing|tool|product|link)|suggest|list[-_]?your|new[-_]?(?:tool|product)|launch|post[-_]?(?:tool|product)|contribute|publish)/i;

const MONEY_RE = /(?:US)?\$\s?\d{1,4}(?:\.\d{2})?|\b\d{1,4}(?:\.\d{2})?\s?(?:USD|EUR)\b/gi;
// Words that make a price a SUBMISSION price rather than some other price on the page.
const COST_CONTEXT = /(submit|submission|listing|list your|feature|featured|publish|package|plan|pricing|fast.?track|priority|review|approval|lifetime|per month|\/mo|\/yr|one.?time)/i;

/**
 * A currency amount on a page is not a submission fee. Measured on one 743-row
 * sweep: about a third of the pages that matched a bare money regex were a
 * single legacy PHPLD directory script whose sidebar sells an **ad banner** for
 * $0.80 while /submit.php is free, and others were quoting the prices of the
 * products they list. Taking any "$" as "submission costs money" mislabelled
 * roughly a quarter of the whole run.
 *
 * So: only count a hit whose surrounding text talks about submitting, listing,
 * or a plan. Unscoped hits are still reported, under a different name, so a
 * human can see the page had money on it somewhere.
 */
function scanPrices(text) {
  const scoped = [];
  const unscoped = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const window = text.slice(Math.max(0, m.index - 160), m.index + 160);
    (COST_CONTEXT.test(window) ? scoped : unscoped).push(m[0]);
  }
  return { priceHits: scoped.slice(0, 6), priceHitsUnscoped: unscoped.slice(0, 4) };
}

function analyse(html) {
  const text = stripScripts(html);
  const lower = text.toLowerCase();
  const forms = [...text.matchAll(/<form[\s\S]{0,4000}?<\/form>/gi)].map((m) => m[0]);
  const inputs = [...text.matchAll(/<input\b[^>]*>/gi)].map((m) => m[0]);
  const hasPassword = /type=["']?password/i.test(text);
  const nameAttrs = inputs.map((i) => (i.match(/name=["']([^"']+)/i) || [])[1]).filter(Boolean);

  return {
    forms: forms.length,
    fieldNames: nameAttrs.slice(0, 40),
    hasPassword,
    captchaModern: CAPTCHA_MODERN.test(html),
    captchaLegacy: CAPTCHA_LEGACY.test(html),
    // visible text only — minified JS is full of "signin" and "$"
    loginWall: /\b(sign in|log in|login required|create an account|register to submit)\b/i.test(lower),
    emailVerify: /\b(verify your email|confirmation email|email verification)\b/i.test(lower),
    reciprocal: /\b(reciprocal|link back to us|add our (?:link|badge))\b/i.test(lower),
    personalContact: /\b(phone number|company email|full name required|business address)\b/i.test(lower),
    ...scanPrices(text),
    freeWord: /\bfree (?:submission|listing|to submit|plan)\b/i.test(lower),
    submitLinks: [...text.matchAll(/href=["']([^"'#]{1,200})["']/gi)].map((m) => m[1]).filter((h) => SUBMIT_HINT.test(h)).slice(0, 8),
  };
}

function classifyKind(title, html) {
  const t = `${title || ''} ${stripScripts(html).slice(0, 4000)}`.toLowerCase();
  if (/\bai tools?\b|ai directory|ai tool directory/.test(t)) return 'ai-directory';
  if (/startup|indie hacker|product launch|launch your/.test(t)) return 'startup-launch';
  if (/saas|software (?:reviews?|alternatives)/.test(t)) return 'saas-review';
  if (/business directory|local business|company directory/.test(t)) return 'business-directory';
  if (/web directory|link directory|site directory/.test(t)) return 'web-directory';
  if (/search engine|submit your url to/.test(t)) return 'search-engine';
  if (/forum|community|developers?/.test(t)) return 'dev-community';
  if (/directory|submit your (?:tool|product|site)/.test(t)) return 'product-directory';
  return 'unknown';
}

// Collect EVERY gate, not just the first. A site can want an account and a
// CAPTCHA and an email confirmation; recording only one of the three hides two
// thirds of what the submission actually costs, and cost is what decides which
// batch it can go in.
function gatesFrom(a) {
  const g = [];
  if (a.captchaModern || a.captchaLegacy) g.push('captcha-interactive');
  if (a.hasPassword || a.loginWall) g.push('account');
  if (a.reciprocal) g.push('reciprocal');
  if (a.personalContact) g.push('personal-contact');
  if (a.emailVerify) g.push('email-verify');
  if (a.forms && !g.length) g.push('open-form');
  if (!a.forms && !g.length) g.push('none-found');
  return g;
}

function decide(probe, a) {
  const bail = (gates, why) => ({ status: 'unverified', gates, gate: primaryGate(gates), cohort: cohortOf(gates), why });
  if (probe.status === null) return bail(['unknown'], `unreachable over plain HTTP (${probe.error}); needs a browser before any claim`);
  if (probe.status >= 500) return bail(['unknown'], `server error ${probe.status}`);
  if (probe.status === 404 || probe.status === 410) return bail(['none-found'], `route answered ${probe.status}`);

  const gates = gatesFrom(a);
  const gate = primaryGate(gates);
  const cohort = cohortOf(gates);

  if (gates.includes('none-found')) {
    return bail(['none-found'], a.submitLinks.length
      ? 'no form on this page, but a submission-looking link exists; follow it in a browser'
      : 'no form and no submission link found over plain HTTP; absence is not provable this way');
  }
  if (cohort === 'open') {
    return { status: 'usable', gates, gate, cohort, why: `reachable ${probe.status}, ${a.forms} form(s), no CAPTCHA/login/reciprocal signal in raw HTML` };
  }
  return { status: 'gated', gates, gate, cohort, why: `reachable ${probe.status}, gates observed: ${gates.join(' + ')}` };
}

async function probeDomain(lead) {
  const candidates = [];
  for (const u of lead.urls || []) candidates.push(u);
  candidates.push(`https://${lead.domain}/`);

  let best = null;
  for (const url of candidates.slice(0, 3)) {
    const r = await get(url);
    if (r.status && r.status < 400) { best = { ...r, tried: url }; break; }
    if (!best) best = { ...r, tried: url };
  }

  const a = analyse(best.body || '');
  const tlsNote = best.tlsInvalid ? ' TLS certificate is invalid, so this was read without verification — treat as a lead, not a clean read.' : '';
  const title = titleOf(best.body || '');
  const d = decide(best, a);
  const today = new Date().toISOString().slice(0, 10);

  const price = a.priceHits.length ? a.priceHits.join(' / ') : null;
  return {
    domain: lead.domain,
    route: best.finalUrl || best.tried,
    name: title,
    kind: classifyKind(title, best.body || ''),
    gate: d.gate,
    gates: d.gates,
    cohort: d.cohort,
    payment: price ? (a.freeWord ? 'optional' : 'required') : (best.status && best.status < 400 ? 'none-seen' : 'unknown'),
    price,
    priceCheckedAt: price ? today : null,
    status: d.status,
    sourceList: lead.sourceList || null,
    notes: lead.notes ? lead.notes.slice(0, 300) : null,
    lastProbedAt: today,
    evidence: {
      method: 'anonymous-http',
      what: d.why + tlsNote,
      httpStatus: best.status,
      finalUrl: best.finalUrl,
      title,
    },
    _signals: { forms: a.forms, captchaModern: a.captchaModern, captchaLegacy: a.captchaLegacy, submitLinks: a.submitLinks, fieldNames: a.fieldNames.slice(0, 12), priceHitsUnscoped: a.priceHitsUnscoped },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let leads = loadLeads(args.input);

  let done = [];
  if (args.resume && fs.existsSync(args.out)) {
    done = JSON.parse(fs.readFileSync(args.out, 'utf8')).targets || [];
    const have = new Set(done.map((t) => t.domain));
    leads = leads.filter((l) => !have.has(l.domain));
  }
  leads = leads.slice(0, args.limit);

  const results = [...done];
  const write = () => fs.writeFileSync(args.out, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    note: 'Anonymous-HTTP first pass. usable/gated mean a route was OBSERVED; unverified means plain HTTP could not tell and a browser is required. No row here claims a published link.',
    targets: results,
  }, null, 2) + '\n');

  const queue = [...leads];
  let n = 0;
  const worker = async () => {
    for (;;) {
      const lead = queue.shift();
      if (!lead) return;
      results.push(await probeDomain(lead));
      if (++n % 20 === 0) { write(); process.stderr.write(`  ${n}/${leads.length}\n`); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, worker));
  write();

  const by = (k) => results.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
  process.stderr.write(`${results.length} probed\nstatus ${JSON.stringify(by('status'))}\ncohort ${JSON.stringify(by('cohort'))}\ngate ${JSON.stringify(by('gate'))}\npayment ${JSON.stringify(by('payment'))}\n`);
}

main();
