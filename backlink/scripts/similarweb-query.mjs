#!/usr/bin/env node
/**
 * similarweb-query.mjs —— 用已登录的 Tools Share 会话查一个域名的 Similarweb 报表。
 *
 * 用法：
 *   node scripts/similarweb-query.mjs --domain example.com
 *   node scripts/similarweb-query.mjs --domain example.com --report channels --out out.json
 *   node scripts/similarweb-query.mjs --self-test
 *
 * 参数：
 *   --domain <d>            必填（--self-test 时不需要）
 *   --report <r>            performance（默认）| channels | similar-sites | audience-geo | site-keywords
 *   --self-test             跑离线解析自检，不连浏览器，不需要 --domain
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
 * 空态（「未找到匹配内容」）是**页面正面渲染出来的一句话**，不是「读到 0 行」——
 * 这两者形状不同，见下面 fingerprint 处的长注释，别按同一条规则改。
 *
 * `belowFloor: true` 是**结论**（数据源明说没有此站的数据），不是失败，别和「查不到」混为一谈。
 * 只有 performance 报表有 metrics：在渠道页上跑 deriveMetrics 会把筛选器文字当数值抓
 * （实测 globalRank 抓成 1），宁可不给也不要给错的。
 */
import { writeFile } from 'node:fs/promises';
import {
  closeSession,
  resolveSession,
  parseFlags,
  showHelpIfRequested,
  printJson,
  required,
  validateSession,
} from './opencli-core.mjs';
import { captureStable, expiryWarning, gotoInTool, launchTool, redactSecrets } from './lib-tools-share.mjs';
// 解析只有一份，住在 lib-similarweb.mjs。**这里曾经和 similarweb-batch.mjs 各抄一份**，
// 于是同一个错报 bug 要修两遍，实际只修了一遍。
import {
  compact,
  deriveChannels,
  deriveGeoRows,
  deriveMetrics,
  deriveSiteKeywordRows,
  parseNumber,
  SW_GEO_TABLE_CELLS,
  SW_ROW_MAJOR_TABLE_CELLS,
} from './lib-similarweb.mjs';

/**
 * 数据源**正面渲染出来的**「查无此站」文案。这是一个 page-produced 的完成信号：
 * 页面必须先判定查无结果才会挂上它，骨架屏和未水合的空表都产不出这句话。
 * 提到模块作用域只为一件事——让 `--self-test` 能离线断言它，不用连浏览器。
 * 见 fingerprint 处的长注释和 <law-ref id="readiness-must-bind-to-this-query"/>。
 */
const NO_DATA = /抱歉，未找到与该搜索匹配的内容|没有足够的数据|Not enough data|我们没有此网站的数据/;

/**
 * 法则要求的另一半：**这句空态提示是本次查询产出的吗？**
 * 标签页是复用的，上一个域名的空态会原样留在 DOM 里。URL 里的 `key=` 是面板自己
 * 写的本次查询标识，绑定它，空态才归本次查询所有。
 */
function boundToThisQuery(url, target) {
  return String(url || '').includes(`key=${encodeURIComponent(target)}`);
}

