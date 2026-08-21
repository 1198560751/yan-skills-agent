#!/usr/bin/env node
/**
 * semrush-keyword.mjs — 读 Semrush「关键词概览」：某个词在某个国家库里的
 * 月搜索量、关键词难度(KD)、CPC、竞争密度、结果数、意图。
 *
 * 为什么需要它：已有的 semrush 脚本全是**域名**维度（semrush-overview 读域名概览，
 * semrush-batch 批量导出域名报表）。「这个词有多少量」此前一直靠手开浏览器看，
 * 而选品、选域名、排产品线全都要问这个问题。
 *
 * 与关键词魔法工具整包导出的分工：整包导出适合一次拉几千个词做聚簇；
 * 本脚本适合**点查十几个词**，不占导出配额，也不需要事后清洗。
 *
 * 坑（与 semrush-overview 同源，别重犯）：
 *   1. 认「关键词难度」这类**只在数据渲染后才出现的字符串**做就绪标记，
 *      认页面标题会抓到骨架空壳；
 *   2. 「无数据」是结果不是故障——Semrush 会渲染出页面但量为空，
 *      本脚本记为 volume:0 + noData:true，不要报成脚本失败；
 *   3. 词里有空格/CJK 必须 encodeURIComponent，否则路由会被截断。
 *
 * 用法：
 *   node semrush-keyword.mjs --kw 診断 --db jp      # --db 是按国家的，别省
 *   node semrush-keyword.mjs --kw-file words.txt --db kr --out kr.jsonl
 */
import { defaultSession, parseFlags, printJson, validateSession } from './opencli-core.mjs';
import { expiryWarning, gotoInTool, launchTool } from './lib-tools-share.mjs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';

const flags = parseFlags(process.argv.slice(2));
const dbGiven = flags.db !== undefined && String(flags.db).trim() !== '';
const db = String(flags.db || 'jp').trim().toLowerCase();
// The default exists because this Skill's first callers were all JP-market, and
// changing it now would silently re-point their saved runs. But an English
// keyword queried against the JP database returns real, plausible, wrong
// numbers with nothing to signal it, so a defaulted --db announces itself.
if (!dbGiven) {
  console.error(`⚠ --db not given, defaulting to "jp". Volume/KD/CPC are per-country; pass --db us (or uk/de/…) for any non-Japan market.`);
}
const session = flags.session ? validateSession(flags.session) : defaultSession('semrush-keyword');
const appOrigin = (process.env.TOOLS_SHARE_APP_ORIGIN_SEMRUSH || 'https://sem.3ue.co').replace(/\/+$/, '');

let keywords = [];
if (typeof flags.kw === 'string') keywords = String(flags.kw).split(',').map((s) => s.trim()).filter(Boolean);
if (typeof flags['kw-file'] === 'string') {
  const text = await readFile(flags['kw-file'], 'utf8');
  keywords = keywords.concat(text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')));
}
if (!keywords.length) throw new Error('Need --kw "a,b" or --kw-file <path>');

function parseCompact(value) {
  const m = String(value || '').replace(/,/g, '').trim().match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(Number(m[1]) * mult);
}
/**
 * 页面上出现的所有指标标签，`pick` 拿它当**扫描边界**。
 * 单独列出来是因为「往后找」必须知道自己什么时候越界了。
 */
const LABELS = [
  '搜索量', '关键词难度', '全球搜索量', 'CPC', '竞争激烈程度', '意图', '趋势',
  '结果', '谷歌购物广告', '广告', '关键词意见', '关键词变化', '总搜索量',
];

/**
 * 标签下一行不一定是数值（可能是变化率、评级词），所以要往后找。
 * 往后找有**两种**翻车方式，两个守卫缺一不可：
 *
 *   1. **「不可用」没短路**：Semrush 对冷门词把 KD 写成「不可用」，
 *      继续往后就会抓到下一个指标的数字——实测有个词的 KD 被读成 780，
 *      那其实是它的全球搜索量。
 *   2. **越过了标签边界**：某个指标的值这次没渲染出来时，扫描会一路穿到
 *      下一个标签底下，把别人的数字当成自己的。2026-08-21 在 semrush-report.mjs
 *      上实测到「自然流量」被读成 4，那是「出站域名」的值。
 *
 * 两种都产出**看着合理、其实是隔壁字段**的错数，比返回 null 危险得多。
 * 所以：碰到「不可用」停，碰到下一个已知标签也停，宁可返回 null。
 */
const NA = /^(不可用|n\/a|-|—)$/i;
function pick(lines, label, pattern, span = 6) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== label) continue;   // 同名词可能先出现在导航里，所有位置都试
    for (let j = i + 1; j < Math.min(lines.length, i + 1 + span); j++) {
      if (NA.test(lines[j])) break;           // 守卫 1：明确的「无数据」
      if (LABELS.includes(lines[j])) break;   // 守卫 2：越到下一个指标了
      if (pattern.test(lines[j])) return lines[j];
    }
  }
  return null;
}


/**
 * 意图（Commercial / Informational / Navigational / Transactional）。
 * 这个字段头部注释从一开始就写着会读，代码里却一直没取——2026-08-21 实战测试里
 * 有人只能自己对 --debug 的 bodyText 现写正则去抠，所以补成一等字段。
 * 值可能是多个（「商业, 交易」），按已知词表匹配整行，避免把隔壁标签的文字吞进来。
 */
