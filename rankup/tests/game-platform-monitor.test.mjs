#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts/demand/game-platform-monitor.mjs');
const run = (...args) => spawnSync(process.execPath, [script, '--dry-run', '--json', ...args], { cwd: root, encoding: 'utf8' });

const all = run();
assert.equal(all.status, 0, all.stderr);
const report = JSON.parse(all.stdout);
assert.equal(report.selectedPlatforms, 48);
assert.equal(new Set(report.platforms.map((p) => p.id)).size, 48);

const filtered = run('--language', 'ja', '--market', 'JP');
assert.equal(filtered.status, 0, filtered.stderr);
const selected = JSON.parse(filtered.stdout).platforms;
assert.ok(selected.length >= 5);
assert.ok(selected.every((p) => p.languages.includes('ja') && p.markets.includes('JP')));

console.log(`game-platform-monitor: ${report.selectedPlatforms} 个平台，筛选与清单校验通过`);
