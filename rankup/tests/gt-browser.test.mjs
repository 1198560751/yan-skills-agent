import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const gt = path.join(root, "rankup/scripts/gt.py");
const base = await mkdtemp(path.join(tmpdir(), "gt-browser-test-"));
const fakeOpencli = path.join(base, "opencli");
const state = path.join(base, "session-state");
const log = path.join(base, "opencli.log");

await writeFile(fakeOpencli, `#!/usr/bin/env node
import { appendFileSync, existsSync, rmSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(process.env.GT_FAKE_LOG, JSON.stringify(args) + "\\n");
if (args.includes("close")) {
  rmSync(process.env.GT_FAKE_STATE, { force: true });
  process.exit(0);
}
const commands = JSON.parse(args[args.indexOf("--commands") + 1]);
if (!existsSync(process.env.GT_FAKE_STATE) && !commands.some((command) => command.cmd === "open")) {
  console.error("session_not_found: No active session");
  process.exit(1);
}
if (commands.some((command) => command.cmd === "open")) writeFileSync(process.env.GT_FAKE_STATE, "open");
console.log(JSON.stringify(commands.map((command, index) => command.cmd === "eval"
  ? { cmd: "eval", index, ok: true, result: { value: { timeseries: { default: { timelineData: [{ time: "1704067200", value: [42] }] } } } } }
  : { cmd: command.cmd, index, ok: true, result: {} })));
`);
await chmod(fakeOpencli, 0o755);

function run(args) {
  return spawnSync("python3", [gt, ...args], {
    encoding: "utf8",
    env: { ...process.env, GT_OPENCLI: fakeOpencli, GT_FAKE_STATE: state, GT_FAKE_LOG: log },
  });
}

try {
  const first = run(["compare", "demo", "--time", "1m", "--session", "gt-browser-test", "--keep-session"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(existsSync(state), true, "--keep-session 应保留会话");

  const second = run(["compare", "demo", "--time", "7d", "--session", "gt-browser-test", "--keep-session"]);
  assert.equal(second.status, 0, second.stderr);

  const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  const firstBatch = JSON.parse(calls[1][calls[1].indexOf("--commands") + 1]);
  const secondBatch = JSON.parse(calls[2][calls[2].indexOf("--commands") + 1]);
  assert.match(firstBatch.at(-1).args.js, /today 1-m/, "1m 应映射到 Trends 时间范围");
  assert.deepEqual(secondBatch.map((command) => command.cmd), ["eval"], "复用会话时不应重新 open");
  assert.match(secondBatch[0].args.js, /now 7-d/, "7d 应映射到 Trends 时间范围");

  const close = run(["close", "--session", "gt-browser-test"]);
  assert.equal(close.status, 0, close.stderr);
  assert.equal(existsSync(state), false, "close 应释放会话");
  console.log("gt-browser: PASS");
} finally {
  await rm(base, { recursive: true, force: true });
}
