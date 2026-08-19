#!/usr/bin/env node
/**
 * merge-submission-targets.mjs — fold a probe run (and any agent-resolved or
 * price-checked overlays) into data/submission-targets.json, and route the
 * paid ones into data/paid-platforms.json.
 *
 * Layering, later wins per field: probe (anonymous HTTP, mechanical) →
 * resolved (a route was followed and the page judged) → priced (what the money
 * actually buys). Each layer only overwrites fields it actually observed.
 *
 * What is DROPPED, and the only things that are:
 *   - status dead — the domain is no longer a submission surface;
 *   - status unverified — no route could be established at all.
 * Nothing is dropped for being low-DR, off-topic, obscure, or ugly. Per
 * references/acquisition-doctrine.md those rank targets, they never gate them.
 *
 * Usage:
 *   node scripts/merge-submission-targets.mjs \
 *     --probe /tmp/probe/all.json \
 *     --resolved /tmp/probe/resolved-1.json --resolved ... \
 *     --priced /tmp/probe/priced-1.json --priced ... \
 *     --source-list 'flaqai/backlink_skills Free-backlink-list.md' \
 *     [--dry-run]
 */

import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cohortOf, primaryGate } from './lib-cohort.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');

const args = { probe: null, resolved: [], priced: [], sourceList: null, dryRun: false };
for (let i = 2; i < process.argv.length; i++) {
  const f = process.argv[i];
  const v = () => process.argv[++i];
  if (f === '--probe') args.probe = v();
  else if (f === '--resolved') args.resolved.push(v());
  else if (f === '--priced') args.priced.push(v());
  else if (f === '--source-list') args.sourceList = v();
  else if (f === '--dry-run') args.dryRun = true;
  else throw new Error(`unknown flag ${f}`);
}
if (!args.probe) throw new Error('--probe is required');

const readRows = (f) => {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  return Array.isArray(j) ? j : j.targets || j.records || [];
};

const KIND = new Set(['product-directory', 'ai-directory', 'startup-launch', 'saas-review', 'web-directory', 'business-directory', 'dev-community', 'publish-platform', 'comment-form', 'search-engine', 'contact-form', 'unknown']);
const GATE = new Set(['open-form', 'account', 'captcha-interactive', 'captcha-passive', 'email-verify', 'personal-contact', 'reciprocal', 'manual-review', 'none-found', 'unknown']);
const STATUS = new Set(['usable', 'gated', 'unverified', 'dead']);
const PAY = new Set(['none-seen', 'optional', 'required', 'unknown']);
const HUMAN_GATE = new Set(['captcha-interactive', 'account', 'reciprocal', 'personal-contact']);

const byDomain = new Map();
for (const r of readRows(args.probe)) {
  if (!r.domain) continue;
  const { _signals, ...clean } = r;
  byDomain.set(r.domain, { ...clean, sourceList: args.sourceList || clean.sourceList || null });
}

let resolvedApplied = 0;
for (const f of args.resolved) {
  for (const r of readRows(f)) {
    const t = byDomain.get(r.domain);
    if (!t) continue;
    resolvedApplied++;
    if (r.route) t.route = r.route;
    if (r.name) t.name = r.name;
    if (KIND.has(r.kind)) t.kind = r.kind;
    // The resolver followed the real submission route; the probe may only have
    // seen the homepage. Same URL → both looked at the same page, so union the
    // gates. Different URL → the resolver's page is the one that matters, and
    // unioning would import a "Sign in" link from the homepage nav as a gate.
    if (GATE.has(r.gate)) {
      const sameRoute = r.route && t.route && r.route.replace(/\/$/, '') === t.route.replace(/\/$/, '');
      const probeGates = (t.gates || []).filter((g) => g !== 'none-found' && g !== 'unknown');
      t.gates = [...new Set(sameRoute ? [...probeGates, r.gate] : [r.gate])];
    }
    if (STATUS.has(r.status)) t.status = r.status;
    if (PAY.has(r.payment)) t.payment = r.payment;
    if (r.price !== undefined) t.price = r.price || null;
    if (r.evidenceWhat && r.evidenceWhat.length >= 10) {
      t.evidence = {
        method: 'anonymous-http',
        what: r.evidenceWhat,
        httpStatus: r.httpStatus ?? t.evidence?.httpStatus ?? null,
        finalUrl: r.finalUrl ?? t.evidence?.finalUrl ?? null,
        title: r.name ?? t.evidence?.title ?? null,
      };
    }
  }
}

