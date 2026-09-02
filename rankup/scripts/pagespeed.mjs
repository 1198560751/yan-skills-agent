#!/usr/bin/env node
/**
 * PageSpeed 取数 —— **走网页版 pagespeed.web.dev，不再走带 key 的 PSI API**
 * （2026-08-31 改）。零 key、零配额、零账号；网页版还比 API 多给两样东西：
 * CrUX 的**样本量档位**（「许多样本」/「少量样本」）和新的「智能体浏览」类别。
 *
 * 为什么要有这个脚本：段 4 闸门 6 要求「实验室与现场数据都记录，不一致以
 * 现场为准」。单跑 Lighthouse 只给实验室那一半，闸门会「只过一半而表面是绿的」。
 * 网页版一屏同时给两套，正好对上这条判据。
 *
 * ── 2026-08-31 实测（决定了这个脚本长成现在这样）────────────────────────
 *
 * 1. **网页版跑分只在标签页真的可见时才会渲染完。** 同一个 URL：
 *    Chrome 标签页处于后台（`document.visibilityState === "hidden"`）时，
 *    页面停在「Running analysis」，连测 4 轮、每轮 60–80 秒，**一次都没出分**；
 *    同一轮里标签页一变 visible，Lighthouse 报告立刻从 179 个元素涨到 8559 个、
 *    分数当场出现。数据其实早就到了（后台也能看到报告外壳，303 个元素），
 *    卡住的是**重报告的渲染**——后台标签页拿不到 rAF/空闲回调。
 * 2. **伪造可见性没用。** 试过在页内改写 `document.visibilityState` / `hidden`、
 *    把 `requestAnimationFrame` 垫成 `setTimeout`、补发 `visibilitychange` 与
 *    `focus`：页面读到的确实变成 visible，**渲染照样不动**（元素数纹丝不动）。
 *    节流发生在浏览器层，不是页面读的那个标志位。
 * 3. **`opencli --window foreground` 也不保证可见**：Chrome 整个 app 不在最前时，
 *    标签页仍然是 hidden。**可见与否由坐在电脑前的人决定，脚本无权决定。**
 * 4. **慢站会跑很久**：一个低流量站连跑 240 秒都还在「Running analysis」，
 *    而 example.com 只要 25–35 秒。预算要给足，超时**不等于「没有数据」**。
 * 5. `hl=en` 生效，能把界面语言钉死（否则跟着浏览器语言走，读数正则会漂）。
 * 6. 网页版的跑分请求走的是 `_/PagespeedUi/data/batchexecute` 这个内部 RPC，
 *    参数是混淆过的，**不要试图直接调它**——它没有契约，随时会变。
 *
 * 结论：**默认交给人跑**（`plan`，打印要开的链接 + 读数清单 + 记法），
 * 采集模式（`collect`）是可选加速，且必须由脚本自己在卡住时说清楚
 * 「是标签页没在前台」，而不是把空白渲染成「没有数据」。
 *
 * ── 一条与取数方式无关、必须保留的判据 ──────────────────────────────────
 * **现场返回「无数据」= CrUX 流量不足，不是 0、不等于通过。** 必须原样记进
 * `.rankup/baseline.md`，留空会在下一轮被读成「查过了，没问题」。
 *
 * 用法：
 *   node pagespeed.mjs plan <url...> [--strategy mobile|desktop|both] [--hl en]
 *       打印要在浏览器里打开的 pagespeed.web.dev 链接、读数清单、baseline.md 记法。
 *       零依赖，任何环境都能跑。**这是默认子命令。**
 *   node pagespeed.mjs collect <url...> [--strategy …] [--budget 300] [--session NAME]
 *       用 opencli 驱动本机 Chrome 采双证人（截图 + 页面文本）进
 *       `.rankup/evidence/pagespeed-<ts>/`，判读交给 AI。
 *       **跑之前把 Chrome 切到最前并让那个标签页可见**，否则必然卡在
 *       「Running analysis」——脚本会明说是这个原因，不会谎报没数据。
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { newEvidenceDir, captureScene, writeManifest, msleep } from "./lib-scene.mjs";

const WEB = "https://pagespeed.web.dev/analysis";
const OPENCLI = process.env.PAGESPEED_OPENCLI ?? "opencli";
// 一次 eval 的 CDP 上限实测在 115 秒左右，所以就绪判定必须是「Node 侧多次短 eval」，
// 不能写成「页内 await 一个长定时器」——后者会以 CDP 超时的形式失败。
const POLL_MS = 4000;
const DEFAULT_BUDGET_S = 300;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function normalizeUrl(u) {
  return u.includes("://") ? u : `https://${u}`;
}

function webUrl(target, strategy, hl) {
  const qs = new URLSearchParams({ url: target, form_factor: strategy });
  if (hl) qs.set("hl", hl);
  return `${WEB}?${qs}`;
}

function parseArgs(argv) {
  const opt = { strategy: "mobile", hl: "en", budget: DEFAULT_BUDGET_S, session: null, help: false };
  const urls = [];
  let cmd = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opt.help = true;
    else if (a === "--strategy") opt.strategy = argv[++i];
    else if (a === "--hl") opt.hl = argv[++i];
    else if (a === "--budget") opt.budget = Number(argv[++i]);
    else if (a === "--session") opt.session = argv[++i];
    else if (a.startsWith("-")) die(`未知参数：${a}`);
    else if (!cmd && (a === "plan" || a === "collect")) cmd = a;
    else urls.push(normalizeUrl(a));
  }
  return { cmd: cmd || "plan", urls, opt };
}

function strategies(s) {
  if (s === "both") return ["mobile", "desktop"];
  if (s === "mobile" || s === "desktop") return [s];
  die(`--strategy 只能是 mobile / desktop / both，收到：${s}`);
}

const HELP = `PageSpeed 取数（走网页版 pagespeed.web.dev，**不需要 key、不占配额**）

  node pagespeed.mjs plan <url...>    [--strategy mobile|desktop|both] [--hl en]
  node pagespeed.mjs collect <url...> [--strategy …] [--hl en] [--budget 300] [--session NAME]

plan（默认）  打印要在浏览器里打开的链接 + 读数清单 + baseline.md 记法。零依赖。
collect       用 opencli 驱动本机 Chrome 采双证人（截图 + 页面文本）落
              .rankup/evidence/pagespeed-<ts>/，判读交给 AI。

选项：
  --strategy   mobile（默认）/ desktop / both。CLS 一类只在桌面触发的问题要靠 both
  --hl         界面语言，默认 en（钉死语言，否则读数会跟着浏览器语言漂）
  --budget     collect 每个 (URL × 端) 的等待上限秒数，默认 ${DEFAULT_BUDGET_S}
  --session    opencli 会话名（并行任务必须各传各的，否则抢同一个标签页）
  --help       显示帮助

**collect 的硬前提：Chrome 那个标签页必须真的可见。** 实测后台标签页会一直停在
「Running analysis」，一分多钟都不出分；数据其实到了，卡的是报告渲染（后台拿不到
rAF）。伪造 visibilityState 无效，--window foreground 也不保证。卡住时脚本会
明说是这个原因，**不会**把空白记成「没有数据」。

**现场返回「无数据」= CrUX 流量不足，不是 0、不等于通过**——原样记进 baseline.md。`;

// ── plan ────────────────────────────────────────────────────────────────

function plan(urls, opt) {
  const ss = strategies(opt.strategy);
  console.log(`═══ 网页版 PageSpeed 手测清单（${urls.length} 个 URL × ${ss.length} 端）═══\n`);
  console.log(`逐条在浏览器里打开（页面会自己跑，25 秒到几分钟不等；**别切走标签页**，`);
  console.log(`后台标签页会一直停在 Running analysis）：\n`);
  for (const u of urls) {
    for (const s of ss) {
      console.log(`  [${s}] ${webUrl(u, s, opt.hl)}`);
    }
  }
  console.log(`
每份报告读这几项，一项都不能省：

  现场（页面上半屏，标题是 Discover what your real users are experiencing）
    · Core Web Vitals 评估：Passed / Failed
    · LCP / INP / CLS 三个 p75，外加 FCP、TTFB
    · 样本量档位（「许多样本 / Many samples」还是「少量样本 / Few samples」）
    · 作用域：这个 URL（This URL）还是整个源（Origin）——**两者不能混记**
    · **整块不存在 = CrUX 流量不足。原样记「现场无数据（流量不足）」，
      不是 0、不等于通过、更不许留空。**

  实验室（下半屏，Diagnose performance issues）
    · Performance / Accessibility / Best Practices / SEO 四个分数
    · 有「智能体浏览 / Agentic browsing」这一档就一并记（网页版才有，API 不给）
    · 指标区：FCP / LCP / TBT / CLS / Speed Index
    · 跑分环境那行（Lighthouse 版本、节流档位）——**换了环境的绝对值不可比**

记进 \`.rankup/baseline.md\`，一行一个 (URL × 端)：

  | URL | 端 | 现场 CWV | LCP | INP | CLS | 样本量 | 作用域 | 实验室 Perf | 日期 |

判读规则：**实验室与现场不一致时以现场为准。** 实验室机器只跑了一种平台，
读到 0 什么都不能证明——见 references/seo-box.md 第一节。`);
}

// ── collect ─────────────────────────────────────────────────────────────

function defaultSession() {
  const suffix = (
    process.env.OPENCLI_SESSION_SUFFIX ||
    process.env.CLAUDE_CODE_SESSION_ID ||
    process.env.CLAUDE_CODE_HOST_SESSION_ID ||
    String(process.ppid)
  ).replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "local";
  return `rankup-pagespeed-${suffix}`;
}

function cli(session, args, { timeout = 120_000 } = {}) {
  return execFileSync(OPENCLI, ["browser", session, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });
}

/**
 * 就绪探针。**只报事实，不下结论。** 返回：
 *   visibility  标签页可见性——卡住时唯一有解释力的那个字段
 *   gauges      Lighthouse 类别分数环的个数（>0 = 实验室报告已渲染）
 *   elements    穿透 shadow DOM 的元素总数（后台外壳约 300，报告出来后数千）
 *   head        页面文本开头，用来区分「还在跑」和「报错了」
 * 判据用结构（分数环存在）而不是文本长度：外壳的文本早就上万了。
 */
