#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts/demand/game-platform-monitor.mjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'game-platform-monitor-'));
const config = path.join(temp, 'platforms.json');
fs.writeFileSync(config, JSON.stringify({ verifiedAt: '2026-08-25', platforms: [
  { id: 'de-games', name: 'DE Games', languages: ['de'], markets: ['DE'], homepage: 'https://example.com/', sitemaps: ['https://example.com/sitemap.xml'], include: ['/games/'], exclude: ['/tags/'] },
  { id: 'ja-games', name: 'JA Games', languages: ['ja'], markets: ['JP'], homepage: 'https://example.org/', sitemaps: ['https://example.org/sitemap.xml'] },
] }));
const run = (...args) => spawnSync(process.execPath, [script, '--config', config, '--dry-run', '--json', ...args], { cwd: root, encoding: 'utf8' });

const all = run();
assert.equal(all.status, 0, all.stderr);
const report = JSON.parse(all.stdout);
assert.equal(report.selectedPlatforms, 2);
assert.equal(new Set(report.platforms.map((p) => p.id)).size, 2);
assert.deepEqual(report.platforms[0].include, ['/games/']);
assert.deepEqual(report.platforms[0].exclude, ['/tags/']);

const filtered = run('--language', 'ja', '--market', 'JP');
assert.equal(filtered.status, 0, filtered.stderr);
const selected = JSON.parse(filtered.stdout).platforms;
assert.equal(selected.length, 1);
assert.ok(selected.every((p) => p.languages.includes('ja') && p.markets.includes('JP')));

fs.rmSync(temp, { recursive: true, force: true });
console.log('game-platform-monitor: 私有清单筛选与格式校验通过');
