#!/usr/bin/env node
// PageSpeed Insights 取数：一次调用同时拿实验室(Lighthouse)与现场(CrUX)数据。
//
// 为什么要有这个脚本：阶段 7.5 闸门 6 要求「实验室与现场数据都记录，不一致以现场为准」。
// 在此之前 checklists 只写了「跑 Lighthouse」——那只给实验室数据，现场那一半没有任何工具，
// 于是闸门 6 长期只能过一半而看不出来。PSI 的 v5 接口一次返回两者，正好对上这条判据。
//
// 已验证（2026-08-29）：
//   * 不带 key 调用走的是 Google 自己那个共享项目的配额，**实测常年 429**
//     （RESOURCE_EXHAUSTED / project_number:583797351490）。所以「匿名能跑」是假象，
//     必须自带免费 key。key 在 Google Cloud 开 PageSpeed Insights API 即得，免费 25k/日。
//   * 现场数据缺失是正常返回而不是错误：响应里根本没有 loadingExperience 字段。
//     新站流量不够进 CrUX 就是这个形态。**必须显式记成「现场无数据（流量不足）」，
//     不得留空、更不得当成 0 分**——留空会在下一轮被读成「查过了，没问题」。
//   * PSI 单次要 10–30 秒，且并发容易触发 429，所以这里固定串行。
//
// 用法：
//   node pagespeed.mjs <url...> [--strategy mobile|desktop|both] [--json] [--md] [--out <file>]
//                      [--allow-anonymous]
//
// 令牌：环境变量 PAGESPEED_API_KEY 优先，退到本 Skill 目录 .env 的 PAGESPEED_API_KEY=。
//
// **没有 key 时默认直接退出（退出码 1），不发任何请求。** 以前只打一行 warn 就照样匿名跑，
// 于是「不要让它匿名跑」这条纪律只写在文档里、没人执行，实跑必然撞 429 才发现。
// 真要试匿名（例如验证网络通不通），显式加 `--allow-anonymous`。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];
const LAB_METRICS = {
  "largest-contentful-paint": "LCP",
  "cumulative-layout-shift": "CLS",
  "total-blocking-time": "TBT",
  "first-contentful-paint": "FCP",
  "speed-index": "SI",
};
const FIELD_METRICS = {
  LARGEST_CONTENTFUL_PAINT_MS: "LCP",
  INTERACTION_TO_NEXT_PAINT: "INP",
  CUMULATIVE_LAYOUT_SHIFT_SCORE: "CLS",
  FIRST_CONTENTFUL_PAINT_MS: "FCP",
};

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function apiKey() {
  const fromEnv = process.env.PAGESPEED_API_KEY;
  if (fromEnv) return fromEnv.trim();
  const envFile = join(dirname(dirname(fileURLToPath(import.meta.url))), ".env");
  try {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^\s*PAGESPEED_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* 没有 .env 是正常情况 */
  }
  return null;
}

function parseArgs(argv) {
  const urls = [];
  const opt = { strategy: "mobile", json: false, md: false, out: null, allowAnonymous: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--strategy") opt.strategy = argv[++i];
    else if (a === "--json") opt.json = true;
    else if (a === "--md") opt.md = true;
    else if (a === "--out") opt.out = argv[++i];
    else if (a === "--allow-anonymous") opt.allowAnonymous = true;
    else if (a === "-h" || a === "--help") opt.help = true;
    else if (a.startsWith("-")) die(`未知参数：${a}`);
    else urls.push(a.includes("://") ? a : `https://${a}`);
  }
  return { urls, opt };
}

async function run(url, strategy, key) {
  const qs = new URLSearchParams({ url, strategy });
  for (const c of CATEGORIES) qs.append("category", c);
  if (key) qs.set("key", key);

  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(`${ENDPOINT}?${qs}`, { signal: AbortSignal.timeout(120_000) });
    const body = await r.json().catch(() => ({}));
    if (r.ok) return shape(url, strategy, body);
    last = body?.error?.message || `HTTP ${r.status}`;
    // 429 不带 key 时是配额已耗尽，重试没有意义；带 key 时是瞬时限流，退避有用。
    if (r.status === 429 && !key) {
      die(
        `PSI 匿名配额已耗尽（${last}）。\n` +
          "不带 key 调用的是 Google 那个所有人共用的项目，实测常年 429，不是偶发。\n" +
          "拿一枚免费 key（Google Cloud → 启用 PageSpeed Insights API，免费 25000 次/日），\n" +
          "然后 export PAGESPEED_API_KEY=... 或写进本 Skill 目录的 .env。",
      );
    }
    if (attempt < 3) await new Promise((s) => setTimeout(s, attempt * 5000));
  }
  return { url, strategy, error: last };
}

