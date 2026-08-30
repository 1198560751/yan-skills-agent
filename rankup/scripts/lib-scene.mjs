#!/usr/bin/env node
/**
 * lib-scene.mjs —— rankup 浏览器脚本共享的「双证人取证」层。
 * 状态：双证人化改造 2026-08-30，截图链路已实盘验证（execSync 引号版与
 * execFileSync 数组版两种注入形态都在真 Chrome 上出图；判决书见
 * backlink/evidence/screenshot-chain-VERDICTS.md）。
 *
 * 三条铁律（对齐 backlink/scripts/ground-truth.mjs 的形态）：
 *   1. 先取证后死：失败分支退出前必须落「截图 + 页面文本 + manifest(stopReason)」；
 *   2. 先取证后关：finally 里关会话之前，现场必须已经在磁盘上；
 *   3. waitFor 不 sleep：不再用 `execSync("sleep …")`，条件等待或页内定时器。
 *
 * 本文件**只做机械事**：建目录、落文件、轮询、拼 manifest。它不下任何结论——
 * 「页面上到底发生了什么」由 AI 拿着截图和文本两个证人对质判读。
 *
 * opencli 的调用**不在这里发生**：每个脚本已有自己的 cli 封装（execSync /
 * execFileSync、引号策略各不相同），captureScene 接收两个回调
 * （screenshot(absPath) 与 pageText()），把「怎么调 opencli」留给脚本，
 * 把「失败也不许抛、错误进 manifest」这半边收进来。
 *
 * 证据统一落 `.rankup/evidence/<script>-<ts>/`（.rankup 已被 gitignore）。
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 同步睡眠，不开子进程。Atomics.wait 在主线程可用（非 browser 环境），
 * 精度毫秒级，专供「exec 同步风格」的脚本做轮询间隔用。
 */
export function msleep(ms) {
  const n = Math.max(0, Math.round(ms));
  if (n === 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, n);
}

/**
 * 条件轮询：反复调 predicate 直到它返回真值或超时。返回最后一次的返回值
 * （等到了）或 null（超时）。predicate 抛错按「还没就绪」处理继续等——
 * 页面导航期间 eval 会失败，那不是终态。
 */
export function pollUntil(predicate, { timeoutMs = 15000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let v = null;
    try {
      v = predicate();
    } catch {
      /* 未就绪，继续等 */
    }
    if (v) return v;
    if (Date.now() >= deadline) return null;
    msleep(intervalMs);
  }
}

/** 文件名安全的时间戳片段：2026-08-30T12-03-45 */
export function tsSlug(d = new Date()) {
  return d.toISOString().slice(0, 19).replace(/:/g, "-");
}

/**
 * 会话名后缀：按「每个对话」派生。CLAUDE_CODE_SESSION_ID 才是真正会并发的
 * 单位；HOST 级是整个桌面端共享的，只能兜底。**绝不能用 pid**——Bash tool
 * 里每次调用都是新进程，pid 每次都变，两个并行任务还可能撞名。
 */
export function sessionSuffix() {
  return (
    (
      process.env.OPENCLI_SESSION_SUFFIX ||
      process.env.CLAUDE_CODE_SESSION_ID ||
      process.env.CLAUDE_CODE_HOST_SESSION_ID ||
      String(process.ppid)
    )
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 12) || "local"
  );
}

/**
 * 新建一次运行的证据目录：<root>/<script>-<ts>/。root 默认取当前工作目录下的
 * .rankup/evidence（.rankup 已 gitignore，项目私有产物不进仓库）。
 */
