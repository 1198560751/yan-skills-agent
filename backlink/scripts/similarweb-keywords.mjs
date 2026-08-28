#!/usr/bin/env node
/**
 * similarweb-keywords.mjs —— 从一个种子词批量扩词（Similarweb 关键词生成器）。
 *
 * 为什么单独一个脚本：`similarweb-query.mjs` 整个契约是「查一个域名的报表」，
 * 入口第一行就是 `normalizeDomain(required(flags, 'domain'))`。词维度和域名维度
 * 是两种主体，Semrush 那边也是 `semrush-report.mjs` / `semrush-keyword.mjs` 这样分的。
 * **但解析只有一份**，住在 `lib-similarweb.mjs`——这里不重复任何取值逻辑。
 *
 * 它补的是选词流水线的入口。`rankup/references/experiences/demand-discovery.md`
 * 记的规模是「1,309 个词根 → Similarweb 扩出 97,681 个关键词」，而这一步此前完全
 * 没有脚本，整条流水线卡在源头。
 *
 * 用法：
 *   node similarweb-keywords.mjs --seed "nonogram"
 *   node similarweb-keywords.mjs --seed "nonogram" --tab relatedKeywords --out kw.json
 *   node similarweb-keywords.mjs --seed-file roots.txt --tab relatedKeywords --out kw.jsonl --jsonl
 *
 * 参数：
 *   --seed <词>            种子词（与 --seed-file 二选一）
 *   --seed-file <file>     一行一个种子词，批量跑；复用同一个会话
 *   --tab <t>              phraseMatch（默认，词组匹配）| relatedKeywords（相关词，量最大）
 *                          | trending（热门）| questions（问题查询）
 *   --country <code>       国家代码，留空 = 全球
 *   --out <file>           落盘；配 --jsonl 时一行一个词
 *   --jsonl                以 JSON Lines 输出词行，便于几万行的批量
 *   --session <name>       opencli 会话名，默认按项目派生
 *   --settle <s>           首屏等待秒数（默认 18）
 *   --timeout <s>          单个种子词的整体超时（默认 120）
 *   --keep-open            跑完保留标签页
 *   --self-test            离线自检
 *   --help
 *
 * 【必须知道的两条】
 * 1. **这张表在 DOM 里按列渲染**，innerText 是「行号一块、关键词一块」，按行切分必错位。
 *    提取器和解析器都在 lib 里，理由写在那边。
 * 2. **本脚本只读当前页**（100 行）。页面自报的总量写进 `shownTotal`，
 *    `complete` 明确告诉你读全了没有——不做静默截断。
 */
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import {
  closeSession, resolveSession, parseFlags, printJson,
  showHelpIfRequested, validateSession,
} from './opencli-core.mjs';
import { captureStable, expiryWarning, gotoInTool, launchTool, redactSecrets } from './lib-tools-share.mjs';
import { SW_KEYWORD_TABLE_CELLS, deriveKeywordRows, parseNumber } from './lib-similarweb.mjs';

const flags = parseFlags(process.argv.slice(2));
showHelpIfRequested(flags, import.meta.url);

/** 标签页决定扩词口径。值是从页面上点出来的，不是猜的。 */
const TABS = new Set(['phraseMatch', 'relatedKeywords', 'trending', 'questions']);
const tab = String(flags.tab || 'phraseMatch');
if (!TABS.has(tab)) {
  console.error(`--tab must be one of: ${[...TABS].join(', ')}`);
  process.exit(2);
}

const appOrigin = (process.env.TOOLS_SHARE_APP_ORIGIN || 'https://sim.3ue.co').replace(/\/+$/, '');
const country = String(flags.country || '999');
const settle = Number(flags.settle || 18);
const timeoutMs = Number(flags.timeout || 120) * 1000;

function routeFor(seed) {
  return `${appOrigin}/#/digitalsuite/acquisition/findkeywords/keyword-generator-tool/${encodeURIComponent(country)}/28d`
    + `?searchEngine=google&webSource=Total&isWWW=*&tab=${tab}&keyword=${encodeURIComponent(seed)}`;
}

/** 页面自报的「显示的关键词总数」，用来判断读全了没有。 */
function shownTotal(text) {
  const m = String(text).match(/([\d,.]+[KMB万]?)\s*\n\s*显示的关键词总数/);
  return m ? parseNumber(m[1]) : null;
}

