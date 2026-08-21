#!/usr/bin/env node
/**
 * semrush-positions.mjs — 拉一个域名的「自然排名」全表（关键词 / 排名 / 搜索量 / KD / 落地页）。
 *
 * 为什么需要它：Skill 里 semrush 相关脚本此前只到**域名概览**（总数）和**关键词点查**（单词），
 * 「这个站到底靠哪些词吃饭、每个词落在哪个页面」没有脚本，只能手开浏览器翻。
 * 而这正是竞品拆解里最有价值的一张表——尤其对自创类型体系的站，
 * 它能直接告诉你**用户在搜哪些自创类型名**。
 *
 * ── 三个坑 ────────────────────────────────────────────────────────────────
 * 1. **这张表不是 `<table>`。** `document.querySelectorAll('table')` 返回 0，
 *    它是虚拟滚动的 ARIA 网格。按 table 抓会拿到空数组却不报错——
 *    典型的「静默成功」。必须走 `[role="row"]` / `[role="gridcell"]`。
 * 2. **虚拟滚动只渲染视口内的行。** 不滚动就只拿得到前十几行，
 *    而结果看起来完全正常。所以要边滚边收，用关键词做去重键，
 *    直到连续 N 轮没有新行才停。
 * 3. **有速率限制**：连续切报表会撞上「请求过于频繁, 请1分钟后再试」。
 *    这句话是**页面正文**，不是 HTTP 错误，抓取器会把它当成一个正常的空页面。
 *    识别到就退避，别把它记成「这个域名没有排名词」。
 *
 * 用法：
 *   node semrush-positions.mjs --domain example.com --db jp --out out.json [--max-rows 500]
 */
import { defaultSession, parseFlags, printJson, required, validateSession } from './opencli-core.mjs';
import { expiryWarning, gotoInTool, launchTool, scrub } from './lib-tools-share.mjs';
import { writeFile } from 'node:fs/promises';

const flags = parseFlags(process.argv.slice(2));
const domain = required(flags, 'domain').trim().toLowerCase().replace(/^www\./, '');
const db = String(flags.db || 'jp').trim().toLowerCase();
const session = flags.session ? validateSession(flags.session) : defaultSession('sem-positions');
const appOrigin = (process.env.TOOLS_SHARE_APP_ORIGIN_SEMRUSH || 'https://sem.3ue.co').replace(/\/+$/, '');
const maxRows = Number(flags['max-rows'] || 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const parseCompact = (v) => {
  const m = String(v || '').replace(/,/g, '').trim().match(/^([\d.]+)\s*([KMB])?$/i);
  return m ? Math.round(Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1)) : null;
};

const RATE_LIMIT = /请求过于频繁|too many requests/i;

/** 一屏可见的行。返回原始单元格数组，解析放到 Node 侧做，方便出错时看原文。 */
const HARVEST = `(() => {
  const text = document.body?.innerText || '';
  // **单元格没有 role 属性**（role 只在行上），所以只能取直接子元素。
  // 早先按 [role="gridcell"] 抓，返回空数组、脚本报 rowCount:0 却不报错——静默成功。
  const rows = [...document.querySelectorAll('[role="row"]')].map((r) =>
    [...r.children].map((c) => (c.innerText || '').trim().replace(/\\s*\\n\\s*/g, ' ')));
  return JSON.stringify({ rateLimited: ${RATE_LIMIT.source ? '/请求过于频繁|too many requests/i.test(text)' : 'false'}, rows });
})()`;

let output;
try {
  const launched = await launchTool({
    session, tool: 'semrush', node: flags.node, window: flags.window,
    wait: Number(flags.wait || 7), timeout: Number(flags.launchTimeout || 60),
  });

  const url = `${appOrigin}/analytics/organic/positions/?q=${encodeURIComponent(domain)}&db=${encodeURIComponent(db)}&searchType=domain`;
  const nav = await gotoInTool(launched.evalPage, url, Number(flags.settle || 20));

  const seen = new Map();
  let dry = 0;
  let rateLimited = false;
  for (let i = 0; i < Number(flags['max-scrolls'] || 40) && seen.size < maxRows; i++) {
    const cap = await launched.evalPage(HARVEST);
    if (cap.rateLimited) { rateLimited = true; await sleep(65_000); continue; }
    rateLimited = false;
    const before = seen.size;
    for (const cells of cap.rows || []) {
      // 表头行没有 gridcell，长度也对不上；数据行至少要有关键词 + 几个数值。
      if (!cells || cells.length < 8) continue;
      const keyword = cells[1];
      if (!keyword || /^关键词$/.test(keyword)) continue;
      if (!seen.has(keyword)) seen.set(keyword, cells);
    }
    dry = seen.size === before ? dry + 1 : 0;
    if (dry >= 3) break;
    await launched.evalPage(`(() => { window.scrollBy(0, Math.round(window.innerHeight * 0.85)); const g=document.querySelector('[role="grid"]'); if (g) g.scrollTop += g.clientHeight * 0.85; return JSON.stringify({s:1}); })()`);
    await sleep(1800);
  }

  // 列序（2026-08-21 实测）：
  //   0 空 | 1 关键词 | 2 意图 | 3 当前排名 | 4 前次排名 | 5 流量 | 6 流量成本% | 7 搜索量 | 8 KD | 9 落地页 | 10 更新时间
  // 固定列序比"找第一个像数字的"稳，但列可能被用户改过，所以 cells 原样保留供核对。
  const rows = [...seen.values()].map((c) => ({
    keyword: c[1],
    intent: c[2] || null,
    position: /^\d{1,3}$/.test(c[3] || '') ? Number(c[3]) : null,
    previousPosition: /^\d{1,3}$/.test(c[4] || '') ? Number(c[4]) : null,
    traffic: parseCompact(c[5]),
    volume: parseCompact(c[7]),
    kd: /^\d{1,3}$/.test(c[8] || '') ? Number(c[8]) : null,
    landingPage: c[9] || null,
    updated: c[10] || null,
    cells: c,
  }));

  output = {
    version: 1,
    source: 'Semrush organic positions via authenticated Tools Share browser session',
    note: '列的解析是位置启发式，cells 保留原始单元格供核对。判断前先看 cells。',
    retrievedAt: new Date().toISOString(),
    domain, db, session,
    landed: scrub(nav.url),
    rateLimitedDuringRun: rateLimited,
    subscription: { expiry: launched.state.expiry, daysLeft: launched.state.daysLeft, warning: expiryWarning(launched.state) },
    rowCount: rows.length,
    rows,
  };
} catch (error) {
  output = { version: 1, domain, db, session, status: 'unavailable', error: { code: 'positions_failed', message: error.message } };
}

if (typeof flags.out === 'string') await writeFile(flags.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
printJson({ ...output, rows: undefined, sample: (output.rows || []).slice(0, 3) });
if (output.status === 'unavailable') process.exitCode = 1;
