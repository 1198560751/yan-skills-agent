#!/usr/bin/env node
/**
 * semrush-report.mjs — 读 Semrush 里**没有导出按钮**的那几张报告。
 *
 * 为什么在 semrush-overview.mjs 之外还要这一个：overview 只覆盖「域名概览」一张页。
 * 竞品勘测真正要的是另外四张——自然排名、主要页面、反链概览、关键词概览——
 * 它们同样没有表格导出，只能读页面。2026-08-21 那轮勘测因为缺这个脚本，
 * 在 scratchpad 里现写了个一次性的 `sem.mjs` 加三个 shell 循环，用完就扔了。
 * **本脚本就是把那次的行为沉淀下来**，别再写第二个。
 *
 * 与 semrush-overview.mjs 的关系：那个是本脚本 `--report domain-overview` 的
 * 特化版，输出字段更规整。域名那六个数字用它，其余四张用这个。
 *
 * 用法：
 *   node semrush-report.mjs --report organic-overview  --domain example.com --db us
 *   node semrush-report.mjs --report organic-positions --domain example.com --db us
 *   node semrush-report.mjs --report organic-pages     --domain example.com --db us
 *   node semrush-report.mjs --report backlinks-overview --domain example.com
 *
 * **关键词维度不在这里**：`semrush-keyword.mjs` 已经覆盖关键词概览，且它的取值函数
 * 比本文件早一步处理了「不可用」短路。2026-08-21 我在这里重复实现了一遍 keyword 报告，
 * 属于本 Skill 明令禁止的「写第二个」——已删除，词维度一律走 semrush-keyword.mjs。
 *
 * 一次装一堆（**这是省配额的关键**，见下面「会话复用」）：
 *   S=semrush-recon-$$
 *   node semrush-report.mjs --session $S --report backlinks-overview --domain a.com
 *   node semrush-report.mjs --session $S --report backlinks-overview --domain b.com
 *   ...
 *   opencli browser $S close
 */
import { defaultSession, opencli, firstJson, parseFlags, printJson, validateSession } from './opencli-core.mjs';
import { expiryWarning, launchTool } from './lib-tools-share.mjs';
import { writeFile } from 'node:fs/promises';

const flags = parseFlags(process.argv.slice(2));
const session = flags.session ? validateSession(flags.session) : defaultSession('semrush-report');
const APP_ORIGIN = (process.env.TOOLS_SHARE_APP_ORIGIN_SEMRUSH || 'https://sem.3ue.co').replace(/\/+$/, '');
const APP_HOST = new URL(APP_ORIGIN).host;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 同一个关键词可以合法地出现在多个落地页上，去重键必须带 URL 与排名，
 *  只用关键词会把 100 行压成 67 行——实测踩过。 */
const rowKey = (r) => `${r.keyword}||${r.url || ''}||${r.position ?? ''}`;
const escapeRe = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 每张报告的路由、就绪判据、以及解析方式。
 *
 * `ready` 必须认**只有数据渲染完才会出现**的字样。认页面标题或左侧菜单会在
 * 骨架阶段就通过，拿到一个空壳——similarweb-query.mjs 已经为这个坑付过一次学费。
 */