if (flags['self-test']) {
  const cells = {
    headers: ['关键词', '28 天的体量', '平均体量', '年趋势', '零点击搜索', 'KD', '意图', 'CPC'],
    rows: [
      ['nonograms', '106.1K', '74.2K', '', '44%', '60', 'NAV\nINFO', '$1.21'],
      ['dash keyword', '-', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', ''],
    ],
  };
  const parsed = deriveKeywordRows(cells);
  // 列顺序换了，按名取值的结果必须不变。
  const swap = (a, i, j) => { const c = [...a]; [c[i], c[j]] = [c[j], c[i]]; return c; };
  const shuffled = deriveKeywordRows({ headers: swap(cells.headers, 1, 5), rows: cells.rows.map((r) => swap(r, 1, 5)) });
  // 列名改了要报出来，不能悄悄给 null。
  const renamed = deriveKeywordRows({ headers: cells.headers.map((h) => (h === 'KD' ? 'Difficulty' : h)), rows: cells.rows });
  const ok = parsed.rows.length === 2
    && parsed.rows[0].volume28d === 106100 && parsed.rows[0].cpc === 1.21
    && parsed.rows[0].zeroClickPercent === 44 && parsed.rows[0].intent.join('|') === 'NAV|INFO'
    // `-` 是「没有值」，落成 0 会被下游读成「这个词没人搜」。
    && parsed.rows[1].volume28d === null && parsed.rows[1].kd === null
    && parsed.missingColumns.length === 0
    && JSON.stringify(shuffled.rows) === JSON.stringify(parsed.rows)
    && renamed.missingColumns.includes('KD') && renamed.rows[0].kd === null
    && shownTotal('8,888\n显示的关键词总数') === 8888
    && TABS.has('relatedKeywords') && routeFor('a b').includes('keyword=a%20b');
  if (!ok) throw new Error(`similarweb-keywords self-test failed: ${JSON.stringify({ parsed, shuffled, renamed })}`);
  console.log('similarweb-keywords self-test: PASS');
  process.exit(0);
}

const seeds = flags['seed-file']
  ? readFileSync(String(flags['seed-file']), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  : [String(flags.seed || '').trim()].filter(Boolean);
if (!seeds.length) {
  console.error('--seed or --seed-file is required.');
  process.exit(2);
}

const session = resolveSession(flags, 'similarweb-keywords', 'similarweb');
const results = [];
let launched;
try {
  launched = await launchTool({ tool: 'similarweb', session, flags, allowParallelSession: Boolean(flags['allow-parallel-session']) });
  const evaluate = launched.evalPage;

  for (const seed of seeds) {
    // hash 路由的 SPA：换 hash 不重载页面，深链之后必须等它自己渲染完。
    await gotoInTool(evaluate, routeFor(seed), settle);
    const settled = await captureStable({
      read: () => evaluate(`(() => JSON.stringify({
        text: (document.body?.innerText || '').slice(0, 40000),
        cells: ${SW_KEYWORD_TABLE_CELLS},
      }))()`),
      // 就绪判据认**表体**：标签页和筛选器在骨架阶段就在了，认它们会抓到空表。
      fingerprint: (cap) => {
        if (!cap?.cells?.rows?.length) return null;
        const parsed = deriveKeywordRows(cap.cells);
        return parsed.rows.length ? JSON.stringify(parsed) : null;
      },
      timeoutMs,
      intervalMs: Number(flags['stable-interval'] || 2.5) * 1000,
    });

    if (!settled.stable) {
      results.push({ seed, tab, country, status: 'unavailable', error: { code: 'table_never_settled', message: `等了 ${timeoutMs / 1000}s 表体没有稳定下来——不是「这个词没有扩展词」` } });
      continue;
    }
    const parsed = JSON.parse(settled.fingerprint);
    const total = shownTotal(settled.capture.text);
    results.push({
      seed, tab, country,
      shownTotal: total,
      rows: parsed.rows,
      rowsRead: parsed.rows.length,
      // 少读了必须说出来，别让调用方以为这就是全部。
      complete: total === null ? null : parsed.rows.length >= total,
      missingColumns: parsed.missingColumns,
      reads: settled.reads,
    });
    if (total !== null && parsed.rows.length < total) {
      console.error(`[partial] ${seed}: 页面自报 ${total} 个词，本次只读到 ${parsed.rows.length} 个（当前页）。`);
    }
    // 缺列要在 stderr 上说，不能只写进 JSON 里等人去翻——不同标签页的列并不一样，
    // 实测 relatedKeywords 没有「28 天的体量」这一列，那一列会整列是 null。
    if (parsed.missingColumns.length) {
      console.error(`[missing-columns] ${seed} (tab=${tab}): ${parsed.missingColumns.join('、')} —— 这些字段整列为 null，不是「没有数据」。`);
    }
  }
} catch (error) {
  results.push({ status: 'unavailable', error: { code: 'query_failed', message: redactSecrets(error.message) } });
} finally {
  await launched?.releaseBrowserLocks?.();
  if (!flags['keep-open']) await closeSession(session);
}

const output = {
  version: 1,
  source: 'Similarweb keyword generator via authenticated Tools Share browser session',
  retrievedAt: new Date().toISOString(),
  tab, country, session,
  subscription: launched ? {
    expiry: launched.state.expiry, daysLeft: launched.state.daysLeft,
    quotas: launched.state.quotas, warning: expiryWarning(launched.state),
  } : null,
  seeds: results,
};

if (flags.jsonl) {
  const lines = results.flatMap((r) => (r.rows || []).map((row) => JSON.stringify({ seed: r.seed, tab, country, ...row })));
  if (typeof flags.out === 'string') await writeFile(String(flags.out), `${lines.join('\n')}\n`, 'utf8');
  else console.log(lines.join('\n'));
} else {
  if (typeof flags.out === 'string') await writeFile(String(flags.out), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  printJson(output);
}
if (results.some((r) => r.status === 'unavailable')) process.exitCode = 1;