const PROBE = `(()=>{const o=[];const deep=(r)=>{for(const e of r.querySelectorAll("*")){o.push(e);if(e.shadowRoot)deep(e.shadowRoot)}};deep(document);
const cn=e=>typeof e.className==="string"?e.className:"";
return JSON.stringify({visibility:document.visibilityState,elements:o.length,
gauges:o.filter(e=>/lh-gauge__percentage/.test(cn(e))).length,
head:(document.body?document.body.innerText:"").replace(/\\s+/g," ").slice(0,200)})})()`;

function probe(session) {
  const raw = cli(session, ["eval", PROBE], { timeout: 60_000 });
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const outer = JSON.parse(raw.slice(start, end + 1));
    return typeof outer === "string" ? JSON.parse(outer) : outer;
  } catch {
    return null;
  }
}

function closeSession(session) {
  try {
    cli(session, ["close"], { timeout: 30_000 });
  } catch {
    /* 关不掉不影响已经落盘的证据 */
  }
}

function collectOne(session, dir, target, strategy, opt) {
  const url = webUrl(target, strategy, opt.hl);
  const tag = `${strategy}-${target.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50)}`;
  const deadline = Date.now() + opt.budget * 1000;
  let last = null;
  let stopReason = "not-ready";

  try {
    cli(session, ["open", url], { timeout: 120_000 });
  } catch (e) {
    stopReason = "opencli-open-failed";
    last = { error: String(e?.stderr || e?.message || e).slice(0, 400) };
  }

  if (stopReason === "not-ready") {
    while (Date.now() < deadline) {
      msleep(POLL_MS);
      const p = probe(session);
      if (p) last = p;
      if (p && p.gauges > 0) {
        stopReason = "ready";
        break;
      }
    }
    // 卡住的成因分两种，说法必须不同——**都不是「这个站没有数据」**。
    if (stopReason === "not-ready") {
      stopReason = last && last.visibility === "hidden" ? "tab-hidden" : "budget-exhausted";
    }
  }

  // 先取证，再走人。就算没就绪，那张「Running analysis」的图本身就是事实。
  captureScene({
    dir,
    tag,
    screenshot: (p) => cli(session, ["screenshot", p], { timeout: 90_000 }),
    pageText: () =>
      cli(session, [
        "eval",
        `(()=>{try{return document.body?document.body.innerText.slice(0,60000):''}catch(e){return 'PAGE_TEXT_FAILED:'+e}})()`,
      ], { timeout: 60_000 }),
    extra: { target, strategy, webUrl: url, stopReason, probe: last },
  });

  return { target, strategy, webUrl: url, stopReason, probe: last };
}