const REPORTS = {
  'organic-overview': {
    needs: 'domain',
    path: (t, db) => `/analytics/organic/overview/?searchType=domain&q=${encodeURIComponent(t)}${db ? `&db=${db}` : ''}`,
    // ⚠️ 第三次踩「认标签导致抓到空壳」这个坑（2026-08-21）。
    // 初版写的是 /流量成本|Traffic Cost/ —— 那是指标块的标签，SPA 骨架阶段就已经在了，
    // 而此时页面顶部的主体名还是空的、所有数值都没渲染。结果六个域名连跑六次，
    // organicTraffic / organicKeywords / trafficCost 全返回 null 且不报错，
    // 读起来像「这些站没有自然流量」，实际是「一个字都还没渲染出来」——错得正好相反。
    // 判据改为：主体名必须出现在页面上，且「流量成本」后面真的跟着一个数值。
    ready: (t, target) => new RegExp(escapeRe(target)).test(t)
      && /(?:流量成本|Traffic Cost)\s*\n\s*(?:US\$|[$¥€£]|[\d.,])/.test(t),
    parse: parseOrganicOverview,
  },
  'organic-positions': {
    needs: 'domain',
    path: (t, db) => `/analytics/organic/positions/?searchType=domain&q=${encodeURIComponent(t)}${db ? `&db=${db}` : ''}` +
      `&sortField=Po&sortDirection=ascending`,
    // ⚠️ 就绪判据必须认**数据行**，不能认表头。
    // 初版写的是 /上次更改/ —— 那是 URL 列右边的表头文字，表体还没渲染就已经在了，
    // 结果每次都在空表上解析，稳定返回 0 行且不报错。这与 similarweb-query.mjs
    // 记过的「认左侧菜单项导致抓到空壳」是同一个坑，第二次踩了。
    ready: (t, target) => new RegExp(`${escapeRe(target)}/`).test(t) || /未找到结果|No results|没有数据/.test(t),
    parse: parsePositions,
    paginated: true,
  },
  'organic-pages': {
    needs: 'domain',
    path: (t, db) => `/analytics/organic/pages/?searchType=domain&q=${encodeURIComponent(t)}${db ? `&db=${db}` : ''}`,
    ready: (t, target) => new RegExp(`${escapeRe(target)}/`).test(t) || /未找到结果|No results|没有数据/.test(t),
    parse: parsePages,
    paginated: true,
  },
  'backlinks-list': {
    needs: 'domain',
    // 反链明细。**这是回答「我们的链都是什么性质」的唯一报告**——概览只给总数，
    // 看不出 follow/nofollow、锚文本、来源页类型。
    path: (t) => `/analytics/backlinks/backlinks/?q=${encodeURIComponent(t)}&searchType=domain`,
    // ⚠️ 第三次踩同一个坑，写死在这里：**「锚链接」是标签页名，「nofollow」是筛选器 chip，
    // 两者在表体渲染之前就已经在页面上**。认它们等于在空表上解析，稳定返回 0 行且不报错。
    // 就绪判据只能认**数据行**：表体里的源页面 URL（http 开头且不是本站自己）。
    ready: (t) => /\n\s*https?:\/\/[^\n]+\n/.test(t.split('Sortable').slice(1).join('\n'))
      || /未找到|No backlinks|没有数据/.test(t),
    parse: parseBacklinksList,
  },
  /**
   * 关键词概览。**这是本脚本唯一一张以「词」为主体的报告**，其余全是域名维度。
   * 加它的原因：KD 类免费工具只给难度分，不给搜索量；而「这个词到底有没有人搜」
   * 是选题阶段唯一要紧的问题，只有这里答得了。
   *
   * 就绪判据认「关键词摘要」这个块标题 + 搜索量后面**真的跟着一个数**。
   * 只认标签会在骨架阶段通过——那正是 similarweb-query.mjs 和 organic-positions
   * 各栽过一次的坑，这里不再栽第三次。
   */
  'keyword-overview': {
    needs: 'keyword',
    path: (t, db) => `/analytics/keywordoverview/?q=${encodeURIComponent(t)}${db ? `&db=${db}` : ''}`,
    ready: (t) => /关键词摘要|Keyword overview/.test(t)
      && /(?:搜索量|Volume)\s*\n\s*(?:[\d.,]+\s*(?:[KMB]|万)?|n\/a|—|-)/i.test(t),
    parse: parseKeywordOverview,
  },
  'backlinks-overview': {
    needs: 'domain',
    path: (t) => `/analytics/backlinks/overview/?q=${encodeURIComponent(t)}&searchType=domain`,
    ready: /Authority Score|权威分数/,
    parse: parseBacklinks,
  },
};

const name = String(flags.report || '').trim();
const spec = REPORTS[name];
if (!spec) {
  console.error(`--report must be one of: ${Object.keys(REPORTS).join(', ')}`);
  process.exit(2);
}
// 关键词主体绝不能过 normalizeDomain——它会把空格后的部分当路径切掉，
// 于是 "car wrap visualizer" 变成 "car"，查出来的是另一个词的数据且不报错。
const target = spec.needs === 'keyword'
  ? String(flags.keyword || '').trim()
  : normalizeDomain(String(flags.domain || '').trim());
