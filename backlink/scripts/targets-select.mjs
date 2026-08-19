#!/usr/bin/env node
/**
 * targets-select.mjs — pick one batch out of data/submission-targets.json.
 *
 * A campaign is planned per cohort, because the cohorts cost different things:
 *   open             nobody needs to be present
 *   captcha          a human has to be at the keyboard
 *   account          credentials and an identity decision, up front
 *   account-captcha  both of the above
 *   email-verify     a mailbox has to be watched while the run is going
 *   reciprocal       the owner's own site has to change — their call, not yours
 *   personal-contact real name / phone / company email — the owner's call too
 *
 * Mixing them in one run is what makes a batch stall: the open rows finish in
 * minutes and then everything waits on a person who was never told they were
 * needed. Select one cohort, run it, then select the next.
 *
 * Usage:
 *   node scripts/targets-select.mjs --cohort open
 *   node scripts/targets-select.mjs --cohort captcha --free-only --limit 50
 *   node scripts/targets-select.mjs --unattended --format urls
 *   node scripts/targets-select.mjs --stats
 *
 * Flags:
 *   --cohort <c>     repeatable. open | captcha | account | account-captcha |
 *                    email-verify | reciprocal | personal-contact |
 *                    manual-review | unknown
 *   --unattended     shorthand for the cohorts that need nobody present
 *   --kind <k>       repeatable, e.g. ai-directory, web-directory
 *   --free-only      drop payment=required (keeps `optional`: a free path exists)
 *   --paid-ok        keep payment=required too (default drops nothing else)
 *   --max-age <days> only rows probed within N days (default: no limit; the
 *                    validator warns past 180 because this genre decays fast)
 *   --limit <n>
 *   --format table|urls|json   default table
 *   --min-traffic <n>  only rows measured at >= n monthly visits. Rows that were
 *                    never measured are DROPPED, not passed — "unmeasured" is not
 *                    "qualified", and treating it as such is how an unscreened
 *                    batch gets filled. Use --unmeasured to list those instead.
 *   --unmeasured     invert: only rows with no traffic measurement yet (i.e. the
 *                    queue for the next screening run)
 *   --stats          print the cohort × payment matrix and exit
 */

import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COHORTS, UNATTENDED } from './lib-cohort.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, '..', 'data', 'submission-targets.json');

const a = { cohort: [], kind: [], freeOnly: false, paidOk: false, maxAge: null, limit: Infinity, format: 'table', stats: false, unattended: false, minTraffic: null, unmeasured: false };
for (let i = 2; i < process.argv.length; i++) {
  const f = process.argv[i];
  const v = () => process.argv[++i];
  if (f === '--cohort') a.cohort.push(v());
  else if (f === '--kind') a.kind.push(v());
  else if (f === '--free-only') a.freeOnly = true;
  else if (f === '--paid-ok') a.paidOk = true;
  else if (f === '--unattended') a.unattended = true;
  else if (f === '--max-age') a.maxAge = Number(v());
  else if (f === '--limit') a.limit = Number(v());
  else if (f === '--format') a.format = v();
  else if (f === '--min-traffic') a.minTraffic = Number(v());
  else if (f === '--unmeasured') a.unmeasured = true;
  else if (f === '--stats') a.stats = true;
  else { process.stderr.write(`unknown flag ${f}\n`); process.exit(2); }
}
for (const c of a.cohort) {
  if (!COHORTS.includes(c)) { process.stderr.write(`unknown cohort "${c}". Known: ${COHORTS.join(', ')}\n`); process.exit(2); }
}

const all = JSON.parse(fs.readFileSync(FILE, 'utf8')).targets;

if (a.stats) {
  const rows = {};
  for (const t of all) {
    rows[t.cohort] ??= { open: 0, optional: 0, required: 0, unknown: 0, total: 0, tPass: 0, tFail: 0, tNone: 0 };
    const k = t.payment === 'none-seen' ? 'open' : t.payment;
    rows[t.cohort][k] = (rows[t.cohort][k] || 0) + 1;
    rows[t.cohort].total++;
    if (!t.traffic) rows[t.cohort].tNone++;
    else if (t.traffic.verdict === 'pass') rows[t.cohort].tPass++;
    else rows[t.cohort].tFail++;
  }
  process.stdout.write(`${all.length} targets. Payment column "open" = no cost seen on the page.\n\n`);
  process.stdout.write(`cohort            total  no-cost  free+paid  paid-only  unknown  traffic>=100  no-traffic  unmeasured\n`);
  for (const [c, r] of Object.entries(rows).sort((x, y) => y[1].total - x[1].total)) {
    process.stdout.write(`${c.padEnd(17)}${String(r.total).padStart(5)}${String(r.open).padStart(9)}${String(r.optional).padStart(11)}${String(r.required).padStart(11)}${String(r.unknown).padStart(9)}${String(r.tPass).padStart(14)}${String(r.tFail).padStart(12)}${String(r.tNone).padStart(12)}\n`);
  }
  process.stdout.write(`\nNone of these rows has a published link yet — they are routes, not placements.\n`);
  process.exit(0);
}

const wanted = new Set(a.unattended ? [...UNATTENDED] : a.cohort);
let out = all.filter((t) => t.status === 'usable' || t.status === 'gated');
if (wanted.size) out = out.filter((t) => wanted.has(t.cohort));
if (a.kind.length) out = out.filter((t) => a.kind.includes(t.kind));
if (a.freeOnly && !a.paidOk) out = out.filter((t) => t.payment !== 'required');
if (a.unmeasured) out = out.filter((t) => !t.traffic);
else if (a.minTraffic != null) {
  // 没测过的一律不放行。「还没测」不等于「合格」，把它当合格就等于没有门槛。
  out = out.filter((t) => t.traffic && t.traffic.verdict === 'pass' && (t.traffic.monthlyVisits ?? 0) >= a.minTraffic);
}
if (a.maxAge != null) {
  const cutoff = Date.now() - a.maxAge * 86_400_000;
  out = out.filter((t) => Date.parse(t.lastProbedAt) >= cutoff);
}
out = out.slice(0, a.limit);

if (a.format === 'json') process.stdout.write(JSON.stringify(out, null, 2) + '\n');
else if (a.format === 'urls') process.stdout.write(out.map((t) => t.route).join('\n') + '\n');
else {
  for (const t of out) {
    const pay = t.payment === 'none-seen' ? '' : `  [${t.payment}${t.price ? ` ${t.price}` : ''}]`;
    const tr = t.traffic ? (t.traffic.monthlyVisits == null ? '   n/a' : String(Math.round(t.traffic.monthlyVisits)).padStart(9)) : '  unmeas.';
    process.stdout.write(`${tr}  ${t.cohort.padEnd(16)} ${t.kind.padEnd(19)} ${t.route}${pay}\n`);
  }
}
process.stderr.write(`${out.length} target(s). These are submission ROUTES; none is a placement until an anchor is observed.\n`);