function explain(stopReason) {
  switch (stopReason) {
    case "ready":
      return "报告已渲染，双证人齐了";
    case "tab-hidden":
      return "标签页一直是 hidden —— **这是没出分的原因，不是这个站没有数据**。" +
        "把 Chrome 切到最前、让那个标签页停在可见状态，再跑一次";
    case "budget-exhausted":
      return "标签页可见但预算内没跑完 —— 慢站实测能跑几分钟。加大 --budget 重试；" +
        "**超时不等于没有数据**";
    case "opencli-open-failed":
      return "opencli 打不开页面，先跑 `opencli doctor`";
    default:
      return stopReason;
  }
}

function collect(urls, opt) {
  const ss = strategies(opt.strategy);
  const session = opt.session || defaultSession();
  const dir = newEvidenceDir("pagespeed");
  const results = [];
  console.error(
    `[psi-web] 证据目录 ${dir}\n` +
    `[psi-web] **把 Chrome 切到最前并保持那个标签页可见**——后台标签页出不了分。`,
  );
  try {
    for (const u of urls) {
      for (const s of ss) {
        console.error(`[psi-web] ${s} ${u} …（最多等 ${opt.budget}s）`);
        const r = collectOne(session, dir, u, s, opt);
        results.push(r);
        console.error(`[psi-web]   → ${r.stopReason}：${explain(r.stopReason)}`);
      }
    }
  } finally {
    try {
      writeFileSync(join(dir, "results.json"), JSON.stringify(results, null, 2) + "\n");
    } catch { /* 落盘失败不能拦住关会话 */ }
    try {
      writeManifest(dir, {
        script: "pagespeed",
        mode: "web",
        session,
        hl: opt.hl,
        budgetSeconds: opt.budget,
        targets: results.map((r) => ({ target: r.target, strategy: r.strategy, stopReason: r.stopReason })),
        finishedAt: new Date().toISOString(),
      });
    } catch { /* 同上 */ }
    closeSession(session);
  }

  console.log(`\n证据在 ${dir}（每个 (URL × 端) 一对：截图 + 页面文本）。`);
  console.log(`本脚本只采集，**不下结论**——分数、现场有没有数据，由 AI 对着`);
  console.log(`截图与文本两个证人判读，然后按 plan 子命令给的表格记进 .rankup/baseline.md。\n`);
  for (const r of results) {
    console.log(`  [${r.strategy}] ${r.target} → ${r.stopReason}`);
  }
  const stuck = results.filter((r) => r.stopReason !== "ready");
  if (stuck.length) {
    console.log(`\n${stuck.length} 个没跑出报告。**不要把它们记成「性能没问题」或「没有数据」**：`);
    for (const r of stuck) console.log(`  · [${r.strategy}] ${r.target} — ${explain(r.stopReason)}`);
    process.exitCode = 2;
  }
}

// ── main ────────────────────────────────────────────────────────────────

const { cmd, urls, opt } = parseArgs(process.argv.slice(2));
if (opt.help) {
  console.log(HELP);
  process.exit(0);
}
if (urls.length === 0) {
  console.log(HELP);
  process.exit(1);
}
if (!Number.isFinite(opt.budget) || opt.budget <= 0) die(`--budget 要是正数秒数，收到：${opt.budget}`);

if (cmd === "collect") collect(urls, opt);
else plan(urls, opt);