const INTENT_WORDS = { 商业: 'Commercial', 信息: 'Informational', 导航: 'Navigational', 交易: 'Transactional' };
const INTENT_RE = /^(?:商业|信息|导航|交易|Commercial|Informational|Navigational|Transactional)(?:\s*[,、，/]\s*(?:商业|信息|导航|交易|Commercial|Informational|Navigational|Transactional))*$/i;
function pickIntent(lines) {
  const raw = pick(lines, '意图', INTENT_RE, 3) ?? pick(lines, 'Intent', INTENT_RE, 3);
  if (!raw) return { intent: null, intentRaw: null };
  const parts = raw.split(/\s*[,、，/]\s*/).filter(Boolean);
  return { intentRaw: raw, intent: parts.map((x) => INTENT_WORDS[x] || x).join(', ') };
}

/** 「全球搜索量」下面是 国家码/国家名/数值 三行一组，一直到「意图」。
 *  罗马字词最有价值的信息就在这里：它到底在哪个国家有量。 */
function pickCountries(lines) {
  const i = lines.indexOf('全球搜索量');
  if (i < 0) return null;
  const end = lines.findIndex((l, j) => j > i && (l === '意图' || l === '趋势'));
  const slice = lines.slice(i + 1, end < 0 ? i + 30 : end);
  const out = {};
  for (let j = 0; j < slice.length; j++) {
    if (/^[A-Z]{2}$/.test(slice[j]) && slice[j + 2] && /^[\d.,]+\s*[KMB]?$/i.test(slice[j + 2])) {
      out[slice[j]] = parseCompact(slice[j + 2]);
      j += 2;
    }
  }
  return Object.keys(out).length ? out : null;
}

const launched = await launchTool({
  session,
  tool: 'semrush',
  node: flags.node,
  window: flags.window,
  wait: Number(flags.wait || 7),
  timeout: Number(flags.launchTimeout || 60),
});
const warn = expiryWarning(launched.state);
if (warn) console.error(`[subscription] ${warn}`);

const results = [];
for (const kw of keywords) {
  let row;
  try {
    const url = `${appOrigin}/analytics/keywordoverview/?q=${encodeURIComponent(kw)}&db=${encodeURIComponent(db)}`;
    await gotoInTool(launched.evalPage, url, Number(flags.settle || 8));

    let cap = null;
    const deadline = Date.now() + Number(flags.timeout || 90) * 1000;
    while (Date.now() < deadline) {
      cap = await launched.evalPage(`(() => { const t = document.body?.innerText || ''; return JSON.stringify({
        ready: /关键词难度|Keyword Difficulty/.test(t),
        // 库里完全没有这个词时，页面渲染完也不会出现任何指标块，只留一个
        // 「更新指标 / 提供最新的关键词数据」的取数按钮。这是**观测到的空**，
        // 与「还没渲染完」形态不同，必须分开——否则冷门词全被记成脚本故障。
        absent: /提供最新的关键词数据|更新指标/.test(t) && !/关键词难度|搜索量/.test(t),
        bodyText: t.slice(0, 20000),
      }); })()`);
      if (cap.ready || cap.absent) break;
      await new Promise((r) => setTimeout(r, 2500));
    }
    if (!cap?.ready && !cap?.absent) throw new Error(`keyword overview never rendered for "${kw}" (db=${db}) — 页面既没出指标也没出空态标记，这是超时不是结果`);

    const lines = cap.bodyText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const volRaw = pick(lines, '搜索量', /^[\d.,]+\s*[KMB]?$/i) ?? pick(lines, 'Volume', /^[\d.,]+\s*[KMB]?$/i);
    const kdRaw = pick(lines, '关键词难度', /^\d{1,3}%?$/) ?? pick(lines, 'Keyword Difficulty', /^\d{1,3}%?$/);
    const noData = volRaw === null || /我们没有要显示的数据|未找到|没有找到|no data|not found/i.test(cap.bodyText) && volRaw === null;
    row = {
      keyword: kw,
      db,
      volume: volRaw === null ? (noData ? 0 : null) : parseCompact(volRaw),
      kd: kdRaw === null ? null : Number(String(kdRaw).replace('%', '')),
      cpc: pick(lines, 'CPC', /^[^\n]{1,12}$/, 3),
      competition: pick(lines, '竞争激烈程度', /^[\d.]+$/) ?? pick(lines, 'Com.', /^[\d.]+$/),
      results: parseCompact(pick(lines, '结果数', /^[\d.,]+\s*[KMB]?$/i) ?? pick(lines, 'Results', /^[\d.,]+\s*[KMB]?$/i)),
      globalVolume: parseCompact(pick(lines, '全球搜索量', /^[\d.,]+\s*[KMB]?$/i)),
      byCountry: pickCountries(lines),
      ...pickIntent(lines),
      noData,
      status: cap.absent ? 'absent' : 'ok',
    };
    if (flags.debug) row.bodyText = cap.bodyText.slice(0, 3000);
  } catch (error) {
    row = { keyword: kw, db, status: 'error', error: error.message };
  }
  results.push(row);
  console.error(`[${results.length}/${keywords.length}] ${kw} → ${row.status !== 'error' ? `vol=${row.volume} kd=${row.kd}` : row.error}`);
  // 每查完一个就落盘，中途被打断也留得下已有结果。
  if (typeof flags.out === 'string') {
    await writeFile(flags.out, results.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  }
}

printJson({
  version: 1,
  source: 'Semrush keyword overview via authenticated Tools Share browser session',
  retrievedAt: new Date().toISOString(),
  db,
  session,
  subscription: { expiry: launched.state.expiry, daysLeft: launched.state.daysLeft, warning: warn || null },
  results,
});
