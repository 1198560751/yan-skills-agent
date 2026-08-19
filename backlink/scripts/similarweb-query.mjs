#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import {
  closeSession,
  defaultSession,
  parseFlags,
  printJson,
  required,
  validateSession,
} from './opencli-core.mjs';
import { expiryWarning, gotoInTool, launchTool } from './lib-tools-share.mjs';

const flags = parseFlags(process.argv.slice(2));
const domain = normalizeDomain(required(flags, 'domain'));
const session = flags.session ? validateSession(flags.session) : defaultSession('similarweb-research');
const REPORTS = new Set(['performance', 'similar-sites', 'channels']);
const report = REPORTS.has(flags.report) ? flags.report : 'performance';
const windowMode = flags.window === 'foreground' ? 'foreground' : 'background';
const timeoutMs = Math.max(30_000, Math.min(240_000, Number(flags.timeout || 150) * 1000));
const keepOpen = Boolean(flags['keep-open']);
// 面板入口已硬编码(公开 URL,账号在浏览器会话里),环境变量仍可覆盖。
// 面板地址与登录流程都在 lib-tools-share.mjs 里，这里不再重复一份。
// 面板点开之后跳转到的应用域名与入口面板不是同一个 host,推导不出来,只能写死或由环境变量给。
// Similarweb 卡片落在 sim.3ue.co(Semrush 是 sem.3ue.co)。见 references/authorized-data-sources.md。
const appOrigin = (process.env.TOOLS_SHARE_APP_ORIGIN || 'https://sim.3ue.co').replace(/\/+$/, '');
if (!appOrigin) {
  throw new Error(
    'TOOLS_SHARE_APP_ORIGIN is not set. Point it at the origin the dashboard launches into (e.g. https://app.example.com).',
  );
}

function normalizeDomain(value) {
  const candidate = value.includes('://') ? new URL(value).hostname : value.split('/')[0];
  const normalized = candidate.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(normalized)) {
    throw new Error(`Invalid domain: ${value}`);
  }
  return normalized;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// launchTool 返回的 evalPage 已绑定会话，启动之后才可用。
let evaluate = null;

async function poll(label, predicateSource) {
  const startedAt = Date.now();
  let lastState = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastState = await evaluate(`(() => {
        const state = {
          url: location.href,
          title: document.title,
          bodyText: (document.body?.innerText || '').slice(0, 1000)
        };
        return { ready: Boolean(${predicateSource}), state };
      })()`);
      if (lastState.ready) return lastState.state;
    } catch (error) {
      lastState = { error: error.message };
    }
    await delay(2_000);
  }
  throw new Error(`Timed out waiting for ${label}. Last state: ${JSON.stringify(lastState)}`);
}

function parseNumber(value) {
  const normalized = String(value || '').replace(/,/g, '').trim();
  const match = normalized.match(/^([\d.]+)\s*([KMB万亿])?$/i);
  if (!match) return null;
  const multipliers = { k: 1e3, m: 1e6, b: 1e9, 万: 1e4, 亿: 1e8 };
  return Number(match[1]) * (multipliers[(match[2] || '').toLowerCase()] || 1);
}

