#!/usr/bin/env node
import { firstJson, opencli, parseFlags, printJson, run } from './opencli-core.mjs';

const flags = parseFlags(process.argv.slice(2));
const installed = (await opencli(['--version'])).stdout.trim();
const doctor = await opencli(['doctor', '-v'], { allowFailure: true, timeoutMs: 30_000 });
let latest = null;
if (flags['check-update']) {
  const npm = await run('npm', ['view', '@jackwener/opencli', 'version', '--json'], {
    allowFailure: true,
    timeoutMs: 30_000,
  });
  if (npm.code === 0) {
    try { latest = firstJson(npm.stdout); } catch { latest = npm.stdout.replaceAll('"', '').trim(); }
  }
}
const report = {
  ok: doctor.code === 0 && /\[OK\] Daemon/.test(doctor.stdout) && /\[OK\] Extension/.test(doctor.stdout) && /\[OK\] Connectivity/.test(doctor.stdout),
  installed,
  latest,
  updateAvailable: Boolean(latest && latest !== installed),
  daemon: /\[OK\] Daemon/.test(doctor.stdout),
  extension: /\[OK\] Extension/.test(doctor.stdout),
  connectivity: /\[OK\] Connectivity/.test(doctor.stdout),
};
printJson(report);
if (!report.ok) process.exitCode = 1;