if (!target) {
  console.error(`--report ${name} requires --${spec.needs}`);
  process.exit(2);
}
const db = String(flags.db || '').trim().toLowerCase();

function normalizeDomain(value) {
  if (!value) return '';
  const c = value.includes('://') ? new URL(value).hostname : value.split('/')[0];
  return c.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

/** 「23.8K」「1.6万」这类缩写在这些页面到处都是。中文页会用「万」。 */
function parseCompact(v) {
  const s = String(v ?? '').replace(/,/g, '').trim();
  let m = s.match(/^([\d.]+)\s*万$/);
  if (m) return Math.round(Number(m[1]) * 1e4);
  m = s.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(Number(m[1]) * mult);
}

const NUM = /^[\d.,]+\s*(?:[KMB]|万)?$/i;

/** 0 是合法值，不是「没数据」。别用 `Number(x) || null`。 */
const toNum = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * 页面上出现的所有指标标签。`pick` 用它当**扫描边界**。
 *
 * 两个 bug 逼出来的（2026-08-21 首跑实测，两个都返回了「看着合理、其实是隔壁字段」的值）：
 *   1. 顶部导航里也有「反向链接」这个词，findIndex 命中的是导航项，
 *      它后面六行全是别的菜单项，于是返回 null——**漏报**。
 *   2. 某次「自然流量」的值没渲染出来，向后扫描一路穿过标签边界，
 *      把下一个指标「出站域名」的 4 抓走当成自然流量——**错报，且看不出来**。
 * 错报比漏报危险得多，所以宁可返回 null。
 */
const LABELS = [
  '引荐域名', '反向链接', '每月访问量', '自然流量', '付费流量', '出站域名',
  '总体有害性分数', 'Authority Score', '关键词', '流量', '流量成本',
  '搜索量', '关键词难度', '全球搜索量', 'CPC', '竞争激烈程度', '意图',   // 词维度标签保留：概览页也会出现
];

/**
 * 标签一行、数值在后面几行里，中间常插变化率（+35%）和评级词（还行/困难）。
 * 所以往后找第一个像数值的——但**碰到下一个标签就停**，并且**所有同名位置都试**
 * （导航里的同名词排在前面，指标块里的那个才带数值）。
 */
function pick(lines, label, pattern, span = 6) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== label) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 1 + span); j++) {
      if (LABELS.includes(lines[j])) break;          // 越界即停，不许穿到下一个指标
      if (pattern.test(lines[j])) return lines[j];
    }
  }
  return null;
}

/**
 * eval 返回裸字符串时没有 JSON 信封，firstJson 会抛。
 * 这个坑让 2026-08-21 那轮的第一次运行直接崩在第一步。**所有 eval 都要包 JSON.stringify**，
 * 但仍然兜一层，免得下次又栽。
 */
async function evalPage(js) {
  const r = await opencli(['browser', session, '--window', 'background', 'eval', js]);
  try {
    const j = firstJson(r.stdout);
    return typeof j === 'string' ? JSON.parse(j) : j;
  } catch {
    return { __raw: String(r.stdout || '').trim() };
  }
}

/**
 * 会话复用：会话已经停在工具 origin 上就不再走面板启动。
 *
 * 这是这个脚本最值钱的一行。面板启动一次约 20–40 秒并消耗一次登录，
 * 而报告本身只要十几秒。一轮竞品勘测要读十几张报告，
 * 每张都重新启动等于把时间和配额乘以十几倍。
 */
async function ensureTool() {
  const cur = await evalPage(`(() => JSON.stringify({ host: location.host }))()`);
  if (cur && cur.host === APP_HOST) {
    return { reused: true, state: { expiry: null, daysLeft: null, quotas: null } };
  }
  const launched = await launchTool({
    session,
    tool: 'semrush',
    node: flags.node,
    window: flags.window,
    wait: Number(flags.wait || 7),
    timeout: Number(flags.launchTimeout || 60),
  });
  return { reused: false, state: launched.state };
}

