#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseFlags, printJson, required } from './opencli-core.mjs';

export const STATES = ['candidate', 'qualified', 'drafted', 'filled', 'submitted', 'public', 'indexed', 'rel_verified', 'rejected'];
const EVIDENCE_REQUIRED = new Set(['submitted', 'public', 'indexed', 'rel_verified']);

export function normalizeUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs are supported.');
  url.hash = '';
  return url.toString();
}

function idFor(url) {
  let hash = 2166136261;
  for (const character of url) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `candidate-${(hash >>> 0).toString(16)}`;
}

async function readLedger(file) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(value.records)) throw new Error('Ledger records must be an array.');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, records: [] };
    throw error;
  }
}

async function writeLedger(file, ledger) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

export function transition(record, state, note) {
  if (!STATES.includes(state)) throw new Error(`Unknown state: ${state}`);
  if (EVIDENCE_REQUIRED.has(state) && (!note || !note.trim())) throw new Error(`${state} requires an evidence note.`);
  const now = new Date().toISOString();
  return {
    ...record,
    state,
    updatedAt: now,
    evidence: EVIDENCE_REQUIRED.has(state) ? { note: note.trim(), recordedAt: now } : record.evidence,
    history: [...(record.history || []), { state, note: note?.trim() || null, at: now }],
  };
}

const [command = 'list', ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);
const file = flags.file || '.backlink/ledger.json';
const ledger = await readLedger(file);

if (command === 'init') {
  await writeLedger(file, ledger);
  printJson({ ok: true, file, records: ledger.records.length });
} else if (command === 'upsert') {
  const url = normalizeUrl(required(flags, 'url'));
  const existing = ledger.records.find((record) => record.url === url);
  if (!existing) {
    const now = new Date().toISOString();
    ledger.records.push({
      id: idFor(url),
      url,
      site: flags.site || new URL(url).hostname,
      state: 'candidate',
      createdAt: now,
      updatedAt: now,
      history: [{ state: 'candidate', note: 'Added to ledger.', at: now }],
    });
    await writeLedger(file, ledger);
  }
  printJson(existing || ledger.records.at(-1));
} else if (command === 'transition') {
  const identity = flags.id || (flags.url ? normalizeUrl(flags.url) : null);
  if (!identity) throw new Error('--id or --url is required.');
  const index = ledger.records.findIndex((record) => record.id === identity || record.url === identity);
  if (index < 0) throw new Error('Candidate not found.');
  ledger.records[index] = transition(ledger.records[index], required(flags, 'state'), flags.evidence || '');
  await writeLedger(file, ledger);
  printJson(ledger.records[index]);
} else if (command === 'list') {
  const records = flags.state ? ledger.records.filter((record) => record.state === flags.state) : ledger.records;
  printJson({ version: ledger.version, records });
} else {
  throw new Error(`Unknown command: ${command}`);
}
