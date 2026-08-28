#!/usr/bin/env node
/**
 * 用途：把关键词表里的 CPC 变成一个**参与决策**的信号，而不是一个抓下来就没人看的字段。
 * 依赖：无（纯计算，不联网、不开浏览器）
 * 已验证日期：2026-08-28
 *
 * ## 为什么需要这个脚本
 *
 * CPC 在本仓库里被四个解析器抓下来（semrush-report 的关键词魔法工具、semrush-keyword
 * 的关键词概览、lib-similarweb 的两张关键词表），但 2026-08-28 全库检索确认：
 * **没有任何一个决策脚本读过它。** 只有 aitdk-lookup 把它当字段透传。
 *
 * 而判断规则其实早就写在文档里了，散在两个文件三个地方，从没落成可执行的东西：
 *
 * | 出处 | 说的是 |
 * |---|---|
 * | `seo-growth.md` 负向清单 | 高 CPC + top10 是 SaaS → **危险信号**，那是巨头在竞价 |
 * | `demand-discovery.md` 第二条心得 | 「KD 很低、搜索量不用高、**有点 CPC 就行**」 |
 * | `demand-discovery.md` 第六条 | 加权 CPC ≈$1、选词指标全绿的赛道，真实收入 $20–100/月 |
 *
 * 合起来是个 U 型：CPC 太低说明没人愿意为这个词付钱；CPC 太高说明你在跟买量的
 * 公司抢，KD 不可信。中间才是甜区。
 *
 * ## 这个脚本刻意不做的两件事
 *
 * **不给绝对的 CPC 档位阈值。** CPC 的量级跟垂类强相关——实测 image converter 这个
 * 工具类赛道 100 个词的 CPC 挤在 $0.9–1.1，而保险、法律类单词就能到几十美元。
 * 拿一套写死的 `$0.5 / $3` 去卡所有垂类，是在用一个凭空来的数字覆盖真实分布。
 * 所以分档一律**相对于这批词自己的中位数**。
 *
 * **不给收入点估计。** 只给区间，并且把假设和它唯一的那个校准锚点一起印出来。
 * 见下面 REVENUE_ANCHOR 的注释——样本量是 1，任何比「一个数量级」更精确的说法
 * 都是编的。本仓库的底线是：一个看起来对的错数字，比一次显式失败更糟。
 */

import { parseArgs, emit, die } from './_lib.mjs';
import fs from 'node:fs';

/**
 * 唯一一个「选词指标 → 真实收入」的实测锚点，来自 demand-discovery.md 第六条
 * （实测 2026-08-28）：一条加权 CPC ≈$1、低难度词一百多个、几十万月搜的赛道，
 * 同类站真实流量几百到 8,000/月，折成展示广告是 $20–100/月。
 *
 * 上沿反推：8,000 访问 → $100，约合每千访问 $12.5，即每次访问 $0.0125。
 * 同期该赛道 CPC ≈ $1。也就是说**每次访问的实得收入约为 CPC 的 1.25%**。
 *
 * ⚠️ 样本量 = 1，且只覆盖「工具站 + 展示广告」这一种变现方式。它能支撑的结论
 * 只有「CPC 和实得收入差一到两个数量级」这一句；拿它去算某个具体赛道能赚多少，
 * 是把一个锚点当成了一条曲线。所以下面只用它产出区间，不产出点估计。
 */
const REVENUE_ANCHOR = {
  source: 'demand-discovery.md 第六条（实测 2026-08-28）',
  visitsPerMonth: 8000,
  revenueUsdPerMonth: 100,
  cohortCpcUsd: 1,
  get revenuePerVisitUsd() { return this.revenueUsdPerMonth / this.visitsPerMonth; },
  get shareOfCpc() { return this.revenuePerVisitUsd / this.cohortCpcUsd; },
  sampleSize: 1,
  caveat: '单点锚定，只覆盖「工具站 + 展示广告」。只支持「差一到两个数量级」这个量级判断。',
};

/** 「搜索量 → 站点访问量」的折损。demand-discovery 第六条把这一折和下一折
 * 都记作「可以是一个数量级」，所以这里给的是区间而不是一个系数。
 * 下沿 2%：排在首页靠后。上沿 25%：稳定 top3。 */
