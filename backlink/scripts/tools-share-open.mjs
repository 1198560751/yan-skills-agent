#!/usr/bin/env node
/**
 * Open the owner's Tools Share panel and launch one of its SEO tools in an
 * authenticated background Chrome session.
 *
 * The panel is a shared-account proxy: it holds the subscription, and each
 * "打开" launcher mints a short-lived session into the tool's own origin. A
 * deep link into that origin BEFORE launching lands on about:blank — the
 * launcher is what establishes the session, so it can never be skipped.
 *
 * This script never types a password. If the panel is logged out it says so
 * and stops; signing in is the owner's action, in their own Chrome.
 */
import { defaultSession, firstJson, opencli, parseFlags, printJson, validateSession } from './opencli-core.mjs';

const DEFAULT_DASHBOARD = 'https://dash.3ue.co/zh-Hans/#/page/m/home';

// Each card is identified by its own label, not by position: the panel renders
// cards in subscription order, which changes when a plan is added or expires.
const TOOLS = {
  similarweb: { label: /PRO\s*全球版|similarweb/i, origin: 'sim.3ue.co', name: 'Similarweb PRO' },
  semrush:    { label: /GURU|地区数据库|semrush/i,  origin: 'sem.3ue.co', name: 'Semrush GURU' },
};

const flags = parseFlags(process.argv.slice(2));
const session = flags.session ? validateSession(flags.session) : defaultSession('backlink-panel');
const toolKey = String(flags.tool || '').toLowerCase();
const tool = TOOLS[toolKey];
if (!tool) {
  throw new Error(`--tool must be one of: ${Object.keys(TOOLS).join(', ')}`);
}
const dashboard = process.env.TOOLS_SHARE_DASHBOARD_URL || DEFAULT_DASHBOARD;
const env = { OPENCLI_WINDOW: flags.window === 'foreground' ? 'foreground' : 'background' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A launch URL carries a session token as a query parameter. Never print it.
const scrub = (url) => String(url || '').split('?')[0];

async function evalPage(expression, timeoutMs = 60_000) {
  const result = await opencli(['browser', session, 'eval', expression], { env, timeoutMs });
  return firstJson(result.stdout);
}

await opencli(['browser', session, 'open', dashboard], { env, timeoutMs: 90_000 });
await sleep(Number(flags.wait || 7) * 1000);

const state = await evalPage(`(() => {
  const text = document.body.innerText.replace(/\\s+/g, ' ');
  const cards = [...document.querySelectorAll('button')]
    .filter((b) => /^打开$/.test((b.innerText || '').trim()))
    .map((b) => {
      let card = b;
      for (let i = 0; i < 10 && card; i += 1) {
        const parent = card.parentElement;
        if (!parent) break;
        card = parent;
        if (/倍率/.test(card.innerText) && card.innerText.length < 400) break;
      }
      return (card.innerText || '').replace(/\\s+/g, ' ').trim();
    });
  const expiry = (text.match(/到期时间\\s*([0-9-]{8,10}\\s*[0-9:]{4,5})/) || [])[1] || null;
  const daysLeft = (text.match(/剩余天数\\s*(\\d+)/) || [])[1] || null;
  const quotas = [...text.matchAll(/API\\s*今日配额\\s*(\\d+%)/g)].map((m) => m[1]);
  return JSON.stringify({
    loggedIn: !/没有账号|去注册/.test(text) && cards.length > 0,
    cards, expiry, daysLeft: daysLeft ? Number(daysLeft) : null, quotas,
  });
})()`);

if (!state.loggedIn) {
  throw new Error(
    `Tools Share is not logged in for this Chrome profile. Sign in manually at ${dashboard} — ` +
    'this script does not handle credentials.'
  );
}

const index = state.cards.findIndex((label) => tool.label.test(label));
if (index === -1) {
  throw new Error(
    `No card matching ${tool.name} on the panel. Cards present: ${JSON.stringify(state.cards)}. ` +
    'The subscription may have changed — update TOOLS in this script rather than guessing an index.'
  );
}

await evalPage(`(() => {
  const buttons = [...document.querySelectorAll('button')].filter((b) => /^打开$/.test((b.innerText || '').trim()));
  buttons[${index}].click();
  return JSON.stringify({ clicked: ${index} });
})()`);

// The launcher navigates the same tab; poll until the tool origin appears.
let landed = null;
const deadline = Date.now() + Number(flags.timeout || 40) * 1000;
while (Date.now() < deadline) {
  await sleep(3000);
  const here = await evalPage('(() => JSON.stringify({ url: location.href, title: document.title }))()');
  if (here.url && new URL(here.url).hostname.endsWith(tool.origin)) { landed = here; break; }
}
if (!landed) {
  throw new Error(`${tool.name} did not reach ${tool.origin} within the timeout. The panel may be out of quota.`);
}

// Optional: navigate inside the now-authenticated session. Deep links only work
// after the launcher has run, which is why this is a flag and not a separate call.
if (typeof flags.goto === 'string') {
  const target = flags.goto.startsWith('http') ? flags.goto : flags.goto.replace(/^\/?/, '/');
  await evalPage(`(() => { location.href = ${JSON.stringify(target)}; return JSON.stringify({ navigating: true }); })()`);
  await sleep(Number(flags.settle || 15) * 1000);
  landed = await evalPage('(() => JSON.stringify({ url: location.href, title: document.title }))()');
}

printJson({
  session,
  tool: tool.name,
  origin: tool.origin,
  url: scrub(landed.url),
  title: landed.title,
  subscription: { expiry: state.expiry, daysLeft: state.daysLeft, quotas: state.quotas },
  warning: state.daysLeft !== null && state.daysLeft <= 7
    ? `Subscription expires in ${state.daysLeft} day(s) — pull what you need now.`
    : null,
});
