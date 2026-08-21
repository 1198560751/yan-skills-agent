/**
 * lib-tools-share.mjs — 共享账号面板的启动器，**唯一一份**。
 *
 * 面板是一个共享订阅代理：订阅挂在它上面，每张卡片的「打开」按钮临时给你签一张
 * 进入该工具自有域名的会话票。**在点「打开」之前直接深链到工具域名会落到空白页**——
 * 建立会话的正是那次点击，所以这一步永远跳不过去。
 *
 * 为什么要抽成 lib：这套启动流程有四个必须踩对的细节（会话焊死、卡片是 logo 图、
 * nb-select 水合晚、节点会挂），任何一个抄漏都表现为「脚本坏了」而不是「启动失败」。
 * 之前 similarweb-query.mjs 自己写了一份简化版启动器，漏掉了其中三个，
 * 于是稳定报 shared_proxy_blank_or_unavailable。**要用就用这一份。**
 *
 * 本模块从不输入密码。面板未登录就明确报错并停下，登录是机主自己在自己的 Chrome 里做的事。
 */
import { firstJson, opencli } from './opencli-core.mjs';
import { readFileSync } from 'node:fs';

export const DEFAULT_DASHBOARD = 'https://dash.3ue.co/zh-Hans/#/page/m/home';

// 卡片按自己的标签识别，不按位置：面板按订阅顺序渲染，加一个套餐或到期一个就会错位。
/**
 * Skill 根目录的 `.env`（已被 .gitignore 排除）里存放面板令牌等账号配置。
 * Node 不会自动加载它，而这些脚本是直接 `node scripts/x.mjs` 跑的，没有外层加载器，
 * 所以在这里读一次。**已存在的环境变量优先**，不覆盖调用方显式传入的值。
 */
