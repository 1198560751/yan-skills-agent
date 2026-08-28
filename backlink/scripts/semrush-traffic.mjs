#!/usr/bin/env node
/**
 * semrush-traffic.mjs — 读 Semrush「流量与市场」(Traffic & Market / .Trends) 的
 * **流量分析总览**：总访问量、唯一访客、购买转化率、页数/访问、平均访问时长、跳出率。
 *
 * 为什么需要这个脚本（它和 semrush-report.mjs 不重复）：
 * semrush-report.mjs / semrush-overview.mjs 读的全是**自然搜索**口径的数——
 * organic traffic 是「Semrush 估算的搜索带来的访问」，天然只有总量的一小块。
 * 跨平台并列时真正对得上 Similarweb 的是 .Trends 这个总访问量口径：
 * 2026-08-28 实测 canva.com 两家相差 2.4%（见 rankup/references/provider-capabilities.md）。
 * semrush-report.mjs 的 `note` 字段早就把读者指向这个路由了，但一直没有脚本实现它——
 * 本文件把那句注释兑现，别再写第二个。
 *
 * 用法：
 *   node semrush-traffic.mjs --domain canva.com
 *   node semrush-traffic.mjs --domain canva.com --out traffic.json --json
 *   node semrush-traffic.mjs --self-test
 *
 * 参数：--domain（必填）/ --session / --node / --out / --json / --help
 *       --settle --timeout --input-timeout 调节等待，正常不用给。
 *       --window 默认 **foreground**（全仓唯一例外，见下面 DEFAULT_WINDOW 的注释：
 *       这张报表在后台标签页里不水合），可显式覆盖成 background / isolated。
 *
 * ──────────────────────────────────────────────────────────────────────
 * 已实测确认的 DOM 契约（2026-08-28 canva.com，**照抄，不要凭直觉改**）
 * ──────────────────────────────────────────────────────────────────────
 *
 * 1. 路由是 `/analytics/traffic/traffic-overview/`。**不是**
 *    `/analytics/traffic/overview/` —— 后者 302 到 Getting Started 落地页并把 query 丢掉，
 *    于是你会在一个空态页上「成功」解析出一堆 null。
 *
 * 2. **深链参数不管用。** `?q=<domain>` 不被这个页面识别，页面停在空态。
 *    所以必须在页面上填域名提交，不能靠拼 URL。
 *
 * 3. 输入框是 `input[aria-label="Input target"]`，在**普通 DOM** 里（不在 shadow DOM）。
 *    它水合很晚——实测至少 10–14 秒才出现，所以这里是轮询等待，不是一次性查询。
 *    提交方式（实测有效）：用 HTMLInputElement.prototype 的原生 value setter 赋值
 *    （React 受控组件不认直接 `el.value = x`），派发 input + change，focus，
 *    再依次派发 keydown / keypress / keyup 的 Enter。
 *
 * 4. **就绪判据必须限定在「摘要」区内**，区间是 innerText 里 `摘要` 的下标到
 *    `流量趋势` 的下标之间。这里连续踩过三次坑，逐条写下来：
 *      ❌ 不能在整页找数字：页面**底部有别的工具的挂件**（本地可见度差距 / axa.fr /
 *         42 / 758 / 15%）。那是别人的数据，会让判据假阳性——空态页也「有数字」。
 *      ❌ 不能认「访问量」这类关键词：它出现在营销文案「通过访问量、跳出率和参与度
 *         对多个域名进行基准测试」里，空态页上就有。
 *      ❌ 不能认「有图表」：空态落地页本身就有装饰性 svg。
 *      ✅ 只认「摘要区内出现带 K/M/B/万/亿/% 的数字」。
 *
 * 5. 摘要区的真实文本形状（管道符代表换行）：
 *      摘要|摘要|导出|访问量|访问量|7.9亿|↑4.53%|84.26%|15.74%|唯一|唯一|2.1亿|↑2.92%|…
 *    三件必须记住的事：
 *      - **每个标签都重复两次**（可见标签 + a11y 副本）；
 *      - `访问量` 后面跟四个值：`值 | 环比 | 桌面占比 | 移动占比`，其余指标只跟两个；
 *      - `平均访问时长` 是 `mm:ss`，不是数字。
 *    所以解析器**不按位置切**，而是「标签开桶、带箭头的是环比、不带箭头的按顺序是
 *    值和附加占比」——多一个少一个占比都不会让别的字段错位。
 *
 * 6. 页头形如 `未命名列表 | <域名> | 全球 | 2026年7月 | 所有设备`，据此回报
 *    headerTarget / scope / period / devices。这几个是**元信息**，不能当就绪判据用
 *    （空态页上「全球」「所有设备」同样存在）。
 *
 * ──────────────────────────────────────────────────────────────────────
 * 本仓库的硬性规则，本文件逐条遵守
 * ──────────────────────────────────────────────────────────────────────
 *  - 错误文本进输出前一律过 `redactSecrets`（opencli 失败会把带 __gmitm 令牌的
 *    会话 URL 打进 stderr）。有守卫测试 tests/redaction-guard.test.mjs 会扫。
 *  - **解析不出来给 null，绝不给 0。** 0 和 null 在这里含义相反：0 是「实测就是零」。
 *  - **空结果不是事实。** 摘要区拿不到值就输出 `status: 'unavailable'` 并说明原因，
 *    不输出一堆 0/null 假装成功。
 *  - 会话名不写死字面常量（同名会话 = 共用标签页，两个任务会互相读到对方的页面）。
 */
