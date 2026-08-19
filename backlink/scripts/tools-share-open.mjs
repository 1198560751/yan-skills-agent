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

// **会话会卡在上一次落地的工具 origin 上。** 点过一次「打开」之后，这个会话的标签页就在
// sim/sem 那边了；再 `open` 面板**不保证**把它导航回来（实测：tab list 显示仍在工具域，
// 而 eval 读到的当然也是工具页——表现为面板上一个 nb-select 都找不到，
// 看起来完全像「面板没渲染」或「脚本选择器写错了」，能查很久）。
// 判据是当前 host，不在面板域就把会话关掉重开，拿一条干净的租约。
{
  const hereRaw = await evalPage(`JSON.stringify({ url: location.href })`);
  const host = (() => { try { return new URL(hereRaw.url).hostname; } catch { return ''; } })();
  if (!host || host !== new URL(dashboard).hostname) {
    // 试一次关掉重开。**实测这一步经常救不回来**——会话的标签页会焊死在工具域上，
    // close + open 之后 tab list 显示的仍是工具页。所以第二次还不对就停下来报错，
    // 不要带着一个读不到面板的会话继续往下跑（那会以「选择器写错了」的面貌浪费很久）。
    await opencli(['browser', session, 'close'], { env, timeoutMs: 30_000 }).catch(() => {});
    await opencli(['browser', session, 'open', dashboard], { env, timeoutMs: 90_000 });
    await sleep(Number(flags.wait || 7) * 1000);
    const retryRaw = await evalPage(`JSON.stringify({ url: location.href })`);
    const retryHost = (() => { try { return new URL(retryRaw.url).hostname; } catch { return ''; } })();
    if (retryHost !== new URL(dashboard).hostname) {
      throw new Error(
        `This OpenCLI session is stuck on ${retryHost || 'an unknown page'} and will not navigate back to the panel; ` +
          `close + open did not recover it. Do not debug the selectors — they are fine. ` +
          `Either rerun with a fresh --session name, or do this one by hand in the owner's Chrome: ` +
          `open the panel, pick a node on the tool's card, click 打开, then drive the tool in that tab. ` +
          `See references/authorized-data-sources.md → "节点会挂，会话会焊死".`
      );
    }
  }
}

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

// 节点：每张卡片上有一个「选择节点」下拉（节点1..N）。**节点会挂**——挂掉的节点
// 点「打开」后落到一个空白页或长时间不渲染，看起来完全像脚本坏了。换一个节点即可。
// 下拉里的「倍率」是配额消耗速率，倍率越高消耗越快，没有特别理由就用 X 1 的。
if (flags.node) {
  // 允许传 "3" 或 "节点3"，统一成 "节点3" 再去匹配。
  const wanted = `节点${String(flags.node).trim().replace(/^节点/, '')}`;
  // 面板是 Angular + Nebular：节点选择器是 <nb-select>，触发器是它内部的
  // button.select-button，选项是 <nb-option>。两点实测教训：
  //   1. 卡片上的产品名是 **logo 图片**，没有文字——按卡片文案定位找不到卡片。
  //      产品名真正出现在节点选择器自己的文案里（「节点3 倍率 X 1 🔖 PRO 全球版」），
  //      所以直接在 nb-select 里按 label 挑，不要去找卡片容器。
  //   2. 触发器带子元素，用 `children.length === 0` 过滤会把它整个漏掉。
  // Angular 水合完成得比「打开」按钮出现晚：state 已经读到卡片时，nb-select 可能
  // 还是 0 个（实测 Seen: []）。所以这里轮询等它出现，不要一次性判死。
  let picked = { ok: false, why: 'node selector never appeared', seen: [] };
  const nodeDeadline = Date.now() + 20_000;
  while (Date.now() < nodeDeadline) {
    picked = await evalPage(`(() => {
    const selects = [...document.querySelectorAll('nb-select')];
    const texts = selects.map((e) => (e.innerText || '').trim());
    const i = texts.findIndex((t) => /^节点\\d+/.test(t) && ${tool.label}.test(t));
    // 注意：必须 JSON.stringify 再返回。返回裸对象经 opencli 序列化后 firstJson 解析不出
    // 想要的字段，表现为 seen 永远是 []，会被误判成「页面上没有节点选择器」。
    if (i < 0) return JSON.stringify({ ok: false, why: 'no node selector matches this tool', seen: texts });
    const btn = selects[i].querySelector('button.select-button') || selects[i];
    btn.click();
    return JSON.stringify({ ok: true, current: texts[i] });
  })()`);
    if (picked.ok) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!picked.ok) throw new Error(`Could not open the node selector: ${picked.why}. Seen: ${JSON.stringify(picked.seen || [])}`);
  await new Promise((r) => setTimeout(r, 1200));
  const chosen = await evalPage(`(() => {
    const opts = [...document.querySelectorAll('nb-option')];
    const texts = opts.map((e) => (e.innerText || '').trim());
    const i = texts.findIndex((t) => t.startsWith(${JSON.stringify(wanted)} + ' '));
    if (i < 0) return JSON.stringify({ ok: false, options: texts });
    opts[i].click();
    return JSON.stringify({ ok: true, picked: texts[i] });
  })()`);
  if (!chosen.ok) {
    throw new Error(`Node "${wanted}" not offered. Available: ${JSON.stringify(chosen.options)}`);
  }
  await new Promise((r) => setTimeout(r, 800));
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
  throw new Error(
    `${tool.name} did not reach ${tool.origin} within the timeout. ` +
      `Two causes, in order of likelihood: (1) **the node is down** — rerun with a different ` +
      `--node (the panel offers 节点1..N); (2) the panel is out of quota. ` +
      `A dead node looks exactly like a broken script: the launch reports fine and the tool page ` +
      `never renders. Change the node before debugging anything else.`
  );
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