export function newEvidenceDir(script, { root = ".rankup/evidence", now = new Date() } = {}) {
  const base = isAbsolute(root) ? root : resolve(process.cwd(), root);
  const dir = join(base, `${script}-${tsSlug(now)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 写/合并 manifest.json。已有内容浅合并，scenes 数组做拼接——
 * 一次运行里可以多次落 manifest（每步之后），最后一次带 stopReason。
 */
export function writeManifest(dir, patch) {
  const p = join(dir, "manifest.json");
  let cur = {};
  if (existsSync(p)) {
    try {
      cur = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      cur = { corruptedPrevious: true };
    }
  }
  const merged = { ...cur, ...patch };
  if (Array.isArray(cur.scenes) && Array.isArray(patch.scenes)) {
    merged.scenes = [...cur.scenes, ...patch.scenes];
  }
  writeFileSync(p, JSON.stringify(merged, null, 2) + "\n");
  return p;
}

/**
 * 采一幕现场：截图 + 页面文本，成对落进 dir，登记进 manifest 的 scenes。
 * **绝不抛**：任何一个证人采不到，把错误原样记进 scene.errors——
 * 「截图失败」本身也是事实，比静默丢失强。
 *
 * @param {object} o
 * @param {string} o.dir  证据目录（newEvidenceDir 的返回值）
 * @param {string} o.tag  这一幕的名字（用作文件名前缀）
 * @param {(absPath: string) => void} [o.screenshot]  调各脚本自己的 opencli 封装截图
 * @param {() => string} [o.pageText]  取页面文本（各脚本自己的 eval 封装）
 * @param {object} [o.extra]  附加事实（原始响应片段、轮询态等），存 <tag>.extra.json
 */
export function captureScene({ dir, tag, screenshot, pageText, extra }) {
  const safeTag = String(tag).replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80);
  const scene = { tag: safeTag, at: new Date().toISOString(), files: [], errors: [] };
  if (screenshot) {
    const shot = join(dir, `${safeTag}.png`);
    try {
      screenshot(shot);
      scene.files.push(`${safeTag}.png`);
    } catch (e) {
      scene.errors.push(`screenshot: ${String(e?.message || e).slice(0, 300)}`);
    }
  }
  if (pageText) {
    const txt = join(dir, `${safeTag}.txt`);
    try {
      writeFileSync(txt, String(pageText() ?? ""));
      scene.files.push(`${safeTag}.txt`);
    } catch (e) {
      scene.errors.push(`pageText: ${String(e?.message || e).slice(0, 300)}`);
    }
  }
  if (extra !== undefined) {
    const ex = join(dir, `${safeTag}.extra.json`);
    try {
      writeFileSync(ex, JSON.stringify(extra, null, 2) + "\n");
      scene.files.push(`${safeTag}.extra.json`);
    } catch (e) {
      scene.errors.push(`extra: ${String(e?.message || e).slice(0, 300)}`);
    }
  }
  try {
    writeManifest(dir, { scenes: [scene] });
  } catch {
    /* manifest 写不进也不能抛——现场文件本身已尽力落了 */
  }
  return scene;
}

/* ── 自测（纯函数，离线） ─────────────────────────────────── */
if (process.argv.includes("--self-test")) {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const assert = (await import("node:assert/strict")).default;

  // tsSlug 形状
  assert.match(tsSlug(new Date("2026-08-30T12:03:45Z")), /^2026-08-30T12-03-45$/);

  // pollUntil：等到、超时两条路
  let n = 0;
  assert.equal(pollUntil(() => (++n >= 3 ? "ok" : null), { timeoutMs: 2000, intervalMs: 1 }), "ok");
  assert.equal(pollUntil(() => null, { timeoutMs: 30, intervalMs: 5 }), null);
  // predicate 抛错按未就绪处理，不上抛
  assert.equal(pollUntil(() => { throw new Error("navigating"); }, { timeoutMs: 30, intervalMs: 5 }), null);

  // 证据目录 + 场景 + manifest
  const base = mkdtempSync(join(tmpdir(), "lib-scene-"));
  const dir = newEvidenceDir("demo-script", { root: base, now: new Date("2026-08-30T00:00:00Z") });
  assert.ok(existsSync(dir));
  const s1 = captureScene({
    dir,
    tag: "step 1/打开",
    screenshot: (p) => writeFileSync(p, "png"),
    pageText: () => "hello",
    extra: { status: 200 },
  });
  assert.deepEqual(s1.errors, []);
  assert.equal(s1.files.length, 3);
  // 一个证人失败不影响另一个，也不抛
  const s2 = captureScene({
    dir,
    tag: "fail",
    screenshot: () => { throw new Error("no session"); },
    pageText: () => "still here",
  });
  assert.equal(s2.errors.length, 1);
  assert.deepEqual(s2.files, ["fail.txt"]);
  writeManifest(dir, { stopReason: "self-test" });
  const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  assert.equal(m.stopReason, "self-test");
  assert.equal(m.scenes.length, 2);
  rmSync(base, { recursive: true, force: true });

  // sessionSuffix 只含字母数字
  assert.match(sessionSuffix(), /^[a-zA-Z0-9]+$/);

  console.log("lib-scene: self-test PASS");
  process.exit(0);
}

// 被 import 时零副作用；直接运行且不带 --self-test 时给一句用途说明。
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  console.log("lib-scene.mjs 是共享库：captureScene / newEvidenceDir / writeManifest / pollUntil / msleep / sessionSuffix。自测：--self-test");
}
