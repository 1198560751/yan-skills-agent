#!/usr/bin/env node
/**
 * fingerprint-forms.mjs — cluster submission targets by the shape of their form.
 *
 * Directory sites are overwhelmingly not bespoke: they run a handful of shared
 * scripts (PHPLD and its descendants, Elementor/WPForms, a few SaaS launch
 * templates). Their field NAMES are the giveaway, and they are stable across
 * every install. So the unit of work is not "a site" but "a family": write one
 * adapter, cover twenty sites.
 *
 * This is what makes plan A cheaper than plan B. Walking 150 forms by hand
 * produces 150 one-off successes; clustering first produces a handful of
 * adapters that keep working for every site built later.
 *
 * Plain HTTP is enough here on purpose — the old directory scripts are
 * server-rendered, and the ones that are not simply cluster as `js-empty`,
 * which is itself a useful bucket (those need the browser).
 *
 * Usage:
 *   node scripts/fingerprint-forms.mjs --cohort open --out /tmp/families.json
 *   node scripts/fingerprint-forms.mjs --urls a.txt --concurrency 12
 */

import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const a = { cohort: null, out: null, concurrency: 12, urls: null, limit: Infinity };
for (let i = 2; i < process.argv.length; i++) {
  const f = process.argv[i]; const v = () => process.argv[++i];
  if (f === '--cohort') a.cohort = v();
  else if (f === '--out') a.out = v();
  else if (f === '--concurrency') a.concurrency = Number(v());
  else if (f === '--limit') a.limit = Number(v());
  else if (f === '--urls') a.urls = v();
}

let targets;
if (a.urls) targets = fs.readFileSync(a.urls, 'utf8').split(/\r?\n/).filter(Boolean).map((route) => ({ domain: new URL(route).hostname, route }));
else {
  const all = JSON.parse(fs.readFileSync(join(HERE, '..', 'data', 'submission-targets.json'), 'utf8')).targets;
  targets = all.filter((t) => (!a.cohort || t.cohort === a.cohort) && t.status !== 'dead');
}
targets = targets.slice(0, a.limit);

const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');

async function grab(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA } });
    return { status: r.status, html: (await r.text()).slice(0, 500_000), finalUrl: r.url };
  } catch (e) { return { status: null, html: '', error: String(e.message).slice(0, 80) }; }
  finally { clearTimeout(t); }
}

function shapeOf(html) {
  const text = strip(html);
  const forms = [...text.matchAll(/<form[\s\S]{0,8000}?<\/form>/gi)].map((m) => m[0]);
  let best = null;
  for (const f of forms) {
    const names = [...f.matchAll(/<(?:input|textarea|select)\b[^>]*\bname=["']([^"']+)["']/gi)].map((m) => m[1]);
    if (!names.some((n) => /url|website|site|link/i.test(n))) continue; // not a submission form
    if (!best || names.length > best.names.length) {
      best = {
        names,
        action: (f.match(/action=["']([^"']*)["']/i) || [])[1] || '',
        captchaModern: /recaptcha|hcaptcha|turnstile|sitekey/i.test(f),
        captchaLegacy: /name=["']?(?:captcha|imagehash|security_code|vercode)/i.test(f),
        password: /type=["']?password/i.test(f),
      };
    }
  }
  return best;
}

// A target's stored route is often just the homepage, and a homepage's only
// form is a search box — which is exactly how a first-pass scan produces an
// "open" cohort that mostly has no submission form on it. So try the routes the
// shared scripts actually use before concluding anything.
const SUBMIT_PATHS = ['', '/submit.php', '/submit', '/add-site', '/addurl.php', '/add.php', '/submit-site', '/suggest', '/submit-tool', '/add-url'];

async function findForm(route) {
  const base = new URL(route);
  const tried = [];
  for (const path of SUBMIT_PATHS) {
    const url = path ? new URL(path, base.origin + '/').toString() : route;
    if (tried.includes(url)) continue;
    tried.push(url);
    const r = await grab(url);
    if (!r.html) continue;
    const shape = shapeOf(r.html);
    if (shape) return { url, r, shape, tried };
  }
  return { url: route, r: await grab(route), shape: null, tried };
}

const results = [];
const queue = [...targets];
let done = 0;
await Promise.all(Array.from({ length: a.concurrency }, async () => {
  for (;;) {
    const t = queue.shift();
    if (!t) return;
    const found = await findForm(t.route);
    const r = found.r; const shape = found.shape;
    // The signature is the SORTED field-name set. Order varies between installs
    // and themes; the set does not.
    const sig = shape ? shape.names.map((n) => n.toLowerCase()).sort().join(',') : (r.status ? 'js-empty-or-no-form' : `unreachable:${r.error || r.status}`);
    results.push({ domain: t.domain, route: shape ? found.url : t.route, status: r.status, sig, shape });
    if (++done % 25 === 0) process.stderr.write(`  ${done}/${targets.length}\n`);
  }
}));

const byS = new Map();
for (const r of results) {
  if (!byS.has(r.sig)) byS.set(r.sig, []);
  byS.get(r.sig).push(r);
}
const families = [...byS.entries()]
  .map(([sig, rows]) => ({ sig, n: rows.length, domains: rows.map((r) => r.domain), sample: rows[0] }))
  .sort((x, y) => y.n - x.n);

if (a.out) fs.writeFileSync(a.out, JSON.stringify({ generatedFrom: a.cohort || a.urls, total: results.length, families }, null, 2) + '\n');
process.stderr.write(`${results.length} probed, ${families.length} distinct form shapes\n`);
for (const f of families.slice(0, 15)) {
  process.stdout.write(`${String(f.n).padStart(3)}  ${f.sig.slice(0, 110)}\n`);
}