/** 面板/工具页偶发的整页错误文案。站主口述：这是瞬时的，重载即恢复。 */
const TRANSIENT = /出错了|我们已经发现了问题|请稍后重试|Something went wrong/;

/**
 * 导航 + 轮询就绪。撞上瞬时错误页就重载重试，**不要去换节点或改选择器**——
 * 节点挂掉的样子是白页/长时间不渲染，这个是有明确错误文案的错误页，两回事。
 */
async function loadReport(url, ready, { settle = 10, timeout = 120, retries = 3 } = {}) {
  // ready 可以是正则（页面级字样）或函数 (bodyText, target) => boolean（需要认数据行时）。
  const isReady = typeof ready === 'function' ? ready : (t) => ready.test(t);
  for (let attempt = 1; attempt <= retries; attempt++) {
    await evalPage(`(() => { location.href = ${JSON.stringify(url)}; return JSON.stringify({ nav: 1 }); })()`);
    await sleep(settle * 1000);
    const deadline = Date.now() + timeout * 1000;
    let transient = false;
    while (Date.now() < deadline) {
      const cap = await evalPage(`(() => { const t = document.body?.innerText || ''; return JSON.stringify({
        url: location.href.split('?')[0], title: document.title,
        transient: ${TRANSIENT.toString()}.test(t),
        bodyText: t.slice(0, 60000),
      }); })()`);
      if (cap?.transient) { transient = true; break; }
      if (cap && isReady(cap.bodyText, target)) return cap;
      await sleep(3000);
    }
    if (transient) {
      // 重载，不是换节点。见 authorized-data-sources.md「瞬时错误页」。
      await evalPage(`(() => { location.reload(); return JSON.stringify({ reload: 1 }); })()`);
      await sleep(6000);
      continue;
    }
    if (attempt === retries) break;
  }
  return null;
}

// ---------- 解析器 ----------

function parseOrganicOverview(lines) {
  return {
    organicKeywords: parseCompact(pick(lines, '关键词', NUM)),
    organicTraffic: parseCompact(pick(lines, '流量', NUM)),
    trafficCost: pick(lines, '流量成本', /^US\$|^\$/),
  };
}

function parseBacklinks(lines) {
  return {
    referringDomains: parseCompact(pick(lines, '引荐域名', NUM)),
    backlinks: parseCompact(pick(lines, '反向链接', NUM)),
    monthlyVisits: parseCompact(pick(lines, '每月访问量', NUM)),
    organicTraffic: parseCompact(pick(lines, '自然流量', NUM)),
    // 不能写 `Number(x) || null`：**AS 为 0 是有意义的实测值**（本站 2026-08-21 就是 0），
    // 而 0 是 falsy，会被这个写法悄悄变成「没数据」。null 和 0 在这里含义相反。
    authorityScore: toNum(pick(lines, 'Authority Score', /^\d+$/)),
    // 这一句是实测出来的强信号：全站一条 follow 反链都没有时，Semrush 直接这么写。
    // 它比 AS=0 更明确——AS 0 也可能只是数据太新。
    noFollowBacklinks: lines.some((l) => /找不到\s*Follow\s*反向链接|No follow backlinks/i.test(l)),
  };
}

/**
 * 排名表与页面表：**启发式行扫**，不是可靠解析。
 *
 * 这两张表是虚拟滚动、非 <table>，页面只渲染前 10 行（脚注写着「10/15」）。
 * 想要全量必须走导出，而导出计入配额。所以这里只做「看得见的那几行」，
 * 并且**始终把 rawText 一起返回**——解析对不上时，人得能看原文，
 * 而不是拿到一个安静地少了一半的数组。
 */
function parseRows(lines, fieldCount) {
  // 不拿表头（Sortable）当起点——表头在没有数据时也在。直接扫 URL 单元格，
  // 把它前面 fieldCount 行当作该行的其余字段带出。
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^https?:\/\//i.test(lines[i]) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(lines[i])) {
      rows.push({ url: lines[i], fields: lines.slice(Math.max(0, i - fieldCount), i) });
    }
  }
  return rows;
}

