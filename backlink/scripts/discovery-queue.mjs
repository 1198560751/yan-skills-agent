#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseFlags, printJson, required } from './opencli-core.mjs';

function normalizeDomain(value) {
  const source = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
  return new URL(source).hostname.toLowerCase().replace(/^www\./, '');
}

/** Quote-aware CSV parse: exported cells contain commas and embedded newlines. */
function parseCsv(text) {
  const source = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(cur); cur = ''; continue; }
    if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; continue; }
    if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function load(file) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error('Invalid discovery queue.');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, nodes: [], edges: [] };
    throw error;
  }
}

async function save(file, graph) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

function addNode(graph, domain, depth, source = 'seed') {
  const normalized = normalizeDomain(domain);
  const existing = graph.nodes.find((node) => node.domain === normalized);
  if (existing) {
    existing.depth = Math.min(existing.depth, depth);
    return existing;
  }
  const node = { domain: normalized, depth, status: 'pending', sources: [source], createdAt: new Date().toISOString() };
  graph.nodes.push(node);
  return node;
}

const [command = 'stats', ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);
const file = flags.file || '.backlink/discovery.json';
const graph = await load(file);

if (command === 'seed') {
  const node = addNode(graph, required(flags, 'domain'), 0, 'seed');
  await save(file, graph);
  printJson(node);
} else if (command === 'import-commenters') {
  const data = JSON.parse(await readFile(required(flags, 'input'), 'utf8'));
  const source = normalizeDomain(data.sourceDomain || new URL(data.sourceUrl).hostname);
  const sourceNode = addNode(graph, source, Number(flags.depth || 0), 'comment-page');
  const added = [];
  for (const candidate of data.candidateDomains || []) {
    const node = addNode(graph, candidate, sourceNode.depth + 1, `comments:${source}`);
    if (!node.sources.includes(`comments:${source}`)) node.sources.push(`comments:${source}`);
    if (!graph.edges.some((edge) => edge.from === source && edge.to === node.domain && edge.type === 'commenter')) {
      graph.edges.push({ from: source, to: node.domain, type: 'commenter', at: new Date().toISOString() });
    }
    added.push(node.domain);
  }
  await save(file, graph);
  printJson({ source, added: [...new Set(added)] });
} else if (command === 'import-refdomains') {
  // The discovery loop's step 2 is "get their backlink rows from an authorized
  // export and feed those domains back into the queue", but the only bulk import
  // was import-commenters, whose edges are typed `commenter`. Routing referring
  // domains through it records a claim that was never observed. This command
  // keeps the provenance honest: edge type `refdomain`, source domain named.
  //
  // --input accepts either a Semrush referring-domains CSV (a `Root Domain` /
  // `Root Domain / Category` column, whose cells may span multiple lines) or a
  // JSON array / newline-separated list of domains.
  const source = normalizeDomain(required(flags, 'source'));
  const raw = await readFile(required(flags, 'input'), 'utf8');
  let candidates = [];
  if (/^\s*[[{]/.test(raw)) {
    const parsed = JSON.parse(raw);
    candidates = Array.isArray(parsed) ? parsed : parsed.candidateDomains || [];
  } else if (raw.includes(',') && /Root Domain/i.test(raw.split('\n')[0] || '')) {
    const rows = parseCsv(raw);
    const key = Object.keys(rows[0] || {}).find((k) => /^Root Domain/i.test(k));
    if (!key) throw new Error('CSV has no "Root Domain" column.');
    candidates = rows.map((row) => (row[key] || '').split('\n')[0].trim());
  } else {
    candidates = raw.split('\n');
  }
  candidates = [...new Set(candidates.map((value) => String(value).trim()).filter(Boolean))];

  const sourceNode = addNode(graph, source, Number(flags.depth || 0), 'refdomain-export');
  const added = [];
  const skipped = [];
  for (const candidate of candidates) {
    let node;
    try {
      node = addNode(graph, candidate, sourceNode.depth + 1, `refdomains:${source}`);
    } catch {
      skipped.push(candidate); // not a parseable hostname; record it rather than dropping it silently
      continue;
    }
    if (!node.sources.includes(`refdomains:${source}`)) node.sources.push(`refdomains:${source}`);
    if (!graph.edges.some((edge) => edge.from === source && edge.to === node.domain && edge.type === 'refdomain')) {
      graph.edges.push({ from: source, to: node.domain, type: 'refdomain', at: new Date().toISOString() });
    }
    added.push(node.domain);
  }
  await save(file, graph);
  printJson({ source, added: [...new Set(added)], skipped });
} else if (command === 'mark') {
  const domain = normalizeDomain(required(flags, 'domain'));
  const node = graph.nodes.find((entry) => entry.domain === domain);
  if (!node) throw new Error('Domain not found.');
  const status = required(flags, 'status');
  if (!['pending', 'backlinks_fetched', 'qualified', 'rejected'].includes(status)) throw new Error('Invalid discovery status.');
  node.status = status;
  node.note = flags.note || null;
  node.updatedAt = new Date().toISOString();
  await save(file, graph);
  printJson(node);
} else if (command === 'next') {
  const limit = Math.max(1, Math.min(100, Number(flags.limit || 10)));
  printJson({ nodes: graph.nodes.filter((node) => node.status === 'pending').sort((a, b) => a.depth - b.depth).slice(0, limit) });
} else if (command === 'stats') {
  const statuses = Object.fromEntries([...new Set(graph.nodes.map((node) => node.status))].map((status) => [status, graph.nodes.filter((node) => node.status === status).length]));
  printJson({ nodes: graph.nodes.length, edges: graph.edges.length, statuses });
} else {
  throw new Error(`Unknown command: ${command}`);
}