function loadSkillEnv() {
  try {
    const file = new URL('../.env', import.meta.url);
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const value = m[2].trim().replace(/^["']|["']$/g, '');
      if (value && process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  } catch { /* 没有 .env 是正常情况，走面板登录即可 */ }
}
loadSkillEnv();

export const TOOLS = {
  similarweb: { label: /PRO\s*全球版|similarweb/i, origin: 'sim.3ue.co', name: 'Similarweb PRO', tokenEnv: 'SIM_GMITM' },
  semrush:    { label: /GURU|地区数据库|semrush/i,  origin: 'sem.3ue.co', name: 'Semrush GURU', tokenEnv: 'SEM_GMITM' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 启动 URL 的查询串里带会话令牌。**任何时候都不要打印它。** */
export const scrub = (url) => String(url || '').split('?')[0];

/**
 * 打开面板、（可选）选节点、点「打开」、等落到工具域名。
 * 返回 { evalPage, state, landed, tool }，evalPage 已绑定会话，供调用方继续驱动工具页。
 */
export async function launchTool({
  session,
  tool: toolKey,
  node,
  window: windowMode = 'background',
  wait = 7,
  timeout = 40,
  dashboardUrl = process.env.TOOLS_SHARE_DASHBOARD_URL || DEFAULT_DASHBOARD,
}) {
  const tool = TOOLS[String(toolKey || '').toLowerCase()];
  if (!tool) throw new Error(`tool must be one of: ${Object.keys(TOOLS).join(', ')}`);
  const env = { OPENCLI_WINDOW: windowMode === 'foreground' ? 'foreground' : 'background' };

  const evalPage = async (expression, timeoutMs = 60_000) =>
    firstJson((await opencli(['browser', session, 'eval', expression], { env, timeoutMs })).stdout);

  // ── 直连兜底 ───────────────────────────────────────────────────────────────
  // 面板的 dashboard 登录态**会单独掉**，而工具域的会话令牌此时往往还活着
  // （2026-08-21 实测：dashboard 判为未登录，同一时刻带令牌直连 sem 域正常出数）。
  // 所以令牌在环境里就先走直连，省掉整套面板交互，也省掉节点挑选。
  // **令牌是密钥**：只从环境读，永远不要打印、不要写进 .rankup、不要提交。
  // 代价：直连拿不到订阅到期与配额（面板才有），state 里这几项为 null，
  // 调用方的 expiryWarning() 因此静默——这是已知取舍，不是 bug。
  const directToken = (process.env[tool.tokenEnv] || '').trim();
  if (directToken) {
    const entry = `https://${tool.origin}/home/?__gmitm=${encodeURIComponent(directToken)}`;
    await opencli(['browser', session, 'open', entry], { env, timeoutMs: 90_000 });
    await sleep(Math.max(4, Number(wait)) * 1000);
    const here = await evalPage('(() => JSON.stringify({ url: location.href, title: document.title, len: (document.body?.innerText||"").trim().length }))()');
    const onTool = (() => { try { return new URL(here.url).hostname.endsWith(tool.origin); } catch { return false; } })();
    if (onTool && here.len > 40) {
      return {
        tool,
        state: { loggedIn: true, cards: [], expiry: null, daysLeft: null, quotas: [], via: 'direct-token' },
        landed: { url: scrub(here.url), title: here.title },
        evalPage, env, index: -1,
      };
    }
    // 直连没成立就继续走面板，令牌可能已过期。**不要在这里抛错**——
    // 抛了就把一条还能走的路（面板登录态尚在）也堵死了。
  }

  await opencli(['browser', session, 'open', dashboardUrl], { env, timeoutMs: 90_000 });
  await sleep(wait * 1000);

  // **会话会卡在上一次落地的工具 origin 上。** 点过一次「打开」之后这个会话的标签页就在
  // sim/sem 那边了；再 open 面板**不保证**导航回来。表现是面板上一个 nb-select 都找不到，
  // 看起来完全像选择器写错了，能查很久。判据是当前 host。
  const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
  const panelHost = new URL(dashboardUrl).hostname;
  {
    const here = await evalPage('JSON.stringify({ url: location.href })');
    if (hostOf(here.url) !== panelHost) {
      await opencli(['browser', session, 'close'], { env, timeoutMs: 30_000 }).catch(() => {});
      await opencli(['browser', session, 'open', dashboardUrl], { env, timeoutMs: 90_000 });
      await sleep(wait * 1000);
      const retry = await evalPage('JSON.stringify({ url: location.href })');
      if (hostOf(retry.url) !== panelHost) {
        throw new Error(
          `This OpenCLI session is stuck on ${hostOf(retry.url) || 'an unknown page'} and will not navigate back ` +
            `to the panel; close + open did not recover it. Do not debug the selectors — they are fine. ` +
            `Rerun with a fresh --session name, or do this one by hand in the owner's Chrome. ` +
            `See references/authorized-data-sources.md → "节点会挂，会话会焊死".`,
        );
      }
    }
  }

  // 面板是 Angular SPA，首屏经常要 20-40 秒才渲染，期间 body.innerText 是空白。
  // **空白页和「未登录」在这里长得一模一样**，而下面的 loggedIn 判据（没有卡片 = 未登录）
  // 会把前者读成后者，抛出一条「请手动登录」——于是人跑去看，发现明明是登录着的。
  // 2026-08-21 实测：连抛两次，reload 一次之后面板正常显示订阅到期 2027-02-21。
  // 所以先轮询等「渲染完成」，只有渲染完了才允许判断登录态。
  const readPanel = () => evalPage(`(() => {
    const text = document.body.innerText.replace(/\\s+/g, ' ');
    return JSON.stringify({ len: text.trim().length, hasCard: /打开/.test(text), text: text.slice(0, 200) });
  })()`);
  {
    const deadline = Date.now() + Math.max(60, Number(wait) * 4) * 1000;
    let seen = await readPanel();
    while (!seen.hasCard && Date.now() < deadline) {
      await evalPage(`(() => { location.reload(); return JSON.stringify({ r: 1 }); })()`).catch(() => {});
      await sleep(12_000);
      seen = await readPanel();
    }
    if (!seen.hasCard && seen.len < 40) {
      throw new Error(
        'Tools Share panel never rendered (body is blank after reloads). This is NOT a logged-out panel — '
        + 'a logged-out one still renders text. Most likely a dead node or a slow SPA boot; '
        + 'open the panel by hand in the owner\'s Chrome and check, or retry with a fresh --session.',
      );
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
    // 到这里页面确定已经渲染过了（上面的轮询保证），所以「没有卡片」才真的意味着未登录。
    throw new Error(
      `Tools Share is not logged in for this Chrome profile. Sign in manually at ${dashboardUrl} — ` +
        'this script does not handle credentials.',
    );
  }

  const index = state.cards.findIndex((label) => tool.label.test(label));
  if (index === -1) {
    throw new Error(
      `No card matching ${tool.name} on the panel. Cards present: ${JSON.stringify(state.cards)}. ` +
        'The subscription may have changed — update TOOLS in lib-tools-share.mjs rather than guessing an index.',
    );
  }

  // 节点：每张卡片一个「选择节点」下拉（节点1..N）。**节点会挂**——挂掉的节点点「打开」后
  // 落到空白页或长时间不渲染，看起来完全像脚本坏了，换一个节点即可。下拉里的「倍率」是
  // 配额消耗速率，没有特别理由就用 X 1 的。**这一段必须在点「打开」之前跑**：点完之后
  // 标签页已经在工具域，面板上什么都找不到了。
  if (node) {
    const wanted = `节点${String(node).trim().replace(/^节点/, '')}`;
    // 面板是 Angular + Nebular：节点选择器是 <nb-select>，触发器是它内部的
    // button.select-button，选项是 <nb-option>。三点实测教训：
    //   1. 卡片上的产品名是 **logo 图片**，没有文字——按卡片文案找卡片会找不到。
    //      产品名真正出现在节点选择器自己的文案里（「节点3 倍率 X 1 🔖 PRO 全球版」），
    //      所以直接在 nb-select 里按 label 挑。
    //   2. 触发器带子元素，用 children.length === 0 过滤会把它整个漏掉。
    //   3. **eval 必须 JSON.stringify 再返回**。返回裸对象经 opencli 序列化后
    //      firstJson 解析不出字段，表现为 seen 永远是 []，会被误判成「页面上没有节点选择器」。
    // Angular 水合比「打开」按钮出现晚：state 已读到卡片时 nb-select 可能还是 0 个，所以轮询。
    let picked = { ok: false, why: 'node selector never appeared', seen: [] };
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      picked = await evalPage(`(() => {
        const selects = [...document.querySelectorAll('nb-select')];
        const texts = selects.map((e) => (e.innerText || '').trim());
        const i = texts.findIndex((t) => /^节点\\d+/.test(t) && ${tool.label}.test(t));
        if (i < 0) return JSON.stringify({ ok: false, why: 'no node selector matches this tool', seen: texts });
        const btn = selects[i].querySelector('button.select-button') || selects[i];
        btn.click();
        return JSON.stringify({ ok: true, current: texts[i] });
      })()`);
      if (picked.ok) break;
      await sleep(1000);
    }
    if (!picked.ok) {
      throw new Error(`Could not open the node selector: ${picked.why}. Seen: ${JSON.stringify(picked.seen || [])}`);
    }
    await sleep(1200);
    const chosen = await evalPage(`(() => {
      const opts = [...document.querySelectorAll('nb-option')];
      const texts = opts.map((e) => (e.innerText || '').trim());
      const i = texts.findIndex((t) => t.startsWith(${JSON.stringify(wanted)} + ' '));
      if (i < 0) return JSON.stringify({ ok: false, options: texts });
      opts[i].click();
      return JSON.stringify({ ok: true, picked: texts[i] });
    })()`);
    if (!chosen.ok) throw new Error(`Node "${wanted}" not offered. Available: ${JSON.stringify(chosen.options)}`);
    await sleep(800);
  }

  await evalPage(`(() => {
    const buttons = [...document.querySelectorAll('button')].filter((b) => /^打开$/.test((b.innerText || '').trim()));
    buttons[${index}].click();
    return JSON.stringify({ clicked: ${index} });
  })()`);

  // 启动器在同一个标签页里导航，轮询到工具域名出现为止。
  let landed = null;
  const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const here = await evalPage('(() => JSON.stringify({ url: location.href, title: document.title }))()');
    if (here.url && hostOf(here.url).endsWith(tool.origin)) { landed = here; break; }
  }
  if (!landed) {
    throw new Error(
      `${tool.name} did not reach ${tool.origin} within the timeout. Two causes, in order of likelihood: ` +
        `(1) **the node is down** — rerun with a different node (the panel offers 节点1..N); ` +
        `(2) the panel is out of quota. A dead node looks exactly like a broken script: the launch reports ` +
        `fine and the tool page never renders. Change the node before debugging anything else.`,
    );
  }

  return { tool, state, landed, evalPage, env, index };
}

/** 在已登录的工具页内部深链跳转。**只有在 launchTool 跑完之后才有效。** */
export async function gotoInTool(evalPage, target, settleSeconds = 15) {
  const url = target.startsWith('http') ? target : target.replace(/^\/?/, '/');
  await evalPage(`(() => { location.href = ${JSON.stringify(url)}; return JSON.stringify({ navigating: true }); })()`);
  await sleep(settleSeconds * 1000);
  return evalPage('(() => JSON.stringify({ url: location.href, title: document.title }))()');
}

/** 订阅快到期时的提醒文案，几个脚本都要用。 */
export function expiryWarning(state) {
  return state.daysLeft !== null && state.daysLeft <= 7
    ? `Subscription expires in ${state.daysLeft} day(s) — pull what you need now.`
    : null;
}
