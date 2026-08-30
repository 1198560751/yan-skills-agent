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
// The settle step is an eval too, and it answers true — exactly like the real
// bridge. Anything that reaches for the first eval instead of the last picks this
// up and reads it as an empty result.
const isSettle = (command) => command.cmd === "eval" && /setTimeout/.test(command.args.js) && !/widgetdata/.test(command.args.js);
console.log(JSON.stringify(commands.map((command, index) => {
  if (isSettle(command)) return { cmd: "eval", index, ok: true, result: { value: true } };
  if (command.cmd === "eval") return { cmd: "eval", index, ok: true, result: { value: { timeseries: { default: { timelineData: [{ time: "1704067200", value: [42] }] } } } } };
  return { cmd: command.cmd, index, ok: true, result: {} };
})));
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

  // 双证人化之后每次运行还会有 screenshot / eval 取证调用混在日志里，
  // 批量取数调用按 --commands 过滤出来，位置不再靠日志行号对齐。
  const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  // batchCalls[0] 是首次「无 open」的试探（fake 会报 session_not_found），
  // [1] 是带 open 的重试，[2] 是第二次运行的复用调用——和改造前的行号语义一致。
  const batchCalls = calls.filter((call) => call.includes("--commands"));
  const firstBatch = JSON.parse(batchCalls[1][batchCalls[1].indexOf("--commands") + 1]);
  const secondBatch = JSON.parse(batchCalls[2][batchCalls[2].indexOf("--commands") + 1]);
  assert.match(firstBatch.at(-1).args.js, /today 1-m/, "1m 应映射到 Trends 时间范围");
  assert.deepEqual(secondBatch.map((command) => command.cmd), ["eval"], "复用会话时不应重新 open");
  assert.match(secondBatch[0].args.js, /now 7-d/, "7d 应映射到 Trends 时间范围");

  // Opening a session puts a settle eval in front of the extractor eval. Reading
  // the wrong one made every cold start report an empty result while warm reuse
  // kept working, which is what made the failure look intermittent.
  run(["close", "--session", "gt-browser-test"]);
  assert.equal(existsSync(state), false, "the cold-start case needs no session left behind");
  const cold = run(["compare", "demo", "--time", "1m", "--session", "gt-browser-cold"]);
  assert.equal(cold.status, 0, `cold start must read the extractor eval, not the settle: ${cold.stderr}`);
  assert.match(cold.stdout, /42/, "cold start should surface the extractor's data");
  const coldCalls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  // The run closes its session afterwards, so skip past that call to the batch.
  const lastBatchCall = coldCalls.filter((call) => call.includes("--commands")).at(-1);
  const coldBatch = JSON.parse(lastBatchCall[lastBatchCall.indexOf("--commands") + 1]);
  assert.deepEqual(coldBatch.map((command) => command.cmd), ["open", "eval", "eval"], "cold start opens, settles, then extracts");

  const close = run(["close", "--session", "gt-browser-test"]);
  assert.equal(close.status, 0, close.stderr);
  assert.equal(existsSync(state), false, "close 应释放会话");
  console.log("gt-browser: PASS");
} finally {
  await rm(base, { recursive: true, force: true });
}
