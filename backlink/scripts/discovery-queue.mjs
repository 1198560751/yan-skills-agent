#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseFlags, printJson, required } from './opencli-core.mjs';

function normalizeDomain(value) {
  const source = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
  return new URL(source).hostname.toLowerCase().replace(/^www\./, '');
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