const CAPTURE_RATE = { low: 0.02, high: 0.25 };

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 中位数。空集合返回 null，不返回 0——「没有数据」和「中位数是 0」是两件事。 */
export function median(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * 单个词的商业价值信号。
 *
 * **`null` 和 `0` 必须分开。** null 是「这次没取到 CPC」（页面没渲染、列解析失败、
 * 指标待刷新），0 是「取到了，广告主确实不出价」。把前者当成后者，等于把一次
 * 抓取失败读成一个业务结论——这正是本仓库反复出事的那类错误。
 */
export function cpcSignal(cpc, cohortMedian) {
  if (cpc === null || cpc === undefined) {
    return { level: 'unknown', why: 'CPC 未取到（不是「没有商业价值」，是这次没读到）' };
  }
  if (cpc === 0) {
    return { level: 'none', why: '广告主明确不出价——这个词没有可变现的商业意图' };
  }
  if (cohortMedian === null || cohortMedian <= 0) {
    return { level: 'unranked', why: '这批词里没有足够的 CPC 数据来定相对位置' };
  }
  const ratio = cpc / cohortMedian;
  // 相对于**这批词自己**的中位数分档，不用绝对金额——理由见文件头。
  if (ratio < 0.3) return { level: 'low', ratio, why: '远低于同批中位数，商业意图弱' };
  if (ratio <= 2) return { level: 'normal', ratio, why: '落在同批词的正常区间' };
  return {
    level: 'high',
    ratio,
    // 这一档**不是好消息**。seo-growth.md 的负向清单里，高 CPC 是跳过的理由之一。
    why: '远高于同批中位数。先查 top10 是不是被把工具页当获客漏斗的 SaaS 占了——'
       + '是的话这个词的 KD 不可信，高 CPC 是「有人在买量」而不是「这词好做」',
    checkSerpBeforeUsing: true,
  };
}

/**
 * 月收入区间。返回 null 表示「算不了」，不返回 0。
 * 每个结果都自带 assumptions，调用方要转述这个数字就必须一起转述假设。
 */
export function revenueRange(volume, cpc) {
  const v = num(volume);
  if (v === null || v <= 0) return null;
  const perVisit = REVENUE_ANCHOR.revenuePerVisitUsd;
  const low = v * CAPTURE_RATE.low * perVisit;
  const high = v * CAPTURE_RATE.high * perVisit;
  return {
    lowUsdPerMonth: Math.round(low * 100) / 100,
    highUsdPerMonth: Math.round(high * 100) / 100,
    assumptions: [
      `搜索量 → 访问量的捕获率 ${CAPTURE_RATE.low * 100}%–${CAPTURE_RATE.high * 100}%`,
      `每次访问实得 $${perVisit}（锚点：${REVENUE_ANCHOR.source}，样本量 ${REVENUE_ANCHOR.sampleSize}）`,
      REVENUE_ANCHOR.caveat,
    ],
    // 把「CPC 看着很值钱」和「实际能拿到多少」并排放，这个落差是第六条的全部重点。
    cpcWouldSuggest: num(cpc) === null ? null
      : Math.round(v * CAPTURE_RATE.high * cpc * 100) / 100,
    note: 'cpcWouldSuggest 是「如果每次访问都能拿到整个 CPC」的假想值，'
        + '实测锚点显示实得约为它的 1%。两个数字并排看，不要单看前者。',
  };
}

/**
 * 整批词的收入区间合计。**这才是选赛道时该看的数字**——单个词的区间小到没有
 * 决策意义，而「一百多个低难度词」这种说法听着很多，加起来往往还是零头。
 * demand-discovery 第六条那个案例就是这么塌的：所有选词指标全绿，合计收入
 * $20–100/月。
 *
 * 只加得出区间的行。加不出来的行数单独报，不要把它们当成 0 悄悄吞掉。
 */
export function cohortRevenue(rows) {
  let low = 0, high = 0, counted = 0, skipped = 0;
  for (const r of rows) {
    if (!r.revenue) { skipped += 1; continue; }
    low += r.revenue.lowUsdPerMonth; high += r.revenue.highUsdPerMonth; counted += 1;
  }
  return {
    lowUsdPerMonth: Math.round(low * 100) / 100,
    highUsdPerMonth: Math.round(high * 100) / 100,
    counted,
    skipped,
  };
}

/** 给一整批词打上信号。中位数从这批词自己算，所以同一个词在不同批次里可以有不同档位——
 * 这是**故意的**：CPC 的意义本来就只有在同垂类内部比较才成立。 */
export function annotate(rows) {
  const cohortMedian = median(rows.map((r) => num(r.cpc)));
  return {
    cohortMedian,
    cohortSize: rows.length,
    cpcKnown: rows.filter((r) => num(r.cpc) !== null).length,
    rows: rows.map((r) => ({
      ...r,
      cpcSignal: cpcSignal(num(r.cpc), cohortMedian),
      revenue: revenueRange(r.volume, num(r.cpc)),
    })),
  };
}

/** `$1.09` / `1.09` / null 都要吃得下——semrush-keyword 输出带 `$`，
 * 关键词魔法工具输出是裸数字，两边都会喂进来。 */
export function parseCpc(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const m = String(value).trim().match(/^[$¥€£]?\s*([\d.]+)$/);
  return m ? Number(m[1]) : null;
}

function loadRows(file) {
  const text = fs.readFileSync(file, 'utf8').trim();
  const asRow = (o) => ({ keyword: o.keyword, volume: o.volume ?? null, kd: o.kd ?? null, cpc: parseCpc(o.cpc) });
  if (text.startsWith('{') && text.includes('\n{')) {          // JSONL
    return text.split('\n').filter(Boolean).map((l) => asRow(JSON.parse(l)));
  }
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : parsed.parsed?.rows ?? parsed.rows;
  if (!Array.isArray(rows)) die('输入里找不到关键词行：需要数组、{rows:[...]}、{parsed:{rows:[...]}} 或 JSONL');
  return rows.map(asRow);
}

// ---------------------------------------------------------------- self-test
function selfTest() {
  const ok = [];
  const check = (name, cond) => { ok.push([name, cond]); };

  // null ≠ 0：这是这个文件最重要的一条区分。
  check('CPC 未取到 → unknown（不是「没价值」）', cpcSignal(null, 1).level === 'unknown');
  check('CPC 取到且为 0 → none', cpcSignal(0, 1).level === 'none');

  const med = median([0.3, 0.95, 1.09, 1.09, 5]);
  check('中位数取中间值', med === 1.09);
  check('空集合的中位数是 null，不是 0', median([]) === null);
  check('全 null 的一批词，中位数是 null', median([null, undefined]) === null);

  check('远低于中位数 → low', cpcSignal(0.1, 1).level === 'low');
  check('中位数附近 → normal', cpcSignal(1.2, 1).level === 'normal');
  check('远高于中位数 → high', cpcSignal(9, 1).level === 'high');
  // 高 CPC 必须带着「先去查 SERP」的提示，否则它会被当成好消息读。
  check('high 档带 SERP 复核标记', cpcSignal(9, 1).checkSerpBeforeUsing === true);
  check('normal 档不带 SERP 复核标记', cpcSignal(1.2, 1).checkSerpBeforeUsing === undefined);

  // 实测数据回归：image converter 那批词（2026-08-28 live）中位数 0.95，
  // 'jpg changer' 的 0.3 落在 low，主词 1.09 落在 normal。
  const live = annotate([
    { keyword: 'image converter', volume: 18100, cpc: 1.09 },
    { keyword: 'photo converter', volume: 2900, cpc: 1.02 },
    { keyword: 'jpg changer', volume: 390, cpc: 0.3 },
    { keyword: 'no-cpc word', volume: 100, cpc: null },
  ]);
  check('中位数只用有值的行算', live.cohortMedian === 1.02);
  check('cpcKnown 不把 null 算进去', live.cpcKnown === 3);
  check('实测：主词落 normal', live.rows[0].cpcSignal.level === 'normal');
  check('实测：0.3 相对 1.02 落 low', live.rows[2].cpcSignal.level === 'low');
  check('CPC 为 null 的行仍然给出收入区间（收入只需要搜索量）',
    live.rows[3].revenue !== null && live.rows[3].revenue.cpcWouldSuggest === null);

  const rev = revenueRange(100000, 1);
  check('收入是区间不是点估计', rev.lowUsdPerMonth < rev.highUsdPerMonth);
  check('收入结果必须自带假设', Array.isArray(rev.assumptions) && rev.assumptions.length === 3);
  // 第六条的全部重点：CPC 口径和实得口径差一到两个数量级。
  check('CPC 口径比实得口径高一到两个数量级',
    rev.cpcWouldSuggest / rev.highUsdPerMonth > 10 && rev.cpcWouldSuggest / rev.highUsdPerMonth < 1000);
  check('搜索量为 0 算不出收入，返回 null 而不是 0', revenueRange(0, 1) === null);
  check('搜索量缺失算不出收入', revenueRange(null, 1) === null);

  const cohort = cohortRevenue(annotate([
    { keyword: 'a', volume: 1000, cpc: 1 },
    { keyword: 'b', volume: 1000, cpc: 1 },
    { keyword: 'c', volume: null, cpc: 1 },   // 缺搜索量：不能当 0 吞掉
  ]).rows);
  check('合计只加得出区间的行', cohort.counted === 2);
  check('加不出来的行单独报，不当成 0', cohort.skipped === 1);
  check('合计区间是两行之和', cohort.highUsdPerMonth === 2 * revenueRange(1000, 1).highUsdPerMonth);

  check('parseCpc 吃得下 $1.09', parseCpc('$1.09') === 1.09);
  check('parseCpc 吃得下裸数字', parseCpc(1.09) === 1.09);
  check('parseCpc 认不出的格式给 null，不给 0', parseCpc('一美元') === null);
  check('parseCpc 保留真实的 0', parseCpc('$0') === 0);

  const failed = ok.filter(([, c]) => !c);
  for (const [name] of failed) console.error(`FAIL: ${name}`);
  if (failed.length) { console.error(`keyword-value self-test: ${failed.length}/${ok.length} FAILED`); process.exit(1); }
  console.log(`keyword-value self-test: PASS (${ok.length} checks)`);
}

// ---------------------------------------------------------------------- main
const args = parseArgs();
if (args['self-test']) { selfTest(); process.exit(0); }
if (args.help || !args.in) {
  console.log(`keyword-value.mjs — 把 CPC 变成能参与决策的信号

用法：
  node keyword-value.mjs --in <关键词 JSON/JSONL>
  node keyword-value.mjs --in km.json --json
  node keyword-value.mjs --self-test

吃得下 semrush-report --report keyword-magic 的 --out、semrush-keyword 的 --out
JSONL、以及任何 [{keyword, volume, kd, cpc}] 数组。

分档一律相对于**这批词自己的中位数**，不用绝对金额——CPC 量级跟垂类强相关。
收入只给区间并附带假设；唯一的校准锚点样本量是 1，见文件头注释。`);
  process.exit(args.in ? 0 : 1);
}

const result = annotate(loadRows(args.in));
if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`同批中位数 CPC: ${result.cohortMedian === null ? '无数据' : '$' + result.cohortMedian}`
    + `  |  ${result.cpcKnown}/${result.cohortSize} 个词取到了 CPC`);
  emit(result.rows.map((r) => ({
    keyword: r.keyword,
    volume: r.volume,
    kd: r.kd,
    cpc: r.cpc,
    signal: r.cpcSignal.level,
    'rev$/mo': r.revenue ? `${r.revenue.lowUsdPerMonth}–${r.revenue.highUsdPerMonth}` : '—',
  })), args, [
    { key: 'keyword', label: '关键词', max: 34 },
    { key: 'volume', label: '搜索量' },
    { key: 'kd', label: 'KD' },
    { key: 'cpc', label: 'CPC' },
    { key: 'signal', label: '信号' },
    { key: 'rev$/mo', label: '月收入区间$' },
  ]);
  const total = cohortRevenue(result.rows);
  console.log(`\n整批合计月收入区间：$${total.lowUsdPerMonth}–${total.highUsdPerMonth}`
    + `（${total.counted} 个词参与计算${total.skipped ? `，${total.skipped} 个词缺搜索量、未计入` : ''}）`);
  console.log('  ↑ 这是选赛道该看的数字。单个词的区间小到没有决策意义，'
    + '而「一百多个低难度词」加起来往往仍是零头——假设见 --json 输出里的 assumptions。');
  const high = result.rows.filter((r) => r.cpcSignal.checkSerpBeforeUsing);
  if (high.length) {
    console.error(`\n⚠ ${high.length} 个词的 CPC 远高于同批中位数。这不是好消息——`
      + `先查这些词的 top10 是不是被把工具页当获客漏斗的 SaaS 占了，是的话它们的 KD 不可信。`);
  }
}