const paidRows = new Map();
let pricedApplied = 0;
for (const f of args.priced) {
  for (const r of readRows(f)) {
    const t = byDomain.get(r.domain);
    if (!t) continue;
    pricedApplied++;
    if (PAY.has(r.payment)) t.payment = r.payment;
    t.price = r.price || null;
    if (r.freePathNote) t.notes = [t.notes, r.freePathNote].filter(Boolean).join(' · ').slice(0, 300);
    if (r.evidenceWhat && r.evidenceWhat.length >= 10) {
      t.evidence = { ...t.evidence, method: 'anonymous-http', what: r.evidenceWhat, httpStatus: r.httpStatus ?? t.evidence?.httpStatus ?? null };
    }
    if (r.tier && r.tier !== 'free-with-account' && r.tier !== 'not-a-platform' && r.price && r.pricePageUrl) {
      paidRows.set(r.domain, { tier: r.tier, price: r.price, sourceUrl: r.pricePageUrl, what: r.evidenceWhat || null });
    }
  }
}

const today = new Date().toISOString().slice(0, 10);
const kept = [];
const dropped = { dead: 0, unverified: 0 };
for (const t of byDomain.values()) {
  if (t.status === 'dead') { dropped.dead++; continue; }
  if (t.status === 'unverified') { dropped.unverified++; continue; }
  // Recompute the single gate and the cohort from the full gate set, once, here.
  // Any layer may have written a stale `gate`; `gates` is the ground truth.
  t.gates = [...new Set((t.gates && t.gates.length ? t.gates : [t.gate || 'unknown']).filter((g) => GATE.has(g)))];
  if (!t.gates.length) t.gates = ['unknown'];
  t.gate = primaryGate(t.gates);
  t.cohort = cohortOf(t.gates);
  // a human-only gate is never `usable`, whatever a layer claimed
  if (t.status === 'usable' && t.gates.some((g) => HUMAN_GATE.has(g))) t.status = 'gated';
  if (t.price && !t.priceCheckedAt) t.priceCheckedAt = today;
  if (!t.price) t.priceCheckedAt = null;
  kept.push({
    domain: t.domain, route: t.route, name: t.name || undefined, kind: t.kind,
    gate: t.gate, gates: t.gates, cohort: t.cohort,
    payment: t.payment, price: t.price ?? null, priceCheckedAt: t.priceCheckedAt ?? null,
    status: t.status, sourceList: t.sourceList ?? null, notes: t.notes ?? null,
    lastProbedAt: t.lastProbedAt || today, evidence: t.evidence,
  });
}
kept.sort((a, b) => a.domain.localeCompare(b.domain));

const out = {
  version: 1,
  updatedAt: new Date().toISOString(),
  note: 'Submission routes observed to exist. NOT placements: no row here claims a published link, a rel value, or an index entry. A row graduates into free-channels.json only when a real anchor is seen on a live page. Relevance and authority rank these, they never gate them.',
  targets: kept,
};

// —— paid side ————————————————————————————————————————————————
const paidFile = join(DATA, 'paid-platforms.json');
const paid = JSON.parse(fs.readFileSync(paidFile, 'utf8'));
let paidNew = 0; let paidUpdated = 0;
for (const [host, p] of paidRows) {
  const existing = paid.platforms[host];
  const observedPrice = { what: p.what || `Listed price read on ${host}`, sourceUrl: p.sourceUrl, checkedAt: today };
  if (existing) {
    paidUpdated++;
    existing.tier = existing.tier === 'unverified' ? p.tier : existing.tier;
    existing.price = p.price;
    existing.priceCheckedAt = today;
    existing.observedPrice = observedPrice;
    // A tiered row with no notes is unreviewable — nobody can check why it was
    // filed where it was. The price observation IS that reasoning, so use it
    // rather than leaving the validator's warning to be silenced by hand later.
    if (!existing.notes) existing.notes = observedPrice.what;
  } else {
    paidNew++;
    paid.platforms[host] = {
      tier: p.tier, price: p.price, priceCheckedAt: today,
      notes: p.what || null, observedSites: [], placements: [], totalUrls: 0,
      observedPrice,
    };
  }
}
paid.updatedAt = new Date().toISOString();

if (args.dryRun) {
  console.log(JSON.stringify({ kept: kept.length, dropped, resolvedApplied, pricedApplied, paidNew, paidUpdated }, null, 2));
} else {
  fs.writeFileSync(join(DATA, 'submission-targets.json'), JSON.stringify(out, null, 2) + '\n');
  fs.writeFileSync(paidFile, JSON.stringify(paid, null, 2) + '\n');
  const byCohort = kept.reduce((m, t) => ((m[t.cohort] = (m[t.cohort] || 0) + 1), m), {});
  console.log(`submission-targets: ${kept.length} kept (dropped ${dropped.dead} dead, ${dropped.unverified} unverified)`);
  console.log(`  cohorts: ${Object.entries(byCohort).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`paid-platforms: +${paidNew} new, ${paidUpdated} updated`);
  console.log(`overlays applied: resolved ${resolvedApplied}, priced ${pricedApplied}`);
}
