import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(skillRoot, "scripts", "third-party-list-ingest.mjs");

const LIST = `| # | Site | Note |
|---|---|---|
| 1 | [https://alpha.example/submit](<https://alpha.example/submit>) | 未收录 |
| 2 | [https://www.alpha.example/add](<https://www.alpha.example/add>) | duplicate host |
| 3 | [https://beta.example/](<https://beta.example/>) | 网站已停服 |
| 4 | [https://gamma.example/x](<https://gamma.example/x>) | 需收费 5 刀 |
| 5 | [https://known.example/](<https://known.example/>) | fine |
`;

async function run(dir, extra) {
  const listPath = path.join(dir, "list.md");
  const knownPath = path.join(dir, "known.json");
  const outPath = path.join(dir, "out.json");
  await writeFile(listPath, LIST);
  await writeFile(knownPath, JSON.stringify({ targets: [{ url: "https://known.example/" }] }));
  const res = spawnSync(process.execPath, [
    script, "--input", listPath, "--known", knownPath, "--out", outPath,
    "--drop-pattern", "停服", "--flag-pattern", "收费|刀", ...extra,
  ], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(await readFile(outPath, "utf8"));
}

test("dedupes by registrable domain, honours known/drop/flag", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "tpl-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = await run(dir, []);

  // www.alpha.example and alpha.example are one lead, not two
  assert.equal(out.stats.uniqueDomains, 4);
  const alpha = out.records.find((r) => r.domain === "alpha.example");
  assert.equal(alpha.urls.length, 2);

  assert.equal(out.records.find((r) => r.domain === "beta.example").verdict, "excluded");
  assert.equal(out.records.find((r) => r.domain === "gamma.example").needsCheck, true);
  assert.equal(out.records.find((r) => r.domain === "known.example").known, true);

  // nothing is ever emitted as verified
  assert.ok(out.records.every((r) => r.verdict === "candidate" || r.verdict === "excluded"));
});

test("--new-only drops what we already have", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "tpl-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = await run(dir, ["--new-only"]);
  assert.ok(!out.records.some((r) => r.domain === "known.example"));
  assert.equal(out.stats.alreadyKnown, 1);
});