const flags = parseFlags(process.argv.slice(2));
showHelpIfRequested(flags, import.meta.url);
if (flags['self-test']) {
  runSelfTest();
  process.exit(0);
}
const domain = normalizeDomain(required(flags, 'domain'));
const session = resolveSession(flags, 'similarweb-research', 'similarweb');
const REPORTS = new Set(['performance', 'similar-sites', 'channels', 'audience-geo', 'site-keywords']);
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
let launched;
try {
  // 启动一律走 lib-tools-share.mjs 的那一份。**之前这里自己写了一份简化版**：
  // 靠 logo 的 style 找卡片、直接点「打开」、不选节点。它漏掉了三个已知坑
  // （会话焊死、卡片无文字、节点会挂），于是稳定报 shared_proxy_blank_or_unavailable，
  // 而真正的原因每次都不一样。删掉重复实现之后这类误报才有唯一的排查入口。
  launched = await launchTool({
    session,
    tool: 'similarweb',
    node: flags.node,
    window: windowMode,
    wait: Number(flags.wait || 7),
    timeout: Number(flags.launchTimeout || 60),
    allowParallelSession: Boolean(flags['allow-parallel-session']),
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
    'audience-geo': '/#/digitalsuite/websiteanalysis/website-audience/*/999/6m?webSource=Total&selectedTab=geography&key=',
  };
  // 「网站关键词」页的 hash 不是「路径 + key=」这么简单：key 在前，pageFilter 在中间，
  // 都带域名，而且**这张页面上 6 个月的窗口会直接报错**（「出问题了 请重试或选择更短的
  // 日期范围」），必须用 1m。改 hash 从 6m 换成 1m 救不回已经报错的页面——
  // 只有一次全新的、一开始就是 1m 的跳转才行。
  const buildReportUrl = () => {
    if (report === 'site-keywords') {
      const pageFilter = encodeURIComponent(JSON.stringify([{ url: domain, searchType: 'domain' }]));
      return `${appOrigin}/#/organicsearch/pageAnalysis/website-keyword-v2/*/999/1m` +
        `?key=${encodeURIComponent(domain)}&pageFilter=${pageFilter}&webSource=Total&selectedPageTab=Total&comparedDuration=`;
    }
    return `${appOrigin}${REPORT_PATHS[report]}${encodeURIComponent(domain)}`;
  };
  // 这是 hash 路由的 SPA：换 hash 不会重新加载页面，所以深链之后必须等它自己渲染完。
  // 实测首屏要 15-20 秒，settle 给小了就会读到一个空 body 并被误判成"这个域名没数据"。
  await gotoInTool(evaluate, buildReportUrl(), Number(flags.settle || 12));

  // **轮询条件必须认「只有数据到了才会出现的字符串」。**
  // 之前这里认的是「网站表现」——那是左侧导航的菜单项，页面骨架一挂载就命中，
  // 于是轮询秒过、抓到一个还没渲染数值的 body，metrics 静默变成 {}，
  // 报表看上去查成功了，指标却一个都没有。导航词和内容词必须分清楚。
  //
  // **而且认到内容词也还不算数。** 这些页分两拍渲染：先挂标签和占位值，
  // 几秒后真值才水合进来（2026-08-23 实测：批量脚本把月访问 35 万的 mmradar.gg
  // 记成没数据）。所以就绪之后还要**连读两次解析结果完全一致**才收下，
  // 指纹就是要写出去的那个对象本身。
  //
  // **老实说清楚 audience-geo/site-keywords 这两个 marker 能保证什么、不能保证
  // 什么。** `受众群体份额`、`点击量` 都是表头文字本身，**不是**「只有数据到了
  // 才会出现」的字样——2026-08-27 实测：`点击量` 同时也出现在表格上方的筛选器
  // 里（`点击量变化` 这个 chip），骨架一渲染、表还是空的时候这两个字符串就已经
  // 在页面上了。这两个 marker 只是一道**省钱的预筛**：字符串都没出现时肯定没
  // 数据，不用白跑一次 cells 提取。**真正保证就绪的是下面 fingerprint 里
  // `isEmptyPayload` 那一步**——它要求解析出来的 `rows.length > 0` 且连读两次
  // 完全一致，这才是「表真的有数据而且数据稳定了」的证明。所以就算这两个字符串
  // 在空骨架上短暂命中，也不会被当成就绪，只会多等几轮直到 cells 提取出真行。
  const READY_MARKERS = {
    performance: '总访问量',
    channels: '渠道流量',
    'similar-sites': '相似度',
    'audience-geo': '受众群体份额',
    'site-keywords': '点击量',
  };
  // 表格类报表（audience-geo / site-keywords）不是按行文本解析的——这两张表分别是
  // 按列渲染的 `.swReactTable-column` 和 Ant Design 的 `.ant-table`，必须在页面里
  // 跑对应的提取器拿到结构化的 {headers, rows}，再交给 lib-similarweb.mjs 按列名解析。
  const CELL_EXTRACTORS = {
    'audience-geo': SW_GEO_TABLE_CELLS,
    'site-keywords': SW_ROW_MAJOR_TABLE_CELLS,
  };
  // 每张报表用**自己那份即将写进输出的数据**当指纹。similar-sites 没有解析器，
  // 就用整页文本（去掉空白差异）——它是静态的，两次一致即可信。
  const payloadOf = (cap) => {
    const bodyText = String(cap?.bodyText || '');
    if (report === 'performance') {
      const lines = bodyText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      return compact(deriveMetrics(lines));
    }
    if (report === 'channels') {
      const lines = bodyText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      return deriveChannels(lines);
    }
    if (report === 'audience-geo') return deriveGeoRows(cap?.cells);
    if (report === 'site-keywords') return deriveSiteKeywordRows(cap?.cells);
    return { text: bodyText.replace(/\s+/g, ' ').trim() };
  };
  // **「一个字段都没解析出来」必须当成「还没渲染」，不能当成结论。**
  // compact() 把 null 去掉之后，空结果的形状就是 {}，而旧代码会把它照原样输出——
  // 报表看上去查成功了，metrics 是空的。表格类报表用 rows.length 判断同一件事。
  const isEmptyPayload = (payload) => {
    if (report === 'performance') return Object.keys(payload).length === 0;
    if (report === 'channels') return !payload.totalFromChannels;
    if (report === 'audience-geo' || report === 'site-keywords') return !payload?.rows?.length;
    return !payload.text;
  };

  const settled = await captureStable({
    read: () => evaluate(`(() => ({
      url: location.href,
      title: document.title,
      bodyText: (document.body?.innerText || '').slice(0, 50000)${CELL_EXTRACTORS[report] ? `,
      cells: ${CELL_EXTRACTORS[report]}` : ''}
    }))()`),
    fingerprint: (cap) => {
      const text = String(cap?.bodyText || '');
      if (!boundToThisQuery(cap?.url, domain)) return null;
      if (!text.includes(READY_MARKERS[report])) {
        // 数据源正面说了「没有此网站的数据」——这是结论，不是失败，但要多确认一次。
        return NO_DATA.test(text) ? 'no-data' : null;
      }
      const payload = payloadOf(cap);
      if (isEmptyPayload(payload)) return NO_DATA.test(text) ? 'no-data' : null;
      return JSON.stringify(payload);
    },
    /**
     * 【2026-08-28 复核：这一处**不是**阈值赌博，不要「顺手」改成 inconclusive。】
     *
     * <law-ref id="readiness-must-bind-to-this-query"/> 打掉的是这个形状：
     * *读到空 N 次 / 等了 N 秒还是空 → 判空*。那里的证据是「什么都没有」，
     * 而一个还没开始渲染的区域天然就是「什么都没有」，所以证据为零。
     *
     * 这里的证据不是「没有」，是**有**：`NO_DATA` 匹配的是页面自己渲染出来的一句
     * 「我们没有此网站的数据 / 抱歉，未找到与该搜索匹配的内容」。骨架屏、占位符、
     * 还没水合的空表都产不出这句话——**页面必须先判定查无结果，才会把它挂上去**。
     * 按法则的话说：它是一个 positive、page-produced 的完成信号，和「表里有一个非空
     * 单元格」是同一个等级的证据，跟时长和读数不是一回事。
     *
     * 另一半（法则要求的「这是本次查询产出的吗」）由上面第一行的 URL 断言兜住：
     * 不含 `key=<本次查询的域名>` 一律返回 null，所以上一个域名残留在标签页里的
     * 那句空态提示，在这里根本进不了判定。
     *
     * 下面的 3 次重复因此**是冗余，不是判据**：判据是那句话本身。留着它的成本是几秒，
     * 收益是挡住一次偶发的读取抖动；删掉也不会让结论变得不可靠，但别反过来
     * 以为把它调大就能让「读到 0 行」变成可信的空态——那条路是被法则封死的。
     */
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
  // audience-geo 的「总数」（totalRowsOnPage）就是这张表的行总数，和 rowsRead
  // 说的是同一件事。site-keywords 的表头总数（pageReportedKeywordTotal）是这个
  // 站点全站收录的关键词数，跟这次读到多少行是两回事——两张报表的「总数」字段
  // 名字不同就是因为它们数的不是同一种东西，见 lib-similarweb.mjs 里对应函数
  // 顶部的注释。
  const geoResult = report === 'audience-geo' && !belowFloor ? deriveGeoRows(captured.cells) : null;
  const keywordsResult = report === 'site-keywords' && !belowFloor ? deriveSiteKeywordRows(captured.cells) : null;
  // site-keywords 是否被截断，问的是「这张表本身还有没有下一页」，不是关键词总数
  // 减去 rowsRead——那个数字根本不是同一种东西（见上面的注释）。只有在提取器
  // 真的在页面上看到了未禁用的「下一页」按钮时才报；`morePagesAvailable === null`
  // 说明分页控件没找到（比如页面本来就是单页，没有分页控件），这种「不知道」
  // 不该被当成「有更多页」去报警，也不该被当成「确认没有」而彻底沉默——
  // 所以下面单独打一行日志说明这次是哪种情况，跟 semrush-report.mjs 的
  // `[truncated]` 走同一种腔调。
  if (keywordsResult) {
    if (keywordsResult.morePagesAvailable === true) {
      // `totalPages`/`currentPage` 来自 Antd simple 分页器的 title 属性
      // （形如「1/389777」）——**不是** `.ant-pagination-total-text`，那个
      // class 只有用了 Antd 的 showTotal 才会渲染，这张页面没用，选择器永远
      // 查不到，是死代码路径。有了总页数就能说清楚「共几页，本次读了第几页」，
      // 跟 semrush-report.mjs 的 `共 201 页，本次只读了第 1 页` 是同一种腔调；
      // 拿不到总页数（分页器不是这个格式）就退化成只说「还有下一页」。
      console.error(
        keywordsResult.totalPages
          ? `[truncated] site-keywords ${domain}: 共 ${keywordsResult.totalPages} 页，本次只读了第 ` +
            `${keywordsResult.currentPage ?? 1} 页（${keywordsResult.rowsRead} 行）。`
          : `[truncated] site-keywords ${domain}: 表格还有下一页未读取，当前只有 ${keywordsResult.rowsRead} 行。`,
      );
    } else if (keywordsResult.morePagesAvailable === null) {
      console.error(
        `[truncated?] site-keywords ${domain}: 页面上没找到分页控件，无法确认这 ${keywordsResult.rowsRead} 行` +
        `是不是全部——不是「确认单页」，只是「没查到分页控件」。`,
      );
    }
    // morePagesAvailable === false：分页控件明确说没有下一页，这才是「确认单页」，不用提。
  }
  // audience-geo 反过来：`totalRowsOnPage` 和 `rowsRead` 说的是同一件事（都是
  // 这张表的行数），`deriveGeoRows` 自己的注释也写了「两者不等时通常是分页
  // 没翻完」——但之前这里从来没有谁真的去比较这两个数字，写了等于没写。
  // 独立检查报告点名：这是唯一一个「对比有意义」的报表，却是唯一一个不打
  // 任何提示的报表。
  if (geoResult) {
    if (geoResult.totalRowsOnPage !== null && geoResult.rowsRead < geoResult.totalRowsOnPage) {
      console.error(
        `[truncated] audience-geo ${domain}: 页面表头显示共 ${geoResult.totalRowsOnPage} 个国家/地区，` +
        `这次只解析出 ${geoResult.rowsRead} 行。`,
      );
    }
    // `SW_GEO_TABLE_CELLS` 用最短列的长度截断所有列——如果某一列在 DOM 里
    // 少渲染了几格，所有列都会被拖着从底部截断，且上面那条对比可能因为
    // totalRowsOnPage 本身没问题、只是行被砍了而看不出来（rowsRead 依然可能
    // 等于 totalRowsOnPage，如果被砍的行数正好不影响这个巧合）。这里单独报，
    // 不依赖上面那条数字对比。
    if (geoResult.columnDepthMismatch) {
      console.error(
        `[truncated?] audience-geo ${domain}: 提取器发现列长度不一致，已用最短列的长度截断——` +
        `当前 ${geoResult.rowsRead} 行可能不是全部，且具体丢了哪几个国家不确定。`,
      );
    }
  }
  // ---- 自洽校验（不需要第二个数据源的交叉验证）----------------------------
  // 这一段查的都是「页面自己说的话有没有互相打架」。真实事故的教训：missingColumns
  // 空、rowsRead 对得上、suspectColumns 空——三个信号一致地说「干净」，而 121 个
  // 国家里有 9 个的流量份额被静默丢掉了。单一信号查不出部分失败，得让几条互不
  // 依赖的路径同时说话。
  for (const [label, result] of [['audience-geo', geoResult], ['site-keywords', keywordsResult]]) {
    for (const loss of result?.partialLossColumns ?? []) {
      // **没有阈值**：占位符已经不进分母了，剩下的每一个 null 都是页面上确实
      // 印着内容、却被我们扔掉的格子。带上原文样本，否则没法排查缺的是哪种格式。
      console.error(
        `[partial-loss] ${label} ${domain}: 「${loss.column}」列有 ${loss.lost}/${loss.of} 行解析成 null，` +
        `原文样本：${loss.samples.map((v) => JSON.stringify(v)).join(', ')}。`,
      );
    }
  }
  if (geoResult?.trafficShareSum) {
    const { sum, contributing, ofRows } = geoResult.trafficShareSum;
    // 只有在「这张表确认读全了」的前提下，和才应该 ≈100——读了半张表当然不足
    // 100，那是截断问题，上面已经单独报过了，不该在这里重复报一次假警报。
    const complete = geoResult.totalRowsOnPage !== null
      && geoResult.rowsRead === geoResult.totalRowsOnPage
      && !geoResult.columnDepthMismatch;
    // 容差 2 个百分点：每行份额是四舍五入到 2 位显示的，121 行累积起来本身
    // 就有约 0.6 的漂移；`< 0.01%` 这类下限值又按上限取，会略微高估。
    if (complete && Math.abs(sum - 100) > 2) {
      console.error(
        `[sum-check] audience-geo ${domain}: 各国流量份额之和 ${sum}%（${contributing}/${ofRows} 行有数值），` +
        `偏离 100% 超过容差——要么有行的份额被丢掉了，要么这一列的单位解析错了。`,
      );
    }
  }
  if (keywordsResult?.totalPages && keywordsResult.pageReportedKeywordTotal) {
    // 同源异视图的等值检查：表头声明的全站关键词总数 ÷ 每页行数，应该约等于
    // 分页器声明的总页数。这两个数字来自页面上两个**完全不同**的地方，由两个
    // 互相不知道对方存在的解析器读出来，同时对得上就是互相印证。
    //
    // 这条检查以前是写在注释里的，理由是「怕误报把好数据拦下来」——但警告不是
    // 拦截，怕误报就不做检查，等于把唯一一条真等值验证路径关掉了。
    const ROWS_PER_PAGE = 100;
    const impliedPages = Math.ceil(keywordsResult.pageReportedKeywordTotal / ROWS_PER_PAGE);
    // 容差 1 页：末页不满、以及总数本身可能是估算值。
    if (Math.abs(impliedPages - keywordsResult.totalPages) > 1) {
      console.error(
        `[cross-check] site-keywords ${domain}: 表头总数 ${keywordsResult.pageReportedKeywordTotal} ` +
        `推出约 ${impliedPages} 页，分页器却说 ${keywordsResult.totalPages} 页——两个解析器里至少有一个不对。`,
      );
    }
  }

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
    ...(geoResult ? { geo: geoResult } : {}),
    ...(keywordsResult ? { keywords: keywordsResult } : {}),
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
  await launched?.releaseBrowserLocks();
  if (!keepOpen) await closeSession(session);
}

/**
 * 离线自检：不连浏览器，不需要 --domain。只验证 lib-similarweb.mjs 里两张新表的
 * 解析器——`deriveGeoRows` / `deriveSiteKeywordRows`——在实测样本上的行为，
 * 尤其是本文件顶部注释反复强调的那几条：占位符必须是 null 不是 0，列换位置
 * 不能换答案，改名/丢列必须显式进 missingColumns，且格式对不上时要落进
 * suspectColumns（而不是安安静静地全部 null）。
 *
 * 2026-08-27 那次真实检查戳穿了第一版 fixture：手打的样例表头/格子跟真实 DOM
 * 不一样（表头「(121)」前有没有空格、数字带不带千分位逗号、格子是斜杠分隔还是
 * 换行分隔），下面的 fixture 已经按检查报告里给出的真实形态改过。
 */
function runSelfTest() {
  const assertEqual = (label, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
      throw new Error(`similarweb-query self-test failed [${label}]\n  actual:   ${a}\n  expected: ${e}`);
    }
  };
  const assert = (label, cond) => {
    if (!cond) throw new Error(`similarweb-query self-test failed [${label}]`);
  };
  const swapCols = (headers, rows, i, j) => {
    const h = [...headers];
    [h[i], h[j]] = [h[j], h[i]];
    const r = rows.map((row) => {
      const copy = [...row];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
    return { headers: h, rows: r };
  };

  // ---------- audience-geo ----------
  // 真实页面**没有 `#` 列**（行号是隐式的），表头「(121)」前带一个空格——
  // 这是实测形态，不是猜的。
  const geoHeaders = ['国家/地区 (121)', '流量份额', '变动', '受众群体份额', '国家/地区排名', '访问持续时间', '页面数/访问'];
  const geoSampleRow = ['美国', '20.42%', '7.12%', '15.45%', '#13', '00:03:58', '3.75'];
  const geoRows1 = deriveGeoRows({ headers: geoHeaders, rows: [geoSampleRow] });
  assertEqual('geo sample row', geoRows1.rows[0], {
    rank: 1, // 不来自某一列，是行下标 + 1——真实页面没有名叫「#」的表头
    country: '美国',
    trafficSharePercent: 20.42,
    changePercent: 7.12,
    audienceSharePercent: 15.45,
    countryRank: 13,
    visitDuration: '00:03:58',
    visitDurationSeconds: 238,
    pagesPerVisit: 3.75,
  });
  assertEqual('geo totalRowsOnPage (space before paren)', geoRows1.totalRowsOnPage, 121);
  assertEqual('geo missingColumns (complete headers, no # expected)', geoRows1.missingColumns, []);
  assertEqual('geo suspectColumns (clean sample)', geoRows1.suspectColumns, []);

  // 表头跨两行渲染：第一行「国家/地区」，第二行「(121)」——同一个字符串里带真实换行。
  // 这曾经是 totalRowsOnPage 拿不到值的直接原因（提取器把第二行切掉了）。
  const geoHeadersTwoLine = ['国家/地区\n(121)', '流量份额', '变动', '受众群体份额', '国家/地区排名', '访问持续时间', '页面数/访问'];
  const geoRowsTwoLine = deriveGeoRows({ headers: geoHeadersTwoLine, rows: [geoSampleRow] });
  assertEqual('geo totalRowsOnPage (two-line header)', geoRowsTwoLine.totalRowsOnPage, 121);
  assertEqual('geo two-line header still matches by name', geoRowsTwoLine.missingColumns, []);
  assertEqual('geo two-line header country still parses', geoRowsTwoLine.rows[0].country, '美国');

  // 占位符（国家排名是「-」）必须是 null，不能是 0——这正是本文件事故记录里那一起。
  const geoPlaceholderRow = ['某国', '1%', '-', '1%', '-', '-', '-'];
  const geoRows2 = deriveGeoRows({ headers: geoHeaders, rows: [geoPlaceholderRow] });
  assert('geo placeholder countryRank is null not 0', geoRows2.rows[0].countryRank === null);
  assert('geo placeholder changePercent is null not 0', geoRows2.rows[0].changePercent === null);
  assert('geo placeholder visitDuration is null', geoRows2.rows[0].visitDuration === null);
  assert('geo placeholder visitDurationSeconds is null not 0', geoRows2.rows[0].visitDurationSeconds === null);
  assert('geo placeholder pagesPerVisit is null not 0', geoRows2.rows[0].pagesPerVisit === null);
  // 全是占位符是正常结果（这个站/这一行真的没有这项数据），不该被当成格式错误上报。
  assertEqual('geo all-placeholder columns are not flagged suspect', geoRows2.suspectColumns, []);

  // 打乱两列（表头和每行数据同步打乱）必须得到完全一样的解析结果——按列名取值的证明。
  const iShare = geoHeaders.indexOf('流量份额');
  const iDuration = geoHeaders.indexOf('访问持续时间');
  const shuffledGeo = swapCols(geoHeaders, [geoSampleRow], iShare, iDuration);
  const geoRows3 = deriveGeoRows(shuffledGeo);
  assertEqual('geo shuffled columns match original', geoRows3.rows[0], geoRows1.rows[0]);

  // 改名一列必须显式进 missingColumns，且该字段变 null，而不是被下一列顶替。
  const geoHeadersRenamed = geoHeaders.map((h) => (h === '国家/地区 (121)' ? '国家/地区 (121)-renamed' : h));
  const geoRows4 = deriveGeoRows({ headers: geoHeadersRenamed, rows: [geoSampleRow] });
  assert('geo renamed column surfaces in missingColumns', geoRows4.missingColumns.includes('国家/地区'));
  assert('geo renamed column nulls the field', geoRows4.rows[0].country === null);
  // 其余列没被牵连——排在被改名列后面的字段应该照常解析，证明没有整体错位。
  assertEqual('geo renamed column does not shift others', geoRows4.rows[0].trafficSharePercent, 20.42);

  // suspectColumns：列名对上了（不在 missingColumns 里），但格式跟解析函数的假设不一样，
  // 导致这一列在所有行上都解析成 null——这正是 missingColumns 查不出来的那类问题。
  const geoBadFormatRows = [
    ['美国', 'abc', '7.12%', '15.45%', '#13', '00:03:58', '3.75'],
    ['日本', 'xyz', '7.12%', '15.45%', '#14', '00:03:58', '3.75'],
  ];
  const geoRows5 = deriveGeoRows({ headers: geoHeaders, rows: geoBadFormatRows });
  assert('geo bad-format column not in missingColumns (name matched)', !geoRows5.missingColumns.includes('流量份额'));
  assert('geo bad-format column surfaces in suspectColumns', geoRows5.suspectColumns.includes('流量份额'));

  // ---------- 部分丢失检测（回归：把已修的事故重新注入）----------
  // 2026-08-27 事故复刻：121 个国家里 9 个的份额格式解析不了。
  // 关键点是**旧检测器必须在同一份数据上保持沉默**——如果它也报了，
  // 这个用例就没有证明任何新增能力，只是重复覆盖。
  const injectedHeaders = ['国家/地区 (121)', '流量份额', '变动', '受众群体份额', '国家/地区排名', '访问持续时间', '页面数/访问'];
  const injectedRows = Array.from({ length: 121 }, (_, i) => [
    `C${i}`, i >= 112 ? 'under 0.01%' : '0.82%', '-', '1%', `#${i + 1}`, '00:01:00', '2',
  ]);
  const injected = deriveGeoRows({ headers: injectedHeaders, rows: injectedRows });
  assertEqual('injected loss: 旧的过半阈值检测器保持沉默（这正是事故当时的状态）', injected.suspectColumns, []);
  assertEqual('injected loss: missingColumns 也是空的（列名找得到）', injected.missingColumns, []);
  assertEqual('injected loss: 行数完全对得上（截断检测同样无感）', injected.rowsRead, injected.totalRowsOnPage);
  assertEqual('injected loss: 新检测器报出丢失行数', injected.partialLossColumns[0]?.lost, 9);
  assert('injected loss: 报告带上原文样本，否则没法排查缺哪种格式',
    injected.partialLossColumns[0]?.samples.includes('under 0.01%'));
  // 第二条独立路径：求和。它和列检测互不依赖，两条同时响才算交叉验证。
  assert('injected loss: 份额之和明显偏离 100%', Math.abs(injected.trafficShareSum.sum - 100) > 2);

  // 反面用例：数据干净时两条路径都必须闭嘴，否则这个检测器会因为噪音被无视。
  const cleanRows = Array.from({ length: 100 }, (_, i) => [
    `C${i}`, '1%', '-', '1%', `#${i + 1}`, '00:01:00', '2',
  ]);
  const clean = deriveGeoRows({ headers: ['国家/地区 (100)', '流量份额', '变动', '受众群体份额', '国家/地区排名', '访问持续时间', '页面数/访问'], rows: cleanRows });
  assertEqual('clean geo: 无部分丢失', clean.partialLossColumns, []);
  assertEqual('clean geo: 份额之和正好 100', clean.trafficShareSum.sum, 100);
  // 整列占位符不算丢失——它们不进分母，这是 NO_VALUE 那条统一定义在守的事。
  const allPlaceholder = deriveGeoRows({
    headers: ['国家/地区 (2)', '流量份额', '变动', '受众群体份额', '国家/地区排名', '访问持续时间', '页面数/访问'],
    rows: [['A', '50%', '-', '不可用', '#1', '00:01:00', '2'], ['B', '50%', '-', 'N/A', '#2', '00:01:00', '2']],
  });
  assertEqual('placeholder 列不算部分丢失', allPlaceholder.partialLossColumns, []);

  // ---------- site-keywords ----------
  // 真实表头：「关键词 (38,977,695)」——空格 + 千分位逗号，这正是原版 fixture 漏掉、
  // 导致 keyword 整表 null 的那两处细节。
  // 列顺序照实测 DOM dump 抄，不要按散文描述重排——尾部「变动」的左邻是「排位」，
  // 曾有一版夹具漏掉「排位」，据此推出的锚点结论是错的，实跑才暴露。
  const kwHeaders = ['#', '关键词 (38,977,695)', '点击量', '变动', 'KD', '意图', '规模', '平均体量', 'CPC', '零点击', '比较', '排位', '变动', '热门网址', '#URL'];
  // 点击量格子是换行分隔的「9.9M\n0.32%」，不是斜杠——这是原版 fixture 猜错的地方。
  // 值的位置跟着上面的表头顺序走：… 比较 | 排位 | 变动 | 热门网址 | #URL
  // 实测该目标站点的「排位」与其「变动」两列整列都是占位符，这里给「变动」一个
  // 真值以便断言锚点确实解析出了排名涨跌；占位符情形另有独立用例覆盖。
  const kwSampleRow = ['1', 'facebook', '9.9M\n0.32%', '↑25%', '94', 'NAV/INFO', '295.2M', '294.8M', '$1.14', '14.54%', '-', '-', '+6', 'en.wikipedia.org/wiki/Facebook', '79'];
  const kwRows1 = deriveSiteKeywordRows({ headers: kwHeaders, rows: [kwSampleRow] });
  assertEqual('site-keywords sample row (newline-separated clicks)', kwRows1.rows[0], {
    keyword: 'facebook',
    clicks: 9900000,
    clicksSharePercent: 0.32,
    clicksChangePercent: 25,
    kd: 94,
    intent: ['NAV/INFO'],
    size: 295200000,
    avgVolume: 294800000,
    cpc: 1.14,
    zeroClickPercent: 14.54,
    rankChangePercent: 6,
    topUrl: 'en.wikipedia.org/wiki/Facebook',
    urlCount: 79,
  });
  assertEqual('site-keywords pageReportedKeywordTotal (space + thousands separator)', kwRows1.pageReportedKeywordTotal, 38977695);
  assertEqual('site-keywords missingColumns (complete headers)', kwRows1.missingColumns, []);
  assertEqual('site-keywords suspectColumns (clean sample)', kwRows1.suspectColumns, []);

  // 斜杠分隔仍然要接受——万一某个变体页面真是这么渲染的，不能因为换成认换行就反过来丢了斜杠。
  const kwSlashRow = ['1', 'facebook', '9.9M/0.32%', '↑25%', '94', 'NAV/INFO', '295.2M', '294.8M', '$1.14', '14.54%', '-', 'en.wikipedia.org/wiki/Facebook', '79', '+6'];
  const kwRowsSlash = deriveSiteKeywordRows({ headers: kwHeaders, rows: [kwSlashRow] });
  assertEqual('site-keywords slash-separated clicks still parses', kwRowsSlash.rows[0].clicks, 9900000);
  assertEqual('site-keywords slash-separated share still parses', kwRowsSlash.rows[0].clicksSharePercent, 0.32);

  // 占位符（这里用零点击列举例）必须是 null，不是 0。
  const kwPlaceholderRow = ['1', 'facebook', '9.9M\n0.32%', '↑25%', '94', 'NAV/INFO', '295.2M', '294.8M', '$1.14', '-', '-', 'en.wikipedia.org/wiki/Facebook', '79', '+6'];
  const kwRows2 = deriveSiteKeywordRows({ headers: kwHeaders, rows: [kwPlaceholderRow] });
  assert('site-keywords placeholder zeroClickPercent is null not 0', kwRows2.rows[0].zeroClickPercent === null);
  assertEqual('site-keywords all-placeholder column not flagged suspect', kwRows2.suspectColumns, []);

  // 打乱两个单义列名（KD / CPC），不动那两个重名的「变动」，输出必须完全一致。
  const iKd = kwHeaders.indexOf('KD');
  const iCpc = kwHeaders.indexOf('CPC');
  const shuffledKw = swapCols(kwHeaders, [kwSampleRow], iKd, iCpc);
  const kwRows3 = deriveSiteKeywordRows(shuffledKw);
  assertEqual('site-keywords shuffled columns match original', kwRows3.rows[0], kwRows1.rows[0]);

  // 改名「关键词」列必须显式进 missingColumns，且该字段变 null。
  const kwHeadersRenamed = kwHeaders.map((h) => (h === '关键词 (38,977,695)' ? '关键词 (38,977,695)-renamed' : h));
  const kwRows4 = deriveSiteKeywordRows({ headers: kwHeadersRenamed, rows: [kwSampleRow] });
  assert('site-keywords renamed column surfaces in missingColumns', kwRows4.missingColumns.includes('关键词'));
  assert('site-keywords renamed column nulls the field', kwRows4.rows[0].keyword === null);

  // suspectColumns 覆盖「点击量」这个特判列——2026-08-27 真实事故正是这一列：
  // 列名对上了（不进 missingColumns），格式却跟解析函数的假设不一样（这里用分号
  // 模拟一种解析器不认识的分隔符），于是所有行都解析成 null。
  const kwBadClicksRow = ['1', 'facebook', '9.9M;0.32%', '↑25%', '94', 'NAV/INFO', '295.2M', '294.8M', '$1.14', '14.54%', '-', 'en.wikipedia.org/wiki/Facebook', '79', '+6'];
  const kwRowsBadClicks = deriveSiteKeywordRows({ headers: kwHeaders, rows: [kwBadClicksRow] });
  assert('site-keywords bad-format clicks not in missingColumns (name matched)', !kwRowsBadClicks.missingColumns.includes('点击量'));
  assert('site-keywords bad-format clicks surfaces in suspectColumns', kwRowsBadClicks.suspectColumns.includes('点击量'));

  // top5SharePercent：五行都带份额时正常累加；只有 4 行带份额时必须是 null，不是部分和。
  // 用换行分隔的格子——这正是协调者要求补的那条：newline 形式也要能喂出非 null 的结果。
  const shareRow = (clicks, share) => ['1', 'kw', `${clicks}\n${share}%`, '+1%', '10', 'NAV', '1', '1', '$1', '1%', '-', 'x.com', '1', '+1'];
  const fiveRows = [shareRow('1M', 1), shareRow('1M', 2), shareRow('1M', 3), shareRow('1M', 4), shareRow('1M', 5)];
  const kwRows5 = deriveSiteKeywordRows({ headers: kwHeaders, rows: fiveRows });
  assert('top5SharePercent is non-null for five newline-form cells', kwRows5.top5SharePercent !== null);
  assertEqual('top5SharePercent sums five newline-form rows', kwRows5.top5SharePercent, 15);
  const fourRows = fiveRows.slice(0, 4);
  const kwRows6 = deriveSiteKeywordRows({ headers: kwHeaders, rows: fourRows });
  assert('top5SharePercent is null with fewer than five rows carrying a share', kwRows6.top5SharePercent === null);

  // ---------- 浮点伪影：132.8M 必须落地为精确整数，不是 132800000.00000001 ----------
  assertEqual('parseNumber rounds compact-suffix counts', parseNumber('132.8M'), 132800000);
  assert('parseNumber rounded result has no floating-point remainder', Number.isInteger(parseNumber('132.8M')));
  // 没有后缀的普通小数不该被圆整——CPC、份额百分比这类字段允许有小数部分。
  assertEqual('parseNumber leaves plain decimals alone', parseNumber('1.14'), 1.14);
  const kwSizeRow = ['1', 'facebook', '9.9M\n0.32%', '↑25%', '94', 'NAV/INFO', '132.8M', '294.8M', '$1.14', '14.54%', '-', 'en.wikipedia.org/wiki/Facebook', '79', '+6'];
  const kwRowsSize = deriveSiteKeywordRows({ headers: kwHeaders, rows: [kwSizeRow] });
  assertEqual('site-keywords size (132.8M) is an exact integer', kwRowsSize.rows[0].size, 132800000);
  assert('site-keywords size has no floating-point remainder', Number.isInteger(kwRowsSize.rows[0].size));

  // ---------- site-keywords 分页：pageReportedKeywordTotal 不是行数，不能拿它当截断信号 ----------
  // 没有分页控件（提取器没找到 `.ant-pagination-next`）时 pagination 是 null，
  // 代表「不知道有没有更多页」，不能当成「确认只有一页」。
  const kwRowsNoPagination = deriveSiteKeywordRows({ headers: kwHeaders, rows: [kwSampleRow], pagination: null });
  assert('morePagesAvailable is null (unknown) without a pagination control', kwRowsNoPagination.morePagesAvailable === null);
  // 分页控件明确说「有下一页」——必须报告，且要能从 title 读出页码。
  // 夹具用实测到的真实形态 `1/389777`（Antd simple 分页器的 title 属性），
  // 不用手打的「共 250 条」——那是 `.ant-pagination-total-text` 的形态，
  // 而实测证明该 class 在这张页面上永远不存在。
  const kwRowsHasNext = deriveSiteKeywordRows({
    headers: kwHeaders, rows: [kwSampleRow], pagination: { hasNext: true, pagerTitle: '1/389777' },
  });
  assert('morePagesAvailable is true when the pagination control has a live next button', kwRowsHasNext.morePagesAvailable === true);
  assertEqual('currentPage comes from the simple pager title', kwRowsHasNext.currentPage, 1);
  assertEqual('totalPages comes from the simple pager title', kwRowsHasNext.totalPages, 389777);
  // 交叉印证：全站收录数 / 每页 100 行 ≈ 总页数。两个数来自页面上完全不同的位置，
  // 对得上就是互相佐证；对不上说明其中一个解析器漂移了。
  assert('the keyword total and the pager total corroborate each other',
    Math.abs(kwRowsHasNext.pageReportedKeywordTotal / 100 - kwRowsHasNext.totalPages) < 1);
  // title 格式不认识时不许瞎猜一个页码出来。
  const kwRowsOddPager = deriveSiteKeywordRows({
    headers: kwHeaders, rows: [kwSampleRow], pagination: { hasNext: true, pagerTitle: '共 250 条' },
  });
  assert('an unrecognised pager title yields null pages rather than a guess',
    kwRowsOddPager.currentPage === null && kwRowsOddPager.totalPages === null);
  // 分页控件明确说「没有下一页」——这才是真正「确认单页」，不该被当成截断报出来。
  const kwRowsNoNext = deriveSiteKeywordRows({ headers: kwHeaders, rows: [kwSampleRow], pagination: { hasNext: false, pagerTitle: null } });
  assert('morePagesAvailable is false when the pagination control confirms there is no next page', kwRowsNoNext.morePagesAvailable === false);
  // pageReportedKeywordTotal 依然是全站收录数，不受分页信号影响——两个字段互不干扰。
  assertEqual('pageReportedKeywordTotal is unaffected by pagination info', kwRowsHasNext.pageReportedKeywordTotal, 38977695);

  // ---------- BLOCKING 1：两个「变动」列按左邻列消歧，不按位置 ----------
  // 独立检查报告实测戳穿过按位置分配的版本：去掉尾部那个「变动」（#URL 涨跌）后，
  // 剩下唯一一个「变动」左边是「点击量」，必须正确认成 clicksChangePercent，
  // 且 rankChangePercent 必须是 null 并且 missingColumns 里要有「#URL变动」——
  // 不能因为只剩一列就把它安在错的字段上还不报错。
  // 按索引精确移除尾部那个「变动」——不能用 slice(0,-1)，实测表头里「变动」后面
  // 还跟着「热门网址」和「#URL」，砍最后一个会砍错列。
  const changeIdxAll = kwHeaders.reduce((acc, h, i) => (h === '变动' ? [...acc, i] : acc), []);
  const trailingChangeIdx = changeIdxAll[changeIdxAll.length - 1];
  const kwHeadersNoTrailingChange = kwHeaders.filter((_, i) => i !== trailingChangeIdx);
  const kwRowNoTrailingChange = kwSampleRow.filter((_, i) => i !== trailingChangeIdx);
  const kwRowsNoTrailingChange = deriveSiteKeywordRows({ headers: kwHeadersNoTrailingChange, rows: [kwRowNoTrailingChange] });
  assertEqual('only the 点击量-变动 column present: clicksChangePercent still correct', kwRowsNoTrailingChange.rows[0].clicksChangePercent, 25);
  assert('only the 点击量-变动 column present: rankChangePercent is null, not stolen', kwRowsNoTrailingChange.rows[0].rankChangePercent === null);
  assert('only the 点击量-变动 column present: missing 排位变动 is reported', kwRowsNoTrailingChange.missingColumns.includes('排位变动'));
  assert('only the 点击量-变动 column present: 点击量变动 is not falsely reported missing', !kwRowsNoTrailingChange.missingColumns.includes('点击量变动'));

  // 反过来：去掉第一个「变动」（点击量涨跌），剩下唯一一个「变动」左边是
  // 「#URL」。这正是原来那个 bug 的实测复现——旧代码会把这唯一的一列错认成
  // clicksChangePercent（吐出 6，其实是 URL 数的涨跌），现在必须认成
  // rankChangePercent，clicksChangePercent 必须是 null。
  const changeIndicesInHeaders = kwHeaders.reduce((acc, h, i) => (h === '变动' ? [...acc, i] : acc), []);
  const leadingChangeIdx = changeIndicesInHeaders[0];
  const kwHeadersNoLeadingChange = kwHeaders.filter((_, i) => i !== leadingChangeIdx);
  const kwRowNoLeadingChange = kwSampleRow.filter((_, i) => i !== leadingChangeIdx);
  const kwRowsNoLeadingChange = deriveSiteKeywordRows({ headers: kwHeadersNoLeadingChange, rows: [kwRowNoLeadingChange] });
  assert('only the 排位-变动 column present: clicksChangePercent is null, NOT wrongly 6', kwRowsNoLeadingChange.rows[0].clicksChangePercent === null);
  assertEqual('only the 排位-变动 column present: rankChangePercent is correctly 6', kwRowsNoLeadingChange.rows[0].rankChangePercent, 6);
  assert('only the 排位-变动 column present: missing 点击量变动 is reported', kwRowsNoLeadingChange.missingColumns.includes('点击量变动'));
  assert('only the 排位-变动 column present: 排位变动 is not falsely reported missing', !kwRowsNoLeadingChange.missingColumns.includes('排位变动'));

  // 消歧是按左邻列，不是按位置——把「点击量,变动」这一对整体挪到表尾，
  // 「变动」仍然要因为左边是「点击量」而认成 clicksChangePercent。
  const kwHeadersReordered = ['#', 'KD', '意图', '规模', '平均体量', 'CPC', '零点击', '比较', '排位', '变动', '热门网址', '#URL', '关键词 (38,977,695)', '点击量', '变动'];
  const kwRowReordered = ['1', '94', 'NAV/INFO', '295.2M', '294.8M', '$1.14', '14.54%', '-', '-', '+6', 'en.wikipedia.org/wiki/Facebook', '79', 'facebook', '9.9M\n0.32%', '↑25%'];
  const kwRowsReordered = deriveSiteKeywordRows({ headers: kwHeadersReordered, rows: [kwRowReordered] });
  assertEqual('reordered columns: clicksChangePercent still found by left-neighbour, not position', kwRowsReordered.rows[0].clicksChangePercent, 25);
  assertEqual('reordered columns: rankChangePercent still found by left-neighbour, not position', kwRowsReordered.rows[0].rankChangePercent, 6);
  assertEqual('reordered columns: missingColumns empty', kwRowsReordered.missingColumns, []);

  // 消歧失败：一个「变动」列左边既不是「点击量」也不是「#URL」——不能瞎猜安给
  // 任意一个字段，必须报进 suspectColumns，且两个变动字段都不该被这一列污染。
  const kwHeadersAmbiguousChange = ['#', '关键词 (38,977,695)', '点击量', 'KD', '变动', '意图', '规模', '平均体量', 'CPC', '零点击', '比较', '热门网址', '#URL', '排位'];
  const kwRowAmbiguousChange = ['1', 'facebook', '9.9M\n0.32%', '94', '↑25%', 'NAV/INFO', '295.2M', '294.8M', '$1.14', '14.54%', '-', 'en.wikipedia.org/wiki/Facebook', '79'];
  const kwRowsAmbiguousChange = deriveSiteKeywordRows({ headers: kwHeadersAmbiguousChange, rows: [kwRowAmbiguousChange] });
  assert('unresolvable 变动 column is not assigned to clicksChangePercent', kwRowsAmbiguousChange.rows[0].clicksChangePercent === null);
  assert('unresolvable 变动 column is not assigned to rankChangePercent', kwRowsAmbiguousChange.rows[0].rankChangePercent === null);
  assert('unresolvable 变动 column surfaces in suspectColumns', kwRowsAmbiguousChange.suspectColumns.includes('变动(左邻列无法识别)'));

  // ---------- 非阻塞修复：占位符定义统一、parseNumber 的 NaN 归零、suspectColumns 比例阈值 ----------
  // 「不可用」现在和「-」「—」「--」是同一个占位符集合：country/topUrl 不该把
  // 字符串「不可用」当真实值输出，而且这种列不该被 findSuspectColumns 误判。
  // 值位置跟 kwHeaders 走：… 比较 | 排位 | 变动 | 热门网址 | #URL
  const kwRowUnavailable = ['1', '不可用', '9.9M\n0.32%', '↑25%', '94', 'NAV/INFO', '295.2M', '294.8M', '$1.14', '14.54%', '-', '-', '+6', '不可用', '79'];
  const kwRowsUnavailable = deriveSiteKeywordRows({ headers: kwHeaders, rows: [kwRowUnavailable] });
  assert('"不可用" keyword becomes null, not the literal string', kwRowsUnavailable.rows[0].keyword === null);
  assert('"不可用" topUrl becomes null, not the literal string', kwRowsUnavailable.rows[0].topUrl === null);
  assertEqual('an all-"不可用" column is not falsely flagged suspect', kwRowsUnavailable.suspectColumns, []);

  // 「< 0.01%」是「有值但低于下限」，不是「没有值」。实测 121 个国家里有 9 个是
  // 这个形态；旧版把它们全判成 null，而 9/121=7.4% 低于 suspectColumns 的 50% 阈值，
  // 连告警都没有——静默丢真实数据且无信号。取下限值本身。
  assertEqual('below-bound "< 0.01%" keeps the bound, not null', parseNumber('< 0.01%'), 0.01);
  assertEqual('below-bound without space and percent', parseNumber('<0.01'), 0.01);
  assertEqual('below-bound with full-width less-than', parseNumber('＜ 0.01%'), 0.01);
  const geoBelowBound = deriveGeoRows({
    headers: geoHeaders,
    rows: [['美国', '< 0.01%', '7.12%', '< 0.01%', '#13', '00:03:58', '3.75']],
  });
  assertEqual('geo below-bound trafficShare survives as a number', geoBelowBound.rows[0].trafficSharePercent, 0.01);
  assertEqual('geo below-bound audienceShare survives as a number', geoBelowBound.rows[0].audienceSharePercent, 0.01);

  // parseNumber 对 "1.2.3" 这种畸形数字必须归零成 null，不能变成 NaN 悄悄溜进 JSON。
  assert('parseNumber normalises a malformed number to null, not NaN', parseNumber('1.2.3') === null);
  const kwRowMalformedKd = ['1', 'facebook', '9.9M\n0.32%', '↑25%', '1.2.3', 'NAV/INFO', '295.2M', '294.8M', '$1.14', '14.54%', '-', 'en.wikipedia.org/wiki/Facebook', '79', '+6'];
  const kwRowsMalformedKd = deriveSiteKeywordRows({ headers: kwHeaders, rows: [kwRowMalformedKd] });
  assert('a malformed KD cell parses to null, not NaN', kwRowsMalformedKd.rows[0].kd === null);
  assert('null (not NaN) JSON-serialises as null so it still reads as null downstream', JSON.stringify(kwRowsMalformedKd.rows[0].kd) === 'null');

  // suspectColumns 现在按比例判断（超过一半 null），不要求「全部」——能抓住只有
  // 部分行解析失败的情况（比如换了种负号写法，只有负数那部分坏掉）。
  const kwRatioRows = [
    ['1', 'kw1', '1M\n1%', '+1%', '10', 'NAV', '1', '1', '$1', '1%', '-', 'x.com', '1', '+1'],
    ['1', 'kw2', '1M\n1%', '+1%', '10', 'NAV', '1', '1', '$1', '1%', '-', 'x.com', '1', '+1'],
    ['1', 'kw3', '1M\n1%', '+1%', 'bad-format', 'NAV', '1', '1', '$1', '1%', '-', 'x.com', '1', '+1'],
    ['1', 'kw4', '1M\n1%', '+1%', 'bad-format', 'NAV', '1', '1', '$1', '1%', '-', 'x.com', '1', '+1'],
    ['1', 'kw5', '1M\n1%', '+1%', 'bad-format', 'NAV', '1', '1', '$1', '1%', '-', 'x.com', '1', '+1'],
  ];
  const kwRowsRatio = deriveSiteKeywordRows({ headers: kwHeaders, rows: kwRatioRows });
  assert('a column with >50% (but not 100%) real-value failures is flagged suspect', kwRowsRatio.suspectColumns.includes('KD'));
  // 这组只有 1/5 行的 KD 失败（20%），不该被标为可疑——阈值是「超过一半」。
  const badOnlyOne = [
    ['1', 'kw1', '1M\n1%', '+1%', '10', 'NAV', '1', '1', '$1', '1%', '-', 'x.com', '1', '+1'],
    ['1', 'kw2', '1M\n1%', '+1%', '10', 'NAV', '1', '1', '$1', '1%', '-', 'x.com', '1', '+1'],
    ['1', 'kw3', '1M\n1%', '+1%', '10', 'NAV', '1', '1', '$1', '1%', '-', 'x.com', '1', '+1'],
    ['1', 'kw4', '1M\n1%', '+1%', '10', 'NAV', '1', '1', '$1', '1%', '-', 'x.com', '1', '+1'],
    ['1', 'kw5', '1M\n1%', '+1%', 'bad-format', 'NAV', '1', '1', '$1', '1%', '-', 'x.com', '1', '+1'],
  ];
  const kwRowsBadOnlyOne = deriveSiteKeywordRows({ headers: kwHeaders, rows: badOnlyOne });
  assert('a column with only 20% real-value failures is NOT flagged suspect', !kwRowsBadOnlyOne.suspectColumns.includes('KD'));

  // 排位变动 这一列独立检查报告确认过是「这个目标站点真的 100% 没有排名变化」，
  // 不是解析失败——全是占位符（分母是 0）不该被 ratio 阈值当成可疑。
  assertEqual('a genuinely all-placeholder rankChangePercent column is not flagged suspect', kwRows1.suspectColumns, []);

  // ---------- BLOCKING 2：audience-geo 的截断信号 ----------
  // totalRowsOnPage 和 rowsRead 不一致时，deriveGeoRows 必须把两个数字都吐出来，
  // 让调用方（similarweb-query.mjs 的主流程）能对比着打 [truncated]。
  const geoHeadersForTruncation = ['国家/地区 (5)', '流量份额', '变动', '受众群体份额', '国家/地区排名', '访问持续时间', '页面数/访问'];
  const geoRowsTruncated = deriveGeoRows({ headers: geoHeadersForTruncation, rows: [geoSampleRow, geoSampleRow] });
  assertEqual('geo totalRowsOnPage reports what the page header says', geoRowsTruncated.totalRowsOnPage, 5);
  assertEqual('geo rowsRead reports what was actually parsed', geoRowsTruncated.rowsRead, 2);
  assert('geo totalRowsOnPage/rowsRead mismatch is visible to the caller', geoRowsTruncated.totalRowsOnPage > geoRowsTruncated.rowsRead);

  // columnDepthMismatch：提取器发现列长度不一致时要传出来，deriveGeoRows 要透传
  // 成一个布尔值；没给这个字段（比如旧版 cells）时是 null，不是「确认一致」。
  const geoRowsMismatch = deriveGeoRows({ headers: geoHeaders, rows: [geoSampleRow], columnDepthMismatch: true });
  assertEqual('columnDepthMismatch true is passed through', geoRowsMismatch.columnDepthMismatch, true);
  const geoRowsNoMismatch = deriveGeoRows({ headers: geoHeaders, rows: [geoSampleRow], columnDepthMismatch: false });
  assertEqual('columnDepthMismatch false is passed through', geoRowsNoMismatch.columnDepthMismatch, false);
  const geoRowsUnknownMismatch = deriveGeoRows({ headers: geoHeaders, rows: [geoSampleRow] });
  assertEqual('columnDepthMismatch is null (unknown), not false, when the extractor did not report it', geoRowsUnknownMismatch.columnDepthMismatch, null);

  // ---- 空态判据：它是「页面产出的一句话」，不是「读到 0 行」 ----
  // 见 <law-ref id="readiness-must-bind-to-this-query"/>。这几条断言在锁两件事：
  // (1) 触发空态的是明确的文案，加载/骨架屏文本一律不触发；
  // (2) 空态只有绑定到本次查询的 URL 才作数——上一个域名残留的提示进不来。
  assert('no-data 认的是页面正面写出来的那句话', NO_DATA.test('抱歉，未找到与该搜索匹配的内容'));
  assert('英文空态同样认', NO_DATA.test('Not enough data to display'));
  assert('「我们没有此网站的数据」同样认', NO_DATA.test('我们没有此网站的数据'));
  // 骨架屏 / 加载中 / 空表：什么都没有，不是「说了没有」。这里必须**不**匹配，
  // 否则「还没渲染」就会被当成「查无此站」——正是法则打掉的那个形状。
  assert('加载中的骨架屏不算空态', !NO_DATA.test('总访问量\n加载中…\n\n\n'));
  assert('一张空表不算空态', !NO_DATA.test('国家/地区\n流量份额\n变动'));
  assert('空 body 不算空态', !NO_DATA.test(''));
  assert('空态绑定本次查询的 key', boundToThisQuery('https://x/#/a/b?key=example.com', 'example.com'));
  assert('上一个域名残留的空态不算数', !boundToThisQuery('https://x/#/a/b?key=other.com', 'example.com'));
  assert('没有 key 段一律不作数', !boundToThisQuery('https://x/#/a/b', 'example.com'));

  console.log('similarweb-query self-test: PASS');
}