/**
 * 自然排名表：**从 URL 往左数**，不要从左往右按固定宽度切。
 *
 * 列顺序是 关键词 / 意图 / 排名 / SF / 流量 / 流量% / 搜索量 / KD% / URL / 上次更改。
 * 「意图」这一列**可能是一个字母也可能是两个**（`C` 或 `C` `I` 两行），
 * 从左往右按固定宽度切会在有两个意图的行上整体错位一格，而且看不出来——
 * 2026-08-21 首版就是这样，第一行对、后面每行都把上一行的日期当成了关键词。
 *
 * URL 左边紧邻的六列全是数值且顺序固定，所以倒着数是稳的：
 *   KD% ← 搜索量 ← 流量% ← 流量 ← SF ← 排名
 * 再往左剩下的就是「关键词 + 若干意图字母」，意图字母是单个大写字母，剔掉即得关键词。
 */
// The URL-line matcher deliberately does NOT require a character after the
// trailing slash. It used to (`\/\S`), and that silently dropped every row
// whose ranking page is the bare root — `snapgen.ai/` with nothing after it.
// Measured 2026-08-21 on a live leaderboard cohort: snapgen.ai lost 90 of 91
// rows and logomotion.design lost 18 of 20, both reported as `rows: []`-ish
// with no error, and a tester wrote up "this domain ranks for almost nothing"
// on the strength of it. A young SaaS site ranking entirely on `/` is the
// median case here, not an edge case, so the slash ends the requirement.
/**
 * 表格报告每页 100 行，**超出部分不会有任何提示**——`parsed.rows` 就是 100，
 * 看起来像一个完整结果。2026-08-21 实测一个 104 词的域名被静默截成 100。
 *
 * 翻页**不是 URL 驱动的**：`&page=2` / `&pageNumber=2` / `&offset=100` 三种写法
 * 都试过，页码指示器纹丝不动停在 1。这与本 Skill 既有的「分页多半是 URL 驱动，
 * 确认后可直接拼 URL」相反——**这里是反例，只能点「下一页」**。
 */
function readPageInfo(bodyText) {
  const m = bodyText.match(/页码：\s*\n?\s*(\d+)?[\s\S]{0,6}?\/\s*\n?\s*(\d+)/);
  const cur = bodyText.match(/页码：\s*(\d+)\s*$/m);
  return { current: cur ? Number(cur[1]) : (m && m[1] ? Number(m[1]) : 1), total: m ? Number(m[2]) : 1 };
}

/** 点「下一页」，等页码真的变了再返回。页码没变就是到头了。 */
async function clickNextPage(evalPage, before) {
  const clicked = await evalPage(`(() => {
    const el = [...document.querySelectorAll('button,a,[role="button"]')]
      .find((b) => /^(下一页|Next)$/.test((b.innerText || '').trim()) && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
    if (!el) return JSON.stringify({ ok: false, why: 'no enabled next control' });
    el.click();
    return JSON.stringify({ ok: true });
  })()`);
  if (!clicked.ok) return false;
  for (let i = 0; i < 12; i++) {
    await sleep(1500);
    const now = await evalPage('(() => JSON.stringify({ t: document.body?.innerText || "" }))()');
    if (readPageInfo(now.t).current > before) return true;
  }
  return false;
}

function parsePositions(lines) {
  const NUMISH = /^(<\s*)?[\d.,]+\s*(?:[KMB]|万)?$|^< ?0\.01$/i;
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(lines[i]) && !/^https?:\/\//i.test(lines[i])) continue;
    const left = lines.slice(Math.max(0, i - 12), i);
    // 从右往左取六个数值格；中间遇到非数值就放弃这一行（结构与预期不符，宁可不报）
    const nums = [];
    let j = left.length - 1;
    while (j >= 0 && nums.length < 6) {
      if (!NUMISH.test(left[j])) break;
      nums.unshift(left[j]); j--;
    }
    if (nums.length < 6) continue;
    const head = left.slice(0, j + 1).filter((x) => !/^\d+月\d+日$|^\d+ ?(小时|天|个月)$|^[A-Z]$/.test(x));
    rows.push({
      keyword: head[head.length - 1] ?? null,
      position: Number(nums[0]), serpFeatures: Number(nums[1]),
      traffic: Number(nums[2]), trafficPercent: nums[3],
      volume: parseCompact(nums[4]), kd: Number(nums[5]),
      url: lines[i],
    });
  }
  return { rows, note: '按「URL 左邻六列必为数值」倒推；结构不符的行被丢弃而不是猜测，因此行数可能少于页面显示。' };
}

