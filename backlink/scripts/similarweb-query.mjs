#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import {
  closeSession,
  firstJson,
  opencli,
  parseFlags,
  printJson,
  required,
  validateSession,
} from './opencli-core.mjs';

const flags = parseFlags(process.argv.slice(2));
const domain = normalizeDomain(required(flags, 'domain'));
const session = validateSession(flags.session || 'similarweb-research');
const report = flags.report === 'similar-sites' ? 'similar-sites' : 'performance';
const windowMode = flags.window === 'foreground' ? 'foreground' : 'background';
const timeoutMs = Math.max(30_000, Math.min(240_000, Number(flags.timeout || 150) * 1000));
const keepOpen = Boolean(flags['keep-open']);
// 授权第三方面板的入口属于使用者的账号配置,不随 Skill 分发。
// 通过 TOOLS_SHARE_DASHBOARD_URL 提供,未设置时明确报错而非猜测。
const dashboardUrl = process.env.TOOLS_SHARE_DASHBOARD_URL;
if (!dashboardUrl) {
  throw new Error(
    'TOOLS_SHARE_DASHBOARD_URL is not set. Point it at your authorized third-party SEO dashboard before running this script.',
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

async function evaluate(source) {
  const result = await opencli(['browser', session, 'eval', source], {
    env: { OPENCLI_WINDOW: windowMode },
    timeoutMs: 60_000,
  });
  return firstJson(result.stdout);
}

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
  const nextValue = (label, pattern = /./) => {
    const index = lines.findIndex((line) => line === label || line.includes(label));
    if (index < 0) return null;
    return lines.slice(index + 1, index + 8).find((line) => pattern.test(line)) || null;
  };
  const metrics = {
    totalVisits: parseNumber(nextValue('总访问量', /^[\d,.]+\s*[KMB万亿]?$/i)),
    globalRank: parseRank(nextValue('全球排名', /#?\s*[\d,]+/)),
    countryRank: parseRank(nextValue('国家/地区排名', /#?\s*[\d,]+/)),
    industryRank: parseRank(nextValue('行业排名', /#?\s*[\d,]+/)),
    bounceRatePercent: parsePercent(nextValue('跳出率', /%/)),
    pagesPerVisit: parseNumber(nextValue('每次访问页数', /^[\d.]+$/)),
    visitDuration: nextValue('平均访问时长', /^\d{2}:\d{2}:\d{2}$/),
  };
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== null));
}

let output;
try {
  await opencli(['browser', session, 'open', dashboardUrl], {
    env: { OPENCLI_WINDOW: windowMode },
    timeoutMs: 60_000,
  });
  await poll(
    'the authenticated Tools Share dashboard',
    `document.body?.innerText?.includes('SEO Tools') &&
      document.querySelector('[style*="similarweb" i],img[src*="similarweb" i],use[href*="similarweb" i]')`,
  );

  await evaluate(`(() => {
    const logo = [...document.querySelectorAll('[style]')]
      .find((node) => /similarweb/i.test(node.getAttribute('style') || ''));
    const card = logo?.closest('app-subscription-item,nb-card');
    const launcher = [...(card?.querySelectorAll('button,a') || [])]
      .find((node) => node.textContent?.trim() === '打开');
    if (!launcher) return { clicked: false };
    launcher.click();
    return { clicked: true };
  })()`);
  await poll(
    'the launched Similarweb application',
    `location.hostname === 'sim.3ue.co' &&
      document.body?.innerText?.includes('网站分析')`,
  );

  const reportUrl = report === 'similar-sites'
    ? `https://sim.3ue.co/#/digitalsuite/websiteanalysis/overview/competitive-landscape/*/999/3m?key=${encodeURIComponent(domain)}`
    : `https://sim.3ue.co/#/digitalsuite/websiteanalysis/overview/website-performance/*/999/28d?webSource=Total&key=${encodeURIComponent(domain)}`;
  await opencli(['browser', session, 'open', reportUrl], {
    env: { OPENCLI_WINDOW: windowMode },
    timeoutMs: 60_000,
  });

  await poll(
    `the Similarweb ${report} report for ${domain}`,
    `location.href.includes('key=${encodeURIComponent(domain)}') &&
      (document.body?.innerText?.includes('全球排名') ||
       document.body?.innerText?.includes('网站表现') ||
       document.body?.innerText?.includes('类似的网站'))`,
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
    metrics: deriveMetrics(lines),
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