import { defaultSession, parseFlags, printJson, showHelpIfRequested, validateSession } from './opencli-core.mjs';
import { captureStable, expiryWarning, gotoInTool, launchTool, redactSecrets } from './lib-tools-share.mjs';
import { parseNumber } from './lib-similarweb.mjs';
import { writeFile } from 'node:fs/promises';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TRAFFIC_PATH = '/analytics/traffic/traffic-overview/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * **这张报表必须在前台标签页里跑。** 全仓的默认是后台
 * （`lib-tools-share.mjs` 的 `launchTool` 默认 `windowMode = 'background'`），
 * 这里是全仓唯一一处实测确认的例外，具体见
 * SKILL.md 的 <law id="hidden-tabs-do-not-hydrate">。
 *
 * 2026-08-28 控制变量实测：同一个标签页、同一个节点、**不重新提交**，
 * 只翻转 `document.visibilityState`：
 *   hidden  → `document.body.innerText` 长 549，摘要区只有标签、**零个值**
 *   visible → 长 1957，**所有值齐全**
 * 解析层是好的（把前台抓到的 innerText 喂给 parseTrafficSummary，15 个字段
 * 零容差全对）——坏的只是驱动层。
 *
 * 为什么是“默认前台”而不是“后台跑、发现没水合再自动转前台重试”：
 * 自动重试无法把两个真实原因分开——“后台不水合”和“这个域名在 .Trends
 * 里真的没数据”在页面上长得一模一样（都是“有标签无值”），于是每一次真空数据
 * 都要白白多花一轮 40–120 秒的重试，而且前台抢焦点这件事照样会发生，
 * 只是发生得更晚、更难预测。一次就前台，行为确定，错误信息也才能诚实。
 *
 * 仍然可以显式覆盖：`--window background` / `--window isolated`。
 * **不要因为这个去改 `lib-tools-share.mjs` 的公共默认**——semrush-report.mjs 和
 * similarweb-query.mjs 长期在后台模式下正常取数，改公共默认会让它们都去抢前台。
 */
export const DEFAULT_WINDOW = 'foreground';