function shape(url, strategy, d) {
  const lr = d.lighthouseResult || {};
  const scores = {};
  for (const [k, v] of Object.entries(lr.categories || {})) {
    scores[k] = v.score == null ? null : Math.round(v.score * 100);
  }
  const lab = {};
  for (const [id, label] of Object.entries(LAB_METRICS)) {
    const a = lr.audits?.[id];
    if (a) lab[label] = { value: a.numericValue ?? null, display: a.displayValue ?? null };
  }
  // 现场数据：page 级优先，没有就退到 origin 级并标明；两者都没有 = CrUX 里流量不足。
  const src = d.loadingExperience?.metrics ? "page" : d.originLoadingExperience?.metrics ? "origin" : null;
  const raw = src === "page" ? d.loadingExperience : src === "origin" ? d.originLoadingExperience : null;
  const field = src
    ? {
        scope: src,
        overall: raw.overall_category ?? null,
        metrics: Object.fromEntries(
          Object.entries(FIELD_METRICS)
            .filter(([id]) => raw.metrics[id])
            .map(([id, label]) => [
              label,
              { p75: raw.metrics[id].percentile, category: raw.metrics[id].category },
            ]),
        ),
      }
    : null;

  const failing = Object.entries(lr.audits || {})
    .filter(([, a]) => a.score !== null && a.score < 0.9 && a.details?.type === "opportunity")
    .map(([id, a]) => ({ id, title: a.title, savingsMs: a.details?.overallSavingsMs ?? null }))
    .sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0))
    .slice(0, 8);

  return {
    url: lr.finalUrl || url,
    strategy,
    fetchedAt: lr.fetchTime || null,
    lighthouseVersion: lr.lighthouseVersion || null,
    scores,
    lab,
    field, // null = CrUX 无数据（流量不足），不是 0
    opportunities: failing,
  };
}

function fmtField(f) {
  if (!f) return "现场：**无数据（CrUX 流量不足）** — 不是 0，也不等于通过";
  const m = Object.entries(f.metrics)
    .map(([k, v]) => `${k} ${v.p75}${k === "CLS" ? "" : "ms"} (${v.category})`)
    .join(" · ");
  return `现场[${f.scope}] ${f.overall || "?"}：${m}`;
}

function toMarkdown(rows) {
  const out = ["| URL | 端 | Perf | A11y | BP | SEO | 实验室 | 现场 |", "|---|---|---|---|---|---|---|---|"];
  for (const r of rows) {
    if (r.error) {
      out.push(`| ${r.url} | ${r.strategy} | — | — | — | — | 失败：${r.error} | — |`);
      continue;
    }
    const lab = Object.entries(r.lab)
      .map(([k, v]) => `${k} ${v.display ?? "?"}`)
      .join(" · ");
    out.push(
      `| ${r.url} | ${r.strategy} | ${r.scores.performance ?? "—"} | ${r.scores.accessibility ?? "—"} | ` +
        `${r.scores["best-practices"] ?? "—"} | ${r.scores.seo ?? "—"} | ${lab} | ${fmtField(r.field)} |`,
    );
  }
  return out.join("\n");
}

const { urls, opt } = parseArgs(process.argv.slice(2));
if (opt.help || urls.length === 0) {
  console.log(
    "用法：node pagespeed.mjs <url...> [--strategy mobile|desktop|both] [--json] [--md] [--out <file>]\n" +
      "                          [--allow-anonymous]\n" +
      "  一次拿实验室(Lighthouse)与现场(CrUX)两套数据，对应阶段 7.5 闸门 6。\n" +
      "  需要免费 key：export PAGESPEED_API_KEY=... 或写进 Skill 目录的 .env。\n" +
      "  没有 key 时**默认直接退出、不发请求**；--allow-anonymous 才走共享配额（实测常年 429）。",
  );
  process.exit(urls.length === 0 && !opt.help ? 1 : 0);
}

const key = apiKey();
if (!key && !opt.allowAnonymous) {
  die(
    "没有 PAGESPEED_API_KEY，已终止，未发出任何请求。\n" +
      "不带 key 调用的是 Google 那个所有人共用的项目，实测常年 429——匿名跑只会浪费一轮时间。\n" +
      "领一枚免费 key：Google Cloud 控制台 → 启用「PageSpeed Insights API」→ 创建 API 密钥，免费 25000 次/日。\n" +
      "然后 export PAGESPEED_API_KEY=... ，或写进本 Skill 目录的 .env（PAGESPEED_API_KEY=...）。\n" +
      "确实要试匿名（只为验证网络可达）：加 --allow-anonymous。",
  );
}
if (!key) {
  console.error("[warn] --allow-anonymous：走匿名共享配额，实测常年 429，读数不可信。");
}
const strategies = opt.strategy === "both" ? ["mobile", "desktop"] : [opt.strategy];
const rows = [];
for (const u of urls) {
  for (const s of strategies) {
    if (!opt.json) console.error(`[psi] ${s} ${u} …`);
    rows.push(await run(u, s, key)); // 固定串行：并发触发 429
  }
}

const text = opt.json ? JSON.stringify(rows, null, 2) : opt.md ? toMarkdown(rows) : renderPlain(rows);
if (opt.out) {
  writeFileSync(opt.out, text + "\n");
  console.error(`[psi] 已写入 ${opt.out}`);
} else {
  console.log(text);
}

function renderPlain(rs) {
  return rs
    .map((r) => {
      if (r.error) return `✗ ${r.url} [${r.strategy}] ${r.error}`;
      const sc = CATEGORIES.map((c) => `${c}=${r.scores[c] ?? "—"}`).join(" ");
      const lab = Object.entries(r.lab)
        .map(([k, v]) => `${k} ${v.display ?? "?"}`)
        .join(" · ");
      const ops = r.opportunities.length
        ? "\n  机会：" + r.opportunities.map((o) => `${o.title}${o.savingsMs ? ` (-${Math.round(o.savingsMs)}ms)` : ""}`).join("；")
        : "";
      return `${r.url} [${r.strategy}]\n  ${sc}\n  实验室：${lab}\n  ${fmtField(r.field)}${ops}`;
    })
    .join("\n\n");
}