/**
 * 关键词概览页的解析。页面很短（实测 innerText 不到 1000 字符），
 * 结构是「标签一行、值在下一行」，中间会插评级词（非常容易/困难）。
 *
 * 分国家那块是 `US / 美国 / 260` 三行一组，**国家代码是两个大写字母**，
 * 靠这个切组，不靠出现顺序——顺序会随各国量级变化。
 */
function parseKeywordOverview(lines) {
  const volume = pick(lines, '搜索量', NUM) ?? pick(lines, 'Volume', NUM);
  const kdRaw = pick(lines, '关键词难度', /^\d+(?:\.\d+)?%$/)
    ?? pick(lines, 'Keyword Difficulty', /^\d+(?:\.\d+)?%$/);
  const globalVolume = pick(lines, '全球搜索量', NUM) ?? pick(lines, 'Global Volume', NUM);
  const cpc = pick(lines, 'CPC', /^[$¥€£]/);
  const intent = pick(lines, '意图', /^(信息|导航|商业|交易|Informational|Navigational|Commercial|Transactional)$/);

  // KD 的评级词紧跟在百分数后面
  let kdLabel = null;
  const kdIdx = kdRaw ? lines.indexOf(kdRaw) : -1;
  if (kdIdx >= 0 && lines[kdIdx + 1] && !LABELS.includes(lines[kdIdx + 1])
      && !NUM.test(lines[kdIdx + 1])) kdLabel = lines[kdIdx + 1];

  const byCountry = [];
  const gi = lines.indexOf('全球搜索量');
  if (gi >= 0) {
    for (let i = gi + 1; i < lines.length; i++) {
      if (LABELS.includes(lines[i])) break;
      if (/^[A-Z]{2}$/.test(lines[i]) && lines[i + 2] && NUM.test(lines[i + 2])) {
        byCountry.push({ code: lines[i], name: lines[i + 1], volume: parseCompact(lines[i + 2]) });
        i += 2;
      } else if (lines[i] === '其他' && NUM.test(lines[i + 1] || '')) {
        byCountry.push({ code: 'OTHER', name: '其他', volume: parseCompact(lines[i + 1]) });
        i += 1;
      }
    }
  }

  return {
    volume: volume === null ? null : parseCompact(volume),
    kd: kdRaw ? Number(String(kdRaw).replace('%', '')) : null,
    kdLabel,
    globalVolume: globalVolume === null ? null : parseCompact(globalVolume),
    cpc: cpc || null,
    intent: intent || null,
    byCountry,
    note: 'volume 是该 db 国家的月搜索量，globalVolume 是全球合计；两者不可混用。'
      + 'volume 为 null 表示页面上没读到数值，不等于该词搜索量为 0。',
  };
}

function parsePages(lines) { return { rowsVisible: parseRows(lines, 8) }; }

/**
 * 反链明细表。每行大致是：源页面标题 / 源 URL / 锚文本 / 目标 URL / 属性标签…
 * 属性标签在 Semrush 中文界面里是「nofollow」「sponsored」「ugc」等字样，
 * **没有标签就意味着 follow**——不要去找一个写着「follow」的单元格，没有那个东西。
 */
