#!/usr/bin/env node
/**
 * similarweb-query.mjs —— 用已登录的 Tools Share 会话查一个域名的 Similarweb 报表。
 *
 * 用法：
 *   node scripts/similarweb-query.mjs --domain example.com
 *   node scripts/similarweb-query.mjs --domain example.com --report channels --out out.json
 *
 * 参数：
 *   --domain <d>            必填
 *   --report <r>            performance（默认）| channels | similar-sites
 *   --out <file>            落盘 JSON
 *   --session <name>        opencli 会话名，默认按项目派生（别写死）
 *   --node <n> / --launch   面板节点与启动方式
 *   --timeout <s>           整体超时
 *   --stable-interval <s>   两次读数之间的间隔（默认 2.5 秒）
 *   --wait / --settle       额外等待
 *   --keep-open             跑完保留标签页
 *   --window <mode>         background（默认）/ foreground / isolated
 *   --help                  本说明
 *
 * 【必须知道的一条】指标区是分两拍渲染的：标签和占位值先挂上，真值几秒后才水合。
 * 所以本脚本读到**同一组数值连续若干次完全一致**才收下，`stable === false`
 * 时直接抛错而不是把最后一次读数当结论——静默的错数比一次显式超时坏得多。
 * 空态（「未找到匹配内容」）要连续确认 3 次才算数，因为它同样会在数据水合前短暂出现。
 *
 * `belowFloor: true` 是**结论**（数据源明说没有此站的数据），不是失败，别和「查不到」混为一谈。
 * 只有 performance 报表有 metrics：在渠道页上跑 deriveMetrics 会把筛选器文字当数值抓
 * （实测 globalRank 抓成 1），宁可不给也不要给错的。
 */
import { writeFile } from 'node:fs/promises';
import {
  closeSession,
  defaultSession,
  parseFlags,
  showHelpIfRequested,
  printJson,
  required,
  validateSession,
} from './opencli-core.mjs';
import { captureStable, expiryWarning, gotoInTool, launchTool, redactSecrets } from './lib-tools-share.mjs';
// 解析只有一份，住在 lib-similarweb.mjs。**这里曾经和 similarweb-batch.mjs 各抄一份**，
// 于是同一个错报 bug 要修两遍，实际只修了一遍。
import { compact, deriveChannels, deriveMetrics } from './lib-similarweb.mjs';

const flags = parseFlags(process.argv.slice(2));
showHelpIfRequested(flags, import.meta.url);
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


// launchTool 返回的 evalPage 已绑定会话，启动之后才可用。
let evaluate = null;

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
  //
  // **而且认到内容词也还不算数。** 这些页分两拍渲染：先挂标签和占位值，
  // 几秒后真值才水合进来（2026-08-23 实测：批量脚本把月访问 35 万的 mmradar.gg
  // 记成没数据）。所以就绪之后还要**连读两次解析结果完全一致**才收下，
  // 指纹就是要写出去的那个对象本身。
  const READY_MARKERS = {
    performance: '总访问量',
    channels: '渠道流量',
    'similar-sites': '相似度',
  };
  // 每张报表用**自己那份即将写进输出的数据**当指纹。similar-sites 没有解析器，
  // 就用整页文本（去掉空白差异）——它是静态的，两次一致即可信。
  const payloadOf = (bodyText) => {
    const lines = bodyText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (report === 'performance') return compact(deriveMetrics(lines));
    if (report === 'channels') return deriveChannels(lines);
    return { text: bodyText.replace(/\s+/g, ' ').trim() };
  };
  // **「一个字段都没解析出来」必须当成「还没渲染」，不能当成结论。**
  // compact() 把 null 去掉之后，空结果的形状就是 {}，而旧代码会把它照原样输出——
  // 报表看上去查成功了，metrics 是空的。
  const isEmptyPayload = (payload) => {
    if (report === 'performance') return Object.keys(payload).length === 0;
    if (report === 'channels') return !payload.totalFromChannels;
    return !payload.text;
  };
  const NO_DATA = /抱歉，未找到与该搜索匹配的内容|没有足够的数据|Not enough data|我们没有此网站的数据/;

  const settled = await captureStable({
    read: () => evaluate(`(() => ({
      url: location.href,
      title: document.title,
      bodyText: (document.body?.innerText || '').slice(0, 50000)
    }))()`),
    fingerprint: (cap) => {
      const text = String(cap?.bodyText || '');
      if (!String(cap?.url || '').includes(`key=${encodeURIComponent(domain)}`)) return null;
      if (!text.includes(READY_MARKERS[report])) {
        // 数据源正面说了「没有此网站的数据」——这是结论，不是失败，但要多确认一次。
        return NO_DATA.test(text) ? 'no-data' : null;
      }
      const payload = payloadOf(text);
      if (isEmptyPayload(payload)) return NO_DATA.test(text) ? 'no-data' : null;
      return JSON.stringify(payload);
    },
    // 空态比数字先出现，多要一次确认；否则一个还在加载的页会被判成「这个站没数据」。
    needed: (print) => (print === 'no-data' ? 3 : 2),
    timeoutMs,
    intervalMs: Number(flags['stable-interval'] || 2.5) * 1000,
  });
  if (!settled.stable) {
    // 两种失败要分开说：从没就绪（八成是节点/代理）vs 就绪了但数一直在变（占位值）。
    throw new Error(settled.fingerprint
      ? `The Similarweb ${report} report for ${domain} rendered but its values never settled across ` +
        `${settled.reads} reads — what is on screen is still placeholder. Rerun, or raise --timeout.`
      : `Timed out waiting for the Similarweb ${report} report for ${domain} after ${settled.reads} reads. ` +
        `Last URL: ${settled.capture?.url ? String(settled.capture.url).split('?')[0] : 'unknown'}.`);
  }
  const captured = settled.capture;
  const belowFloor = settled.fingerprint === 'no-data';
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
    // 读了几次才稳下来；偶发 4+ 次说明这个节点水合很慢，值得换。
    reads: settled.reads,
    // 数据源正面说了「没有此网站的数据」，且连着三次都这么说。**这是结论，不是失败**——
    // 但它和「查不到」必须区分开，所以单独一个字段，而不是一个空的 metrics。
    belowFloor,
    // 只有「网站表现」页有总访问量/排名/跳出率这些指标。在渠道页上跑 deriveMetrics
    // 会把筛选器里的字当成数值抓（实测 globalRank 抓成 1），宁可不给也不要给错的。
    ...(report === 'performance' && !belowFloor ? { metrics: compact(deriveMetrics(lines)) } : {}),
    ...(report === 'channels' && !belowFloor ? { channels: deriveChannels(lines) } : {}),
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
      // 三种成因三个码：从没渲染（代理/节点）、渲染了但数没稳（占位值）、其它。
      code: /never settled/i.test(error.message)
        ? 'values_never_settled'
        : /Timed out waiting for the (launched )?Similarweb/i.test(error.message)
          ? 'shared_proxy_blank_or_unavailable'
          : 'query_failed',
      // opencli 的报错里可能带着 __gmitm 令牌（它会打印活动会话的完整 URL）。
      message: redactSecrets(error.message),
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