function parseRank(value) {
  const match = String(value || '').replace(/,/g, '').match(/#?\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

function parsePercent(value) {
  const match = String(value || '').match(/([\d.]+)\s*%/);
  return match ? Number(match[1]) : null;
}

function deriveMetrics(lines) {
  // 同一个指标在面板上不止一种写法（实测「访问持续时间」与「平均访问时长」并存，
  // 「页面数/访问」与「每次访问页数」并存）。只认一种，指标就会静默变成 null——
  // 报表看起来查成功了，字段却缺一半。所以按候选列表逐个找。
  const nextValue = (labels, pattern = /./) => {
    for (const label of [].concat(labels)) {
      const index = lines.findIndex((line) => line === label || line.includes(label));
      if (index < 0) continue;
      const hit = lines.slice(index + 1, index + 8).find((line) => pattern.test(line));
      if (hit) return hit;
    }
    return null;
  };
  const metrics = {
    totalVisits: parseNumber(nextValue('总访问量', /^[\d,.]+\s*[KMB万亿]?$/i)),
    globalRank: parseRank(nextValue('全球排名', /#?\s*[\d,]+/)),
    countryRank: parseRank(nextValue('国家/地区排名', /#?\s*[\d,]+/)),
    industryRank: parseRank(nextValue('行业排名', /#?\s*[\d,]+/)),
    bounceRatePercent: parsePercent(nextValue('跳出率', /%/)),
    pagesPerVisit: parseNumber(nextValue(['页面数/访问', '每次访问页数'], /^[\d.]+$/)),
    visitDuration: nextValue(['访问持续时间', '平均访问时长'], /^\d{2}:\d{2}:\d{2}$/),
  };
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== null));
}

/**
 * 「流量来源渠道」报表：面板先列一串百分比，再列一串同样长度的渠道名，顺序对应；
 * 下方另有一张「渠道 → 绝对访问数」的表。两处都取，能互相核对。
 */
const CHANNEL_LABELS = ['直接', '自然搜索', '付费搜索', '外链', '显示广告', '自然社媒', '付费社交媒体', '生成式 AI', '电子邮件', '联盟'];
const CHANNEL_KEYS = ['Direct', 'Search - Organic', 'Search - Paid', 'Referrals', 'Display Ads', 'Social - Organic', 'Social - Paid', 'Gen AI', 'Email', 'Affiliates'];

function deriveChannels(lines) {
  // 绝对值表（「渠道」下面一列英文渠道名 + 访问数）是这一页最稳的结构，先取它。
  const visits = {};
  for (const key of CHANNEL_KEYS) {
    const i = lines.indexOf(key);
    if (i >= 0) {
      const v = lines[i + 1];
      visits[key] = /^N\/A$/i.test(v || '') ? null : parseNumber(v);
    }
  }
  // **占比直接由绝对值算，不去页面上捞那串百分比。**
  // 页面顶部确实并排列了一串 % 和一串渠道名，但两串中间夹着图例、按钮和空行，
  // 顺序配对极易错位——错位的占比比没有占比更危险。用同一张表自洽地算出来，
  // 加总必然是 100%，也不会跟 visits 打架。
  const total = Object.values(visits).reduce((a, v) => a + (v || 0), 0);
  const sharePercent = {};
  if (total > 0) {
    for (const [k, v] of Object.entries(visits)) {
      if (v !== null && v !== undefined) sharePercent[k] = Number(((v / total) * 100).toFixed(2));
    }
  }
  return { totalFromChannels: total || null, sharePercent, visits };
}

let output;
let subscription = null;
try {
  // 启动一律走 lib-tools-share.mjs 的那一份。**之前这里自己写了一份简化版**：
  // 靠 logo 的 style 找卡片、直接点「打开」、不选节点。它漏掉了三个已知坑
  // （会话焊死、卡片无文字、节点会挂），于是稳定报 shared_proxy_blank_or_unavailable，
  // 而真正的原因每次都不一样。删掉重复实现之后这类误报才有唯一的排查入口。
  const launched = await launchTool({
    session,
    tool: 'similarweb',
    node: flags.node,
    window: windowMode,
    wait: Number(flags.wait || 7),
    timeout: Number(flags.launchTimeout || 60),
  });
  evaluate = launched.evalPage;
  subscription = {
    expiry: launched.state.expiry,
    daysLeft: launched.state.daysLeft,
    quotas: launched.state.quotas,
    warning: expiryWarning(launched.state),
  };

  const REPORT_PATHS = {
    'similar-sites': '/#/digitalsuite/websiteanalysis/overview/competitive-landscape/*/999/3m?key=',
    // 注意：**这条路由没有 `*` 段，而且 `?` 前面有一个斜杠。**
    // 照抄 website-performance 的形状（带 `*`）会让 SPA 整个重新初始化成空白页，
    // 表现为 bodyText 为空、标题退回 'Similarweb PRO'，看起来像节点挂了。
    channels: '/#/digitalsuite/websiteanalysis/traffic-overview/marketing-channels/999/28d/?webSource=Total&key=',
    performance: '/#/digitalsuite/websiteanalysis/overview/website-performance/*/999/28d?webSource=Total&key=',
  };
  // 这是 hash 路由的 SPA：换 hash 不会重新加载页面，所以深链之后必须等它自己渲染完。
  // 实测首屏要 15-20 秒，settle 给小了就会读到一个空 body 并被误判成"这个域名没数据"。
  await gotoInTool(evaluate, `${appOrigin}${REPORT_PATHS[report]}${encodeURIComponent(domain)}`, Number(flags.settle || 12));

  // **轮询条件必须认「只有数据到了才会出现的字符串」。**
  // 之前这里认的是「网站表现」——那是左侧导航的菜单项，页面骨架一挂载就命中，
  // 于是轮询秒过、抓到一个还没渲染数值的 body，metrics 静默变成 {}，
  // 报表看上去查成功了，指标却一个都没有。导航词和内容词必须分清楚。
  const READY_MARKERS = {
    performance: '总访问量',
    channels: '渠道流量',
    'similar-sites': '相似度',
  };
  await poll(
    `the Similarweb ${report} report for ${domain}`,
    `location.href.includes('key=${encodeURIComponent(domain)}') &&
      document.body?.innerText?.includes(${JSON.stringify(READY_MARKERS[report])})`,
  );

  const captured = await evaluate(`(() => ({
    url: location.href,
    title: document.title,
    bodyText: (document.body?.innerText || '').slice(0, 50000)
  }))()`);
  const lines = captured.bodyText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  output = {
    version: 1,
    source: 'Similarweb via authenticated Tools Share browser session',
    retrievedAt: new Date().toISOString(),
    domain,
    report,
    session,
    url: captured.url,
    title: captured.title,
    subscription,
    // 只有「网站表现」页有总访问量/排名/跳出率这些指标。在渠道页上跑 deriveMetrics
    // 会把筛选器里的字当成数值抓（实测 globalRank 抓成 1），宁可不给也不要给错的。
    ...(report === 'performance' ? { metrics: deriveMetrics(lines) } : {}),
    ...(report === 'channels' ? { channels: deriveChannels(lines) } : {}),
    sparse: /没有足够的数据|Not enough data|N\/A/i.test(captured.bodyText),
    rawText: captured.bodyText,
  };
  if (typeof flags.out === 'string') {
    await writeFile(flags.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }
  printJson(output);
} catch (error) {
  output = {
    version: 1,
    source: 'Similarweb via authenticated Tools Share browser session',
    retrievedAt: new Date().toISOString(),
    domain,
    report,
    session,
    status: 'unavailable',
    error: {
      code: /Timed out waiting for the (launched )?Similarweb/i.test(error.message)
        ? 'shared_proxy_blank_or_unavailable'
        : 'query_failed',
      message: error.message,
    },
  };
  if (typeof flags.out === 'string') {
    await writeFile(flags.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }
  printJson(output);
  process.exitCode = 1;
} finally {
  if (!keepOpen) await closeSession(session);
}