export function normalizeDomain(value) {
  if (!value) return '';
  const c = value.includes('://') ? new URL(value).hostname : value.split('/')[0];
  return c.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

// ---------- 摘要区的切分与解析 ----------

/** 摘要区的边界字样。`摘要` 是区首，`流量趋势` 是区尾（下一个板块的标题）。 */
const SUMMARY_START = /摘要|Summary/;
const SUMMARY_END = /流量趋势|Traffic Trend/;

/**
 * 从整页 innerText 里切出摘要区。
 *
 * **这是本文件最重要的一个函数**，页面底部挂着别的工具的挂件（见头部注释第 4 条），
 * 整页扫描一定会读到别人的数字。切不出来就返回 null，让调用方判 unavailable——
 * 绝不退化成「那就整页找吧」。
 */
export function sliceSummary(bodyText) {
  const text = String(bodyText || '');
  const startMatch = text.match(SUMMARY_START);
  if (!startMatch) return null;
  const start = startMatch.index;
  const endMatch = text.slice(start).match(SUMMARY_END);
  // 尾界找不到就是**没渲染完**，不是「摘要一直到页尾」——后者会把底部别人的挂件圈进来。
  if (!endMatch) return null;
  return text.slice(start, start + endMatch.index);
}

/** 摘要区里出现了带 K/M/B/万/亿/% 的数字，才算这一屏真的有数据。 */
const SUMMARY_VALUE = /[\d.,]+\s*(?:[KMB]|万|亿|%)/i;

export function summaryHasValues(bodyText) {
  const region = sliceSummary(bodyText);
  return Boolean(region && SUMMARY_VALUE.test(region));
}

/**
 * 指标标签 → 输出字段前缀。英文标签是按大概率补的，**未经实测**；
 * 中文那一列才是 2026-08-28 实测确认过的。
 */
const METRICS = [
  { key: 'visits', labels: ['访问量', 'Visits'] },
  { key: 'unique', labels: ['唯一', '唯一访客', 'Unique Visitors', 'Unique'] },
  { key: 'purchaseConversion', labels: ['购买转化率', 'Purchase Conversion'] },
  { key: 'pagesPerVisit', labels: ['页数/访问', 'Pages / Visit', 'Pages/Visit'] },
  { key: 'avgVisitDuration', labels: ['平均访问时长', 'Avg. Visit Duration'] },
  { key: 'bounceRate', labels: ['跳出率', 'Bounce Rate'] },
];
/** 摘要区里出现、但不是指标的标签。碰到它们要**关掉当前桶**，
 *  否则「导出」后面万一跟点什么就会被算进上一个指标。 */
const NON_METRIC_LABELS = ['摘要', 'Summary', '导出', 'Export'];

const LABEL_TO_KEY = new Map();
for (const m of METRICS) for (const l of m.labels) LABEL_TO_KEY.set(l, m.key);

/** `↑4.53%` / `↓2.55%` / `+4.53%` / `-2.55%`。↓ 必须变负数。 */
const CHANGE = /^([↑↓▲▼+\-−])\s*([\d.,]+)\s*%?$/;
/** 明写的「没有这一项」。命中即当作缺值，不是 0。 */
const NO_VALUE = /^(?:不可用|n\/a|N\/A|—|–|-|--)$/i;

/** 百分数/纯数：去掉 % 再交给 parseNumber（它不认 %，会返回 null）。 */
function numeric(token) {
  const s = String(token ?? '').trim();
  if (!s || NO_VALUE.test(s)) return null;
  return parseNumber(s.replace(/%$/, ''));
}

/** `11:02` → 662；`1:02:03` → 3723。不是这个形状就返回 null，不猜。 */
export function durationToSeconds(text) {
  const s = String(text ?? '').trim();
  if (!/^\d{1,2}(:\d{2}){1,2}$/.test(s)) return null;
  const parts = s.split(':').map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/**
 * 把摘要区文本切成「指标 → { values: [不带箭头的], change: 带箭头的 }」。
 *
 * 规则只有两条，刻意不依赖位置：
 *   1. 认识的标签开一个桶（**标签重复两次**，第二次开桶时前一个还是空的，直接复用）；
 *   2. 桶里带箭头的 token 是环比，不带箭头的按出现顺序进 values。
 * 这样 `访问量` 多出来的两个占比不会把后面的指标顶错位，少了也只是 values 短一截。
 */
export function bucketSummary(regionText) {
  const tokens = String(regionText || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const buckets = new Map();
  let current = null;
  for (const token of tokens) {
    if (NON_METRIC_LABELS.includes(token)) { current = null; continue; }
    const key = LABEL_TO_KEY.get(token);
    if (key) {
      // 标签重复出现：桶还空着就复用（这是页面的 a11y 副本）；
      // 桶里已经有值了说明是别处又提了一次同名标签，**不覆盖已经收到的真值**。
      if (!buckets.has(key) || buckets.get(key).values.length === 0) {
        if (!buckets.has(key)) buckets.set(key, { values: [], change: null });
        current = buckets.get(key);
      } else {
        current = null;
      }
      continue;
    }
    if (!current) continue;                       // 还没进任何指标，忽略
    const change = token.match(CHANGE);
    if (change) { if (current.change === null) current.change = token; continue; }
    if (NO_VALUE.test(token)) { current.values.push(null); continue; }
    current.values.push(token);
  }
  return buckets;
}

/** `↑4.53%` → 4.53；`↓2.55%` → -2.55；认不出来 → null。 */
export function parseChangePercent(token) {
  const m = String(token ?? '').trim().match(CHANGE);
  if (!m) return null;
  const value = parseNumber(m[2]);
  if (value === null) return null;
  return /[↓▼\-−]/.test(m[1]) ? -value : value;
}

/**
 * 摘要区 → 15 个字段。任何一格解析不出来就是 null，**绝不落成 0**。
 * 返回 null 表示「这不是一个有数据的摘要区」，调用方据此判 unavailable。
 */
export function parseTrafficSummary(bodyText) {
  const region = sliceSummary(bodyText);
  if (!region || !SUMMARY_VALUE.test(region)) return null;
  const buckets = bucketSummary(region);
  const at = (key, i = 0) => buckets.get(key)?.values?.[i] ?? null;
  const change = (key) => parseChangePercent(buckets.get(key)?.change);
  const duration = at('avgVisitDuration');
  const durationText = duration && /^\d{1,2}(:\d{2}){1,2}$/.test(String(duration).trim())
    ? String(duration).trim() : null;

  return {
    visits: numeric(at('visits')),
    visitsChangePercent: change('visits'),
    // 「桌面占比 / 移动占比」只有访问量这一格有，且必须是第 2、3 个非箭头值。
    desktopSharePercent: numeric(at('visits', 1)),
    mobileSharePercent: numeric(at('visits', 2)),
    uniqueVisitors: numeric(at('unique')),
    uniqueChangePercent: change('unique'),
    purchaseConversionPercent: numeric(at('purchaseConversion')),
    purchaseConversionChangePercent: change('purchaseConversion'),
    pagesPerVisit: numeric(at('pagesPerVisit')),
    pagesPerVisitChangePercent: change('pagesPerVisit'),
    // 时长保留原文，另给一份秒数；`mm:ss` 不是数字，numeric() 会给 null，别用它。
    avgVisitDuration: durationText,
    avgVisitDurationSeconds: durationToSeconds(durationText),
    avgVisitDurationChangePercent: change('avgVisitDuration'),
    bounceRatePercent: numeric(at('bounceRate')),
    bounceRateChangePercent: change('bounceRate'),
  };
}

/**
 * 页头元信息：`未命名列表 | canva.com | 全球 | 2026年7月 | 所有设备`。
 * 只在**摘要区之前**的那段文本里找，页面底部别的工具的挂件同样带地区/设备字样。
 */
export function parseHeader(bodyText, expected) {
  const text = String(bodyText || '');
  const startMatch = text.match(SUMMARY_START);
  const head = text.slice(0, startMatch ? startMatch.index : Math.min(text.length, 2000));
  const lines = head.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const isHost = (l) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(l);
  const headerTarget = lines.find((l) => (expected ? l.toLowerCase() === expected : isHost(l)))
    || lines.find(isHost) || null;
  const period = lines.find((l) => /^\d{4}年\d{1,2}月$/.test(l) || /^[A-Z][a-z]+ \d{4}$/.test(l)) || null;
  const scope = lines.find((l) => /^(全球|Worldwide|Global)$/.test(l)) || null;
  const devices = lines.find((l) => /^(所有设备|All Devices|桌面|移动)/.test(l)) || null;
  return { headerTarget, period, scope, devices };
}

// ---------- 浏览器侧 ----------

/** 面板/工具页偶发的整页错误文案。站主口述：瞬时的，重载即恢复。 */
const TRANSIENT = /出错了|我们已经发现了问题|请稍后重试|Something went wrong/;

const INPUT_SELECTOR = 'input[aria-label="Input target"]';

/**
 * 等输入框水合出来。**实测至少要 10–14 秒**，所以是轮询不是一次性查询。
 * 一次性查询会稳定地「找不到输入框」，读起来像选择器写错了。
 */
async function waitForInput(evalPage, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const probe = await evalPage(`(() => JSON.stringify({
      present: Boolean(document.querySelector(${JSON.stringify(INPUT_SELECTOR)})),
      transient: ${TRANSIENT.toString()}.test(document.body?.innerText || ''),
    }))()`);
    if (probe?.present) return true;
    if (probe?.transient) {
      await evalPage('(() => { location.reload(); return JSON.stringify({ reload: 1 }); })()');
      await sleep(6000);
    }
    await sleep(2000);
  }
  return false;
}

/**
 * 填域名并回车。React 受控组件不认 `el.value = x`——必须走 prototype 上的原生
 * value setter，再补 input/change 事件，否则框里看着填上了、组件状态还是空的。
 */
async function submitTarget(evalPage, value) {
  return await evalPage(`(() => {
    const el = document.querySelector(${JSON.stringify(INPUT_SELECTOR)});
    if (!el) return JSON.stringify({ ok: false, why: 'input not found' });
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.focus();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
      }));
    }
    return JSON.stringify({ ok: true, value: el.value });
  })()`);
}

/**
 * 轮询到**解析结果稳定**再收下。
 *
 * 就绪判据只是入场券：这些页面先挂标签和占位值，几秒后真值才水合进来。
 * 所以指纹用 `parseTrafficSummary()` 的完整输出——连续两次完全一致才算数，
 * 指纹就是要写出去的那个对象，不存在「盯着 A、写出去 B」的漏洞。
 */
async function loadSummary(evalPage, { timeout, intervalMs }) {
  return await captureStable({
    read: () => evalPage(`(() => { const t = document.body?.innerText || ''; return JSON.stringify({
      url: location.href.split('?')[0], title: document.title,
      transient: ${TRANSIENT.toString()}.test(t),
      bodyText: t.slice(0, 60000),
    }); })()`),
    abortIf: (cap) => Boolean(cap?.transient),
    fingerprint: (cap) => {
      if (!cap?.bodyText || !summaryHasValues(cap.bodyText)) return null;
      const parsed = parseTrafficSummary(cap.bodyText);
      return parsed === null ? null : JSON.stringify(parsed);
    },
    timeoutMs: timeout * 1000,
    intervalMs,
  });
}

// ---------- 离线自测 ----------

export function runSelfTest() {
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push(name);
    if (!ok) throw new Error(`semrush-traffic self-test failed at ${name}${detail ? `: ${detail}` : ''}`);
  };

  // 2026-08-28 canva.com 的真实 innerText，逐字照抄（含每个标签重复两次、
  // 访问量后面四个值、mm:ss 的时长）。**不是按摘要手打的简化版。**
  const realBody = [
    '未命名列表', 'canva.com', '全球', '2026年7月', '所有设备',
    '摘要', '摘要', '导出',
    '访问量', '访问量', '7.9亿', '↑4.53%', '84.26%', '15.74%',
    '唯一', '唯一', '2.1亿', '↑2.92%',
    '购买转化率', '购买转化率', '0.21%', '↑27.93%',
    '页数/访问', '页数/访问', '5.4', '↓2.55%',
    '平均访问时长', '平均访问时长', '11:02', '↑7.99%',
    '跳出率', '跳出率', '30.23%', '↑1.72%',
    '流量趋势',
    // 页面底部**别的工具的挂件**——整页扫描就会读到这些别人的数字。
    '本地可见度差距', 'axa.fr', '42', '758', '15%',
  ].join('\n');

  const parsed = parseTrafficSummary(realBody);
  const expected = {
    visits: 790000000, visitsChangePercent: 4.53,
    desktopSharePercent: 84.26, mobileSharePercent: 15.74,
    uniqueVisitors: 210000000, uniqueChangePercent: 2.92,
    purchaseConversionPercent: 0.21, purchaseConversionChangePercent: 27.93,
    pagesPerVisit: 5.4, pagesPerVisitChangePercent: -2.55,
    avgVisitDuration: '11:02', avgVisitDurationSeconds: 662, avgVisitDurationChangePercent: 7.99,
    bounceRatePercent: 30.23, bounceRateChangePercent: 1.72,
  };
  check('real-summary-15-fields', JSON.stringify(parsed) === JSON.stringify(expected),
    JSON.stringify({ parsed, expected }));
  check('field-count-is-15', Object.keys(parsed).length === 15, String(Object.keys(parsed).length));

  // ↓ 必须变负数，↑ 必须是正数——符号搞反了，读者会把跌当成涨。
  check('down-arrow-is-negative',
    parseChangePercent('↓2.55%') === -2.55 && parseChangePercent('↑7.99%') === 7.99
    && parseChangePercent('▼1.2%') === -1.2 && parseChangePercent('-3%') === -3
    && parseChangePercent('乱七八糟') === null);

  // 底部别人的挂件不能进摘要区——这是本文件踩过的第一个坑。
  check('summary-excludes-foreign-widget',
    !sliceSummary(realBody).includes('axa.fr') && !sliceSummary(realBody).includes('758'));

  // 摘要区缺失 → unavailable，不是一堆 0。
  const emptyState = [
    'Traffic Analytics', '通过访问量、跳出率和参与度对多个域名进行基准测试',
    '开始使用', '本地可见度差距', 'axa.fr', '42', '758', '15%',
  ].join('\n');
  check('empty-state-is-unavailable',
    parseTrafficSummary(emptyState) === null && summaryHasValues(emptyState) === false);
  // 「访问量」出现在营销文案里、页面底部也有数字——两者加起来都不许构成就绪。
  check('marketing-copy-is-not-ready', !/摘要/.test(emptyState) && !summaryHasValues(emptyState));
  // 摘要标题出现了但还没水合完（没有 `流量趋势` 尾界）：同样是 unavailable，
  // **不能退化成「摘要一直到页尾」**，那会把底部挂件圈进来。
  const halfRendered = ['摘要', '摘要', '导出', '访问量', '访问量', '本地可见度差距', 'axa.fr', '42'].join('\n');
  check('missing-end-boundary-is-unavailable', parseTrafficSummary(halfRendered) === null);

  // 标签在、值缺失 → null，绝不是 0。0 的含义是「实测就是零」，两者相反。
  const labelsNoValues = [
    '摘要', '摘要', '导出',
    '访问量', '访问量', '7.9亿', '↑4.53%',          // 只有值和环比，没有两个占比
    '唯一', '唯一', '不可用',                        // 明写的「不可用」
    '购买转化率', '购买转化率',                       // 标签在，什么都没有
    '页数/访问', '页数/访问', '—', '↓2.55%',         // 破折号占位
    '平均访问时长', '平均访问时长', '↑7.99%',         // 只有环比
    '跳出率', '跳出率', '30.23%',                    // 只有值
    '流量趋势',
  ].join('\n');
  const sparse = parseTrafficSummary(labelsNoValues);
  check('missing-values-are-null-not-zero',
    sparse.visits === 790000000 && sparse.visitsChangePercent === 4.53
    && sparse.desktopSharePercent === null && sparse.mobileSharePercent === null
    && sparse.uniqueVisitors === null && sparse.uniqueChangePercent === null
    && sparse.purchaseConversionPercent === null && sparse.purchaseConversionChangePercent === null
    && sparse.pagesPerVisit === null && sparse.pagesPerVisitChangePercent === -2.55
    && sparse.avgVisitDuration === null && sparse.avgVisitDurationSeconds === null
    && sparse.avgVisitDurationChangePercent === 7.99
    && sparse.bounceRatePercent === 30.23 && sparse.bounceRateChangePercent === null,
    JSON.stringify(sparse));
  check('no-zero-substituted-for-missing',
    Object.values(sparse).every((v) => v !== 0), JSON.stringify(sparse));

  // 中文缩写换算：万=1e4、亿=1e8，K/M/B 也要认。
  check('cjk-and-latin-magnitudes',
    numeric('1.6万') === 16000 && numeric('7.9亿') === 790000000
    && numeric('23.8K') === 23800 && numeric('1.1M') === 1100000 && numeric('2B') === 2000000000
    && numeric('不可用') === null && numeric('—') === null);

  // mm:ss / h:mm:ss，认不出来给 null（不要把 11:02 当成 11.02 这种数）。
  check('duration-seconds',
    durationToSeconds('11:02') === 662 && durationToSeconds('1:02:03') === 3723
    && durationToSeconds('5.4') === null && durationToSeconds('') === null);

  // 页头元信息只在摘要区之前找，别把底部挂件的 axa.fr 当成本次主体。
  const header = parseHeader(realBody, 'canva.com');
  check('header-metadata',
    header.headerTarget === 'canva.com' && header.period === '2026年7月'
    && header.scope === '全球' && header.devices === '所有设备',
    JSON.stringify(header));

  // 错误文本必须过 redactSecrets 才能进输出——这是仓库红线，在这里也验一遍。
  const redacted = redactSecrets('open https://sem.example/app?__gmitm=SECRET123 failed');
  check('errors-are-redacted', !redacted.includes('SECRET123') && redacted.includes('__gmitm=<redacted>'));

  console.log(`semrush-traffic self-test: PASS (${checks.length} checks: ${checks.join(', ')})`);
}

// ---------- 主流程 ----------

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  showHelpIfRequested(flags, import.meta.url);
  if (flags['self-test']) { runSelfTest(); return; }

  const session = flags.session ? validateSession(flags.session) : defaultSession('semrush-traffic');
  const domain = normalizeDomain(String(flags.domain || '').trim());
  if (!domain) {
    console.error('semrush-traffic.mjs requires --domain (例如 --domain canva.com)');
    process.exit(2);
  }

  let output;
  let launched;
  try {
    launched = await launchTool({
      session,
      tool: 'semrush',
      node: flags.node,
      // 见本文件顶部 DEFAULT_WINDOW 的注释：这张报表在后台标签页里不水合。
      window: flags.window || DEFAULT_WINDOW,
      wait: Number(flags.wait || 7),
      timeout: Number(flags.launchTimeout || 60),
    });
    const { evalPage } = launched;
    // `landed` 是 `{ url, title, bodyText }` 对象，不是字符串——直接 new URL(landed) 会抛。
    const origin = new URL(launched.landed?.url || launched.tool.origin.replace(/^/, 'https://')).origin;

    // 导航一律走 gotoInTool（在已登录的工具页内部跳转）。**不能用 `opencli open` 打深链**——
    // 那会开一个没有登录态的新标签页。
    await gotoInTool(evalPage, `${origin}${TRAFFIC_PATH}`, Number(flags.settle || 8));

    const inputTimeout = Number(flags['input-timeout'] || 40);
    if (!(await waitForInput(evalPage, inputTimeout))) {
      throw new Error(
        `流量分析总览页在 ${inputTimeout}s 内没有出现主体输入框（${INPUT_SELECTOR}）。` +
        `依次排查：(1) 节点挂了——换 --node 重跑（症状是白页、长时间不渲染）；` +
        `(2) 路由被改了——本脚本用的是 ${TRAFFIC_PATH}，不是 /analytics/traffic/overview/；` +
        `(3) 这个输入框实测水合要 10–14 秒，网络慢时调大 --input-timeout。`,
      );
    }
    const submitted = await submitTarget(evalPage, domain);
    if (!submitted?.ok) throw new Error(`提交主体失败：${submitted?.why || 'unknown'}`);

    const loaded = await loadSummary(evalPage, {
      timeout: Number(flags.timeout || 120),
      intervalMs: Number(flags['stable-interval'] || 3) * 1000,
    });

    if (!loaded.stable || !loaded.capture) {
      // **空结果不是事实。** 这里绝不输出一堆 0/null 假装成功。
      throw new Error(
        loaded.aborted
          ? `页面停在瞬时错误页（出错了/请稍后重试）。重载重试仍未恢复，稍后再跑。`
          : `"${domain}" 的摘要区在 ${loaded.reads} 次读取里始终没出现稳定数值。` +
            `依次排查：(1) 提交没生效，页面还停在空态落地页；` +
            `(2) 该域名在 .Trends 里流量太小、没有数据；` +
            `(3) 还在水合——调大 --timeout / --stable-interval。` +
            `注意：这**不等于**「这个站没有流量」。`,
      );
    }

    const cap = loaded.capture;
    const parsed = JSON.parse(loaded.fingerprint);
    const header = parseHeader(cap.bodyText, domain);
    // 页头主体和请求主体对不上 = 读的是别人的数据，必须说出来而不是照单写下。
    if (header.headerTarget && header.headerTarget.toLowerCase() !== domain) {
      console.error(`[target-mismatch] 请求的是 ${domain}，页头显示的是 ${header.headerTarget}——提交可能没生效。`);
    }

    output = {
      version: 1,
      source: 'Semrush Traffic & Market (.Trends) via authenticated Tools Share browser session',
      // 口径必须写清楚：这是**总访问量**，和 semrush-report.mjs 的自然搜索流量不是一回事。
      note: '这是 Semrush .Trends 的总访问量口径（与 Similarweb 同口径，2026-08-28 实测相差 2.4%），'
          + '不是 semrush-report.mjs / semrush-overview.mjs 的自然搜索流量，两者不要混用或相加。',
      retrievedAt: new Date().toISOString(),
      report: 'traffic-overview',
      target: domain,
      session,
      sessionReused: Boolean(launched.reused),
      title: cap.title,
      url: cap.url,
      header,
      subscription: launched.reused ? null : {
        expiry: launched.state?.expiry, daysLeft: launched.state?.daysLeft,
        quotas: launched.state?.quotas, warning: expiryWarning(launched.state || {}),
      },
      reads: loaded.reads,
      parsed,
      rawSummary: sliceSummary(cap.bodyText),
      rawText: cap.bodyText.slice(0, 20000),
    };
  } catch (error) {
    output = {
      version: 1,
      source: 'Semrush Traffic & Market (.Trends) via authenticated Tools Share browser session',
      retrievedAt: new Date().toISOString(),
      report: 'traffic-overview',
      target: domain,
      session,
      // **错误消息必须过 redactSecrets。** opencli 失败会把带 __gmitm 令牌的会话 URL
      // 打进 stderr，那段文本会一路进 output、进 --out 文件、进日志。
      status: 'unavailable',
      error: { code: 'traffic_overview_unavailable', message: redactSecrets(error.message) },
    };
  } finally {
    await launched?.releaseBrowserLocks?.();
  }

  if (typeof flags.out === 'string') await writeFile(flags.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  // --json 只影响 stderr 上那行人读摘要；stdout 永远是 JSON，管道下游不会因为这个 flag 变形。
  if (!flags.json && output.status !== 'unavailable') {
    const p = output.parsed;
    console.error(
      `[${output.target}] visits=${p.visits} (${p.visitsChangePercent}%) unique=${p.uniqueVisitors} ` +
      `pages/visit=${p.pagesPerVisit} duration=${p.avgVisitDuration} bounce=${p.bounceRatePercent}%`,
    );
  }
  printJson(output);
  if (output.status === 'unavailable') process.exitCode = 1;
}

// **导入这个模块不许启动 CLI。** 解析函数是可单测的纯函数，验证方要能
// `import { parseTrafficSummary }` 而不意外开一个浏览器会话——2026-08-28 就真的
// 因为没有这道守卫开了一个。写法照抄同目录的 tools-share-evidence.mjs。
const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) main().catch((error) => { console.error(redactSecrets(error?.message || String(error))); process.exitCode = 1; });
