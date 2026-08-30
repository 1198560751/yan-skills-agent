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
 *   --min-traffic <n>  only rows whose MEASURED number is >= n monthly visits,
 *                    computed here from `traffic.monthlyVisits` at query time —
 *                    there is no stored verdict field to trust. Rows with no
 *                    number (never measured, or the source reported no data /
 *                    the capture did not complete) are NOT in this batch and are
 *                    NOT "unqualified" either: they are listed separately on
 *                    stderr as 未测/无数字, and the judgment about what an
 *                    absent number means belongs to whoever reads the evidence
 *                    (traffic.evidence points at it). Use --unmeasured to queue
 *                    them for screening or review.
 *   --unmeasured     invert: only rows with no measured number yet — no traffic
 *                    record at all, or a record whose monthlyVisits is null
 *                    (i.e. the queue for the next screening run or for an AI
 *                    read of the evidence)
 *   --file <path>    read targets from this JSON instead of the Skill's
 *                    data/submission-targets.json (tests, dry experiments)
 *   --ledger <path>  exclude domains already tracked in a project ledger file
 *                    (any state >= submitted). The ledger is the project's own
 *                    record of what it has already sent — the Skill database is
 *                    shared, and "submitted" is always project-scoped.
 *   --stats          print the cohort × payment matrix and exit
 */

import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COHORTS, UNATTENDED } from './lib-cohort.mjs';
import { helpGuard } from './opencli-core.mjs';
helpGuard(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, '..', 'data', 'submission-targets.json');

const a = { cohort: [], kind: [], freeOnly: false, paidOk: false, maxAge: null, limit: Infinity, format: 'table', stats: false, unattended: false, minTraffic: null, unmeasured: false, ledger: null, file: FILE };
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
  else if (f === '--ledger') a.ledger = v();
  else if (f === '--file') a.file = v();
  else if (f === '--stats') a.stats = true;
  else { process.stderr.write(`unknown flag ${f}\n`); process.exit(2); }
}
for (const c of a.cohort) {
  if (!COHORTS.includes(c)) { process.stderr.write(`unknown cohort "${c}". Known: ${COHORTS.join(', ')}\n`); process.exit(2); }
}

const all = JSON.parse(fs.readFileSync(a.file, 'utf8')).targets;

/** 有没有实测数字。数字缺失（无 traffic 记录，或记录里 monthlyVisits 为 null）
 *  一律算「未测/无数字」——它可能是没测过、数据源明说没有数据、或采集没完成，
 *  分辨这三者要看 traffic.evidence，脚本不替 AI 下这个判断。 */
const measuredVisits = (t) => (t.traffic && typeof t.traffic.monthlyVisits === 'number' ? t.traffic.monthlyVisits : null);

if (a.stats) {
  const rows = {};
  for (const t of all) {
    rows[t.cohort] ??= { open: 0, optional: 0, required: 0, unknown: 0, total: 0, tNum: 0, tNoNum: 0, tNone: 0 };
    const k = t.payment === 'none-seen' ? 'open' : t.payment;
    rows[t.cohort][k] = (rows[t.cohort][k] || 0) + 1;
    rows[t.cohort].total++;
    if (!t.traffic) rows[t.cohort].tNone++;
    else if (measuredVisits(t) !== null) rows[t.cohort].tNum++;
    else rows[t.cohort].tNoNum++;
  }
  process.stdout.write(`${all.length} targets. Payment column "open" = no cost seen on the page.\n`);
  process.stdout.write(`Traffic columns are measurement states, not verdicts: "no-number" rows have a\n`);
  process.stdout.write(`measurement record but no figure (source reported no data, or the capture did\n`);
  process.stdout.write(`not complete) — read traffic.evidence before treating one as low-traffic.\n\n`);
  process.stdout.write(`cohort            total  no-cost  free+paid  paid-only  unknown  has-number  no-number  unmeasured\n`);
  for (const [c, r] of Object.entries(rows).sort((x, y) => y[1].total - x[1].total)) {
    process.stdout.write(`${c.padEnd(17)}${String(r.total).padStart(5)}${String(r.open).padStart(9)}${String(r.optional).padStart(11)}${String(r.required).padStart(11)}${String(r.unknown).padStart(9)}${String(r.tNum).padStart(12)}${String(r.tNoNum).padStart(11)}${String(r.tNone).padStart(12)}\n`);
  }
  process.stdout.write(`\nNone of these rows has a published link yet — they are routes, not placements.\n`);
  process.exit(0);
}

const wanted = new Set(a.unattended ? [...UNATTENDED] : a.cohort);
let out = all.filter((t) => t.status === 'usable' || t.status === 'gated');
if (wanted.size) out = out.filter((t) => wanted.has(t.cohort));
if (a.kind.length) out = out.filter((t) => a.kind.includes(t.kind));
if (a.freeOnly && !a.paidOk) out = out.filter((t) => t.payment !== 'required');
if (a.unmeasured) out = out.filter((t) => measuredVisits(t) === null);
else if (a.minTraffic != null) {
  // 门槛在这里对实测数字现算——表里没有判决字段可抄。
  // 数字缺失的一律不进批次，但**绝不归入不合格**：没测过、数据源明说没数据、
  // 采集没完成这三种情况全都长成 null，分辨它们要看 traffic.evidence，
  // 那是 AI/人的判断，不是这个 filter 的。这里只把它们单列出来。
  const noNumber = out.filter((t) => t.traffic && measuredVisits(t) === null);
  const neverMeasured = out.filter((t) => !t.traffic);
  out = out.filter((t) => {
    const v = measuredVisits(t);
    return v !== null && v >= a.minTraffic;
  });
  if (noNumber.length || neverMeasured.length) {
    process.stderr.write(
      `min-traffic: excluded ${neverMeasured.length} never-measured and ${noNumber.length} measured-but-no-number row(s). `
      + `Absence of a number is NOT a low-traffic verdict — it can be an unfinished capture or a source empty state; `
      + `read traffic.evidence (stopReason/screenshot/raw) before writing any of them off. List them with --unmeasured.\n`,
    );
  }
}
if (a.maxAge != null) {
  const cutoff = Date.now() - a.maxAge * 86_400_000;
  out = out.filter((t) => Date.parse(t.lastProbedAt) >= cutoff);
}
if (a.ledger) {
  const SUBMITTED_OR_LATER = new Set(['submitted', 'public', 'indexed', 'rel_verified']);
  try {
    const ledgerData = JSON.parse(fs.readFileSync(a.ledger, 'utf8'));
    const submitted = new Set(
      (ledgerData.records || [])
        .filter((r) => SUBMITTED_OR_LATER.has(r.state))
        .map((r) => new URL(r.url).hostname.replace(/^www\./, ''))
    );
    const before = out.length;
    out = out.filter((t) => !submitted.has(t.domain));
    process.stderr.write(`ledger: excluded ${before - out.length} already-submitted domain(s)\n`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
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
