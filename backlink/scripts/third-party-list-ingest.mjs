#!/usr/bin/env node
/**
 * third-party-list-ingest.mjs — turn someone else's "backlink list" into rows
 * you can screen, and diff it against what you already have.
 *
 * A third-party list is a lead list, never a fact list. Every column in it is an
 * assertion about a platform, not an observation of a link. This script does the
 * only two things that are safe to do without a browser: normalise the rows, and
 * tell you which of them are new to you. It records NOTHING as verified — the
 * output's `verdict` is always `candidate`.
 *
 * Input: a Markdown file. Any pipe table is read; every http(s) URL found in a
 * row becomes a candidate, and the rest of the row is kept as free text so the
 * source's own caveats ("dead", "paid", "already listed") survive into triage.
 * Plain bullet/link lists work too.
 *
 * Verified 2026-08-19 against a 743-row public list (flaqai/backlink_skills).
 *
 * Usage:
 *   node scripts/third-party-list-ingest.mjs --input LIST.md --out out.json
 *   node scripts/third-party-list-ingest.mjs --input LIST.md \
 *     --known data/free-channels.json --known ../project/.rankup/backlink-targets.json \
 *     --drop-pattern '停服|已停止|dead|shut ?down' --out out.json
 *
 * Flags:
 *   --input <md>          required; repeatable
 *   --out <json>          write normalised rows here (default: stdout summary only)
 *   --known <json>        repeatable; any JSON — every http(s) URL and bare
 *                         hostname anywhere inside it counts as "already known"
 *   --drop-pattern <re>   rows whose text matches are marked `excluded` with the
 *                         matched reason, not silently deleted
 *   --flag-pattern <re>   rows whose text matches get `needsCheck` set
 *   --new-only            emit only rows whose registrable domain is not known
 */

import fs from 'node:fs';

function parseArgs(argv) {
  const out = { input: [], known: [], dropPattern: null, flagPattern: null, out: null, newOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--input') out.input.push(val());
    else if (a === '--known') out.known.push(val());
    else if (a === '--out') out.out = val();
    else if (a === '--drop-pattern') out.dropPattern = new RegExp(val(), 'iu');
    else if (a === '--flag-pattern') out.flagPattern = new RegExp(val(), 'iu');
    else if (a === '--new-only') out.newOnly = true;
    else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]); process.exit(0); }
    else throw new Error(`unknown flag ${a}`);
  }
  if (!out.input.length) throw new Error('--input is required');
  return out;
}

const URL_RE = /https?:\/\/[^\s<>()\[\]|"']+/giu;

/** Registrable-ish domain. Not PSL-accurate; good enough to dedupe a lead list. */
export function normDomain(hostOrUrl) {
  let h = String(hostOrUrl).trim().toLowerCase();
  h = h.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  h = h.replace(/:\d+$/, '').replace(/\.$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return null;
  return h.replace(/^www\./, '');
}

function collectKnown(files) {
  const known = new Set();
  for (const f of files) {
    const raw = fs.readFileSync(f, 'utf8');
    for (const m of raw.matchAll(URL_RE)) {
      const d = normDomain(m[0]);
      if (d) known.add(d);
    }
    // bare hostnames in string values, e.g. {"domain":"example.com"}
    for (const m of raw.matchAll(/"([a-z0-9-]+(?:\.[a-z0-9-]+)+)"/giu)) {
      const d = normDomain(m[1]);
      if (d) known.add(d);
    }
  }
  return known;
}

function rowsFrom(md) {
  const rows = [];
  for (const line of md.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/^\|?\s*[-: ]+\|[-:| ]*$/.test(t)) continue; // table separator
    const urls = [...t.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;>]+$/, ''));
    if (!urls.length) continue;
    rows.push({ text: t, urls });
  }
  return rows;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const known = collectKnown(args.known);

  const byDomain = new Map();
  let rawRows = 0;
  for (const file of args.input) {
    for (const row of rowsFrom(fs.readFileSync(file, 'utf8'))) {
      rawRows++;
      for (const url of row.urls) {
        const domain = normDomain(url);
        if (!domain) continue;
        const prev = byDomain.get(domain);
        const rec = prev || {
          domain,
          urls: [],
          sourceText: [],
          sourceFile: file,
          verdict: 'candidate',
          known: known.has(domain),
          excluded: null,
          needsCheck: false,
        };
        if (!rec.urls.includes(url)) rec.urls.push(url);
        if (!rec.sourceText.includes(row.text)) rec.sourceText.push(row.text);
        if (args.dropPattern && args.dropPattern.test(row.text)) {
          rec.excluded = `matched --drop-pattern: ${(row.text.match(args.dropPattern) || [''])[0]}`;
          rec.verdict = 'excluded';
        }
        if (args.flagPattern && args.flagPattern.test(row.text)) rec.needsCheck = true;
        byDomain.set(domain, rec);
      }
    }
  }

  let records = [...byDomain.values()].sort((a, b) => a.domain.localeCompare(b.domain));
  const stats = {
    rawRows,
    uniqueDomains: records.length,
    alreadyKnown: records.filter((r) => r.known).length,
    excluded: records.filter((r) => r.verdict === 'excluded').length,
    needsCheck: records.filter((r) => r.needsCheck).length,
  };
  if (args.newOnly) records = records.filter((r) => !r.known);
  stats.emitted = records.length;
  stats.actionable = records.filter((r) => !r.known && r.verdict === 'candidate').length;

  const payload = {
    ingestedFrom: args.input,
    knownFrom: args.known,
    note: 'Every row is a LEAD, not a verified channel. verdict is always candidate|excluded; nothing here has been observed. Screen each domain before any submission.',
    stats,
    records,
  };
  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(payload, null, 2) + '\n');
    console.error(`wrote ${args.out}`);
  } else {
    console.log(JSON.stringify(payload.stats, null, 2));
  }
  console.error(JSON.stringify(stats));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
