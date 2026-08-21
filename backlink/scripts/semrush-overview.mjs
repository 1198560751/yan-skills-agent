#!/usr/bin/env node
/**
 * semrush-overview.mjs — 拉一个域名的 Semrush「域名概览」：权重分、自然流量、
 * 引荐域名数、自然关键词数、反链数，以及国家数据库维度。
 *
 * 为什么单独一个脚本：这是竞品勘测里被问得最多的一组数字，而已有的
 * semrush 相关脚本都是**表格报表的批量导出**（引荐域名、主要页面、排名词），
 * 概览页没有表格也没有导出按钮，导不出来，只能读页面。之前一直是手动开浏览器看的。
 *
 * 与 similarweb-query.mjs 的分工（两者查的是不同口径，别混用）：
 *   - 本脚本给的是**自然搜索流量**估算，只算 Google 自然结果带来的那部分；
 *   - similarweb-query --report performance 给的是**总访问量**，包含直接、社交、买量。
 *   同一个站两个数字差几倍是正常的，把它们放进同一张表对比是错的。
 *
 * 用法：
 *   node semrush-overview.mjs --domain example.com [--db jp] [--subdomain] [--node 5]
 */
import { defaultSession, parseFlags, printJson, required, validateSession } from './opencli-core.mjs';
import { expiryWarning, gotoInTool, launchTool } from './lib-tools-share.mjs';
import { writeFile } from 'node:fs/promises';

const flags = parseFlags(process.argv.slice(2));
const domain = normalizeDomain(required(flags, 'domain'));
const db = String(flags.db || '').trim().toLowerCase();
const session = flags.session ? validateSession(flags.session) : defaultSession('semrush-overview');
const appOrigin = (process.env.TOOLS_SHARE_APP_ORIGIN_SEMRUSH || 'https://sem.3ue.co').replace(/\/+$/, '');

function normalizeDomain(value) {
  const candidate = value.includes('://') ? new URL(value).hostname : value.split('/')[0];
  const normalized = candidate.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(normalized)) {
    throw new Error(`Invalid domain: ${value}`);
  }
  return normalized;
}

/** 「23.8K」「1.6K」「4.9K」这种缩写在概览页到处都是，必须还原成数字。 */
function parseCompact(value) {
  const m = String(value || '').replace(/,/g, '').trim().match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(Number(m[1]) * mult);
}

/**
 * 概览页是「标签一行、数值下一行」的结构，中间还会插入变化率（+356%）和评级词（尚可/高）。
 * 所以不能取标签的下一行，要往后找到第一行**长得像数值**的。
 */
function pick(lines, label, pattern) {
  const i = lines.findIndex((l) => l === label);
  if (i < 0) return null;
  return lines.slice(i + 1, i + 6).find((l) => pattern.test(l)) || null;
}

let output;
try {
  const launched = await launchTool({
    session,
    tool: 'semrush',
    node: flags.node,
    window: flags.window,
    wait: Number(flags.wait || 7),
    timeout: Number(flags.launchTimeout || 60),
  });

  const searchType = flags.subdomain ? 'subdomain' : 'domain';
  const url = `${appOrigin}/analytics/overview/?q=${encodeURIComponent(domain)}` +
    `&searchType=${searchType}${db ? `&db=${encodeURIComponent(db)}` : ''}`;
  await gotoInTool(launched.evalPage, url, Number(flags.settle || 12));

  // 概览页首屏要十几秒。**认「Authority Score」而不是页面标题**——
  // 标题在骨架阶段就有了，认它会抓到一个空壳。
  let captured = null;
  const deadline = Date.now() + Number(flags.timeout || 120) * 1000;
  while (Date.now() < deadline) {
    captured = await launched.evalPage(`(() => JSON.stringify({
      url: location.href,
      title: document.title,
      ready: /Authority Score|权威分数/.test(document.body?.innerText || ''),
      bodyText: (document.body?.innerText || '').slice(0, 30000),
    }))()`);
    if (captured.ready) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!captured?.ready) {
    throw new Error(
      `Semrush overview for ${domain} never rendered its metrics. Most likely the node is down — ` +
        `rerun with a different --node. Second possibility: the domain has no data in db=${db || 'global'}.`,
    );
  }

  const lines = captured.bodyText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const metrics = {
    // `Number(x) || null` 会把 AS=0 吞成 null —— 而 0 是真实值（新站常见），
    // 与「没数据」含义相反。2026-08-21 在 semrush-report.mjs 上发现，同步修这里。
    authorityScore: (() => { const v = pick(lines, 'Authority Score', /^\d+$/); return v === null ? null : Number(v); })(),
    organicTraffic: parseCompact(pick(lines, '自然流量', /^[\d.,]+\s*[KMB]?$/i)),
    paidTraffic: parseCompact(pick(lines, '付费流量', /^[\d.,]+\s*[KMB]?$/i)),
    referringDomains: parseCompact(pick(lines, '引荐域名', /^[\d.,]+\s*[KMB]?$/i)),
    organicKeywords: parseCompact(pick(lines, '自然搜索关键词', /^[\d.,]+\s*[KMB]?$/i)),
    backlinks: parseCompact(pick(lines, '反向链接', /^[\d.,]+\s*[KMB]?$/i)),
    // 变化率紧跟在数值后面，单独取一次用于判断是在涨还是在掉。
    organicTrafficChange: pick(lines, '自然流量', /^[+\-−][\d.]+%$/),
    organicKeywordsChange: pick(lines, '自然搜索关键词', /^[+\-−][\d.]+%$/),
  };

  output = {
    version: 1,
    source: 'Semrush domain overview via authenticated Tools Share browser session',
    note: 'organicTraffic 是自然搜索流量估算，与 Similarweb 的总访问量不是同一口径，不要并列比较。',
    retrievedAt: new Date().toISOString(),
    domain,
    db: db || null,
    searchType,
    session,
    title: captured.title,
    subscription: {
      expiry: launched.state.expiry,
      daysLeft: launched.state.daysLeft,
      quotas: launched.state.quotas,
      warning: expiryWarning(launched.state),
    },
    metrics: Object.fromEntries(Object.entries(metrics).filter(([, v]) => v !== null && v !== undefined)),
  };
} catch (error) {
  output = {
    version: 1,
    source: 'Semrush domain overview via authenticated Tools Share browser session',
    retrievedAt: new Date().toISOString(),
    domain,
    db: db || null,
    session,
    status: 'unavailable',
    error: { code: 'overview_failed', message: error.message },
  };
}

if (typeof flags.out === 'string') {
  await writeFile(flags.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}
printJson(output);
if (output.status === 'unavailable') process.exitCode = 1;