function parseBacklinksList(lines) {
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^https?:\/\//i.test(lines[i])) continue;
    const win = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 6));
    const rel = [];
    for (const w of win) {
      const m = String(w).toLowerCase();
      if (/\bnofollow\b/.test(m)) rel.push('nofollow');
      if (/\bsponsored\b/.test(m)) rel.push('sponsored');
      if (/\bugc\b/.test(m)) rel.push('ugc');
    }
    let host = null;
    try { host = new URL(lines[i]).host.replace(/^www\./, ''); } catch { /* 非法 URL */ }
    if (!host) continue;
    rows.push({ sourceUrl: lines[i], sourceHost: host, relObserved: [...new Set(rel)] });
  }
  // 按来源域名去重，同域多条只留一条并合并 rel
  const byHost = new Map();
  for (const r of rows) {
    const cur = byHost.get(r.sourceHost);
    if (cur) cur.relObserved = [...new Set([...cur.relObserved, ...r.relObserved])];
    else byHost.set(r.sourceHost, { ...r, });
  }
  return {
    rowsVisible: rows.length,
    byHost: [...byHost.values()],
    note: 'rel 是从行邻域的标签文字读出来的；「没有 nofollow 标签」不等于已核实 follow，'
      + '要写进 ledger 的 rel_verified 必须去源页面看 <a> 的实际属性。',
  };
}

// ---------- 主流程 ----------

let output;
try {
  const tool = await ensureTool();
  const url = `${APP_ORIGIN}${spec.path(target, db)}`;
  const cap = await loadReport(url, spec.ready, {
    settle: Number(flags.settle || 10),
    timeout: Number(flags.timeout || 120),
    retries: Number(flags.retries || 3),
  });
  if (!cap) {
    throw new Error(
      `Semrush ${name} for "${target}" never rendered. 依次排查：` +
      `(1) 该主体在 db=${db || 'global'} 里可能真的没有数据；` +
      `(2) 节点挂了——换 --node 重跑（症状是白页、长时间不渲染）；` +
      `(3) 若页面显示「出错了…请稍后重试」，本脚本已自动重载重试 ${flags.retries || 3} 次仍失败。`,
    );
  }
  let lines = cap.bodyText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let parsed = spec.parse(lines);
  const pageInfo = readPageInfo(cap.bodyText);
  let pagesRead = 1;

  // **不允许静默截断**（本 Skill 的明文规则）：要么把页翻完，要么把丢掉的量报出来。
  if (spec.paginated && pageInfo.total > 1) {
    if (flags['all-pages']) {
      const seen = new Set((parsed.rows || []).map(rowKey));
      while (pagesRead < pageInfo.total && pagesRead < Number(flags['max-pages'] || 20)) {
        if (!(await clickNextPage(evalPage, pagesRead))) break;
        pagesRead += 1;
        const next = await evalPage('(() => JSON.stringify({ bodyText: document.body?.innerText || "" }))()');
        const more = spec.parse(next.bodyText.split(/\n+/).map((l) => l.trim()).filter(Boolean));
        for (const r of more.rows || []) {
          const k = rowKey(r);
          if (!seen.has(k)) { seen.add(k); parsed.rows.push(r); }
        }
      }
    } else {
      console.error(
        `[truncated] ${name} 共 ${pageInfo.total} 页，本次只读了第 1 页（${(parsed.rows || []).length} 行）。` +
        `要全量加 --all-pages。`,
      );
    }
  }

  output = {
    version: 1,
    source: 'Semrush via authenticated Tools Share browser session',
    note: 'Semrush 的流量是自然搜索估算，与 Similarweb 的总访问量不同口径，不要并列。',
    retrievedAt: new Date().toISOString(),
    report: name,
    target,
    db: db || null,
    session,
    sessionReused: tool.reused,
    title: cap.title,
    subscription: tool.reused ? null : {
      expiry: tool.state.expiry, daysLeft: tool.state.daysLeft,
      quotas: tool.state.quotas, warning: expiryWarning(tool.state),
    },
    pagination: spec.paginated ? { pages: pageInfo.total, pagesRead, complete: pagesRead >= pageInfo.total } : null,
    parsed,
    rawText: cap.bodyText.slice(0, 20000),
  };
} catch (error) {
  output = {
    version: 1, source: 'Semrush via authenticated Tools Share browser session',
    retrievedAt: new Date().toISOString(), report: name, target, db: db || null, session,
    status: 'unavailable', error: { code: 'report_failed', message: error.message },
  };
}

if (typeof flags.out === 'string') await writeFile(flags.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
printJson(output);
if (output.status === 'unavailable') process.exitCode = 1;
