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
 * **本脚本没有「全球」选项，`organicTraffic` 永远是某一个国家库的估算。**
 * 不传 `--db` 不等于拿到全球合计——Semrush 只是回落到它自己的默认库，输出里的
 * `db: null` 意味着「不知道是哪个国家」，不是「已加总所有国家」。域名维度（本脚本、
 * semrush-batch.mjs、semrush-report.mjs）目前没有 semrush-keyword.mjs 那样的
 * `globalVolume` 字段；要估算全球规模只能用别的口径按国家占比换算（见
 * `backlink/references/authorized-data-sources.md`）。Semrush 网页版是否提供
 * 「Worldwide」库选择尚未验证，不要替它下结论。
 *
 * 用法：
 *   node semrush-overview.mjs --domain example.com [--db jp] [--subdomain] [--node 5]
 *   # 不传 --db 会走 Semrush 自己的默认库（未必是你想要的那个国家），脚本会警告一次
 */
import { resolveSession, parseFlags, showHelpIfRequested, printJson, required, validateSession } from './opencli-core.mjs';
import { captureStable, expiryWarning, gotoInTool, launchTool, redactSecrets } from './lib-tools-share.mjs';
import { writeFile } from 'node:fs/promises';

const flags = parseFlags(process.argv.slice(2));
showHelpIfRequested(flags, import.meta.url);
const domain = normalizeDomain(required(flags, 'domain'));
const dbGiven = flags.db !== undefined && String(flags.db).trim() !== '';
const db = String(flags.db || '').trim().toLowerCase();
if (!dbGiven) {
  console.error(`⚠ --db not given. organicTraffic will be whatever country Semrush defaults to — not a global total (this script has no global option). Pass --db us (or uk/de/…) to know which country you're reading.`);
}
const session = resolveSession(flags, 'semrush-overview', 'semrush');
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

/**
 * 从整页文本里读出这一组指标。**同时被解析和「数值是否稳定」的指纹用**——
 * 指纹必须覆盖真正要写进输出的每一个字段，否则某个字段还在水合就被放过去了。
 */
function readMetrics(bodyText) {
  const lines = String(bodyText || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return {
    // `Number(x) || null` 会把 AS=0 吞成 null —— 而 0 是真实值（新站常见），
    // 与「没数据」含义相反。2026-08-21 在 semrush-report.mjs 上发现，同步修这里。
    // ⚠️ 这里的 0 **不能**靠「连续两次读到同一个 0」来采信——见下面
    // `makeAuthorityScoreRenderSignal`：水合前的占位 0 本来就是完美稳定的。
    // 采信 0 的唯一依据是 AS 组件自己给出的「已渲染完成」信号。
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
}

/**
 * Authority Score 组件的**完成信号探针**（页面产出的事实，不是我们这边的计数）。
 *
 * 判据必须绑在 AS 这一个组件上，不是整页——见
 * <law-ref id="readiness-must-bind-to-this-query"/>：「页面上出现了 X」永远要先问
 * 「X 有没有可能由别处提供？」。整页扫 svg / 链接 / 骨架都会被别的卡片满足，
 * 于是又变成一个和 AS 无关的赌。所以从「Authority Score」这个纯文本标签往上爬，
 * **一碰到别的指标标签就停**，只在这个盒子里取证。
 *
 * 采集三件事，全都只在 AS 这个数据点绑定之后才可能为真：
 *   - `busy`   组件里还有骨架 / aria-busy / progressbar —— 明确「还没渲染完」；
 *   - `trend`  数值旁边的变化量（`+2` / `−1` / `+356%`）—— 只有真值到位才渲染；
 *   - `noData` 组件里渲染了明确的「无数据」（不可用 / n/a / 暂无数据）。
 *
 * ⚠️ **不采集「值是不是 0」**。「非 0」不是完成信号，而是把结论绑回了要判定的那个
 * 数本身：真值就是 0 的新站会因此永远等到超时，而这正是本脚本 2026-08-21 那条注释
 * 要保住的合法取值。
 */
const AS_WIDGET_PROBE_JS = `(() => {
  const clean = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
  const LABEL = /^(Authority Score|权威分数|权重分)$/;
  const OTHER = /自然流量|付费流量|引荐域名|自然搜索关键词|反向链接|Organic Traffic|Referring Domains|Backlinks/;
  const label = Array.from(document.querySelectorAll('div,span,p,h1,h2,h3,h4,h5,h6,td,th,a,li'))
    .find((el) => el.children.length === 0 && LABEL.test(clean(el.textContent)));
  // 标签都还没挂上 —— 连「AS 组件在哪」都不知道，就不要假装知道它渲染完了。
  if (!label) return null;
  let widget = label;
  for (let i = 0; i < 4 && widget.parentElement; i++) {
    const parent = widget.parentElement;
    // 爬到把别的指标也圈进来了就停：再往上取到的证据是别人的，不是 AS 的。
    if (OTHER.test(clean(parent.innerText))) break;
    widget = parent;
  }
  const text = clean(widget.innerText);
  // 标签本身不含数字和正负号，但还是先摘掉，免得组件名里的字符混进变化量判定。
  const value = text.replace(/Authority Score|权威分数|权重分/g, ' ');
  return {
    found: true,
    busy: Boolean(widget.querySelector('[aria-busy="true"],[role="progressbar"],[class*="skeleton" i],[class*="loading" i],[class*="shimmer" i],[class*="placeholder" i]')),
    trend: /[+\\-−]\\s?\\d/.test(value),
    noData: /不可用|暂无数据|暂无|n\\/a/i.test(text),
    text: text.slice(0, 200),
  };
})()`;

/**
 * 纯判据，离线可测。**有状态**：`busy` 见过一次就记下来，之后它消失就是
 * 「加载指示消失了」——法条点名认可的三种完成信号之一（分页器出现 / 行数计数出现 /
 * 加载指示消失）。所以用工厂函数返回闭包，一次 captureStable 用一个。
 *
 * 三条路径任一成立即为「已渲染完成」；一条都不成立就是**没有信号**，
 * captureStable 会一直等到 deadline 然后交 `inconclusive` —— 不是 0，也不是「稳定值」。
 */
function makeAuthorityScoreRenderSignal() {
  let sawBusy = false;
  return (capture) => {
    const w = capture && capture.asWidget;
    if (!w || !w.found) return false;
    if (w.busy) { sawBusy = true; return false; }        // 还在转，不是信号
    return Boolean(w.noData || w.trend || sawBusy);
  };
}

/**
 * 概览页的轮询，单独拆出来是为了**判据和它的绑定一起被测**：
 * 把下面的 `renderSignal:` 一行删掉，事故复现测试就会变红（离线测试直接调它）。
 */
function pollOverview({ read, timeoutMs, intervalMs, needed }) {
  return captureStable({
    read,
    fingerprint: (cap) => (cap?.ready ? JSON.stringify(readMetrics(cap.bodyText)) : null),
    // 数值稳定只是必要条件；能不能当结论，看 AS 组件自己的完成信号。
    renderSignal: makeAuthorityScoreRenderSignal(),
    timeoutMs,
    intervalMs,
    needed,
  });
}

/**
 * 四种结局，下游含义完全不同，绝不许合并：
 *   never-rendered  连标签都没出现 —— 节点/无数据，照旧报错
 *   confirmed       数值稳定 **且** 拿到了完成信号 —— 唯一可以把数字（包括 0）当事实的一种
 *   inconclusive    数值稳定但完成信号始终没出现 —— 屏幕上的 0 可能是占位符，不下结论
 *   churning        数值一直在变 —— 和上面一种是两种失败，别混
 */
function settleVerdict(settled) {
  if (!settled?.capture?.ready) return 'never-rendered';
  if (settled.stable) return 'confirmed';
  return settled.inconclusive ? 'inconclusive' : 'churning';
}

let output;
let launched;
try {
  launched = await launchTool({
    session,
    tool: 'semrush',
    node: flags.node,
    window: flags.window,
    wait: Number(flags.wait || 7),
    timeout: Number(flags.launchTimeout || 60),
    allowParallelSession: Boolean(flags['allow-parallel-session']),
  });

  const searchType = flags.subdomain ? 'subdomain' : 'domain';
  const url = `${appOrigin}/analytics/overview/?q=${encodeURIComponent(domain)}` +
    `&searchType=${searchType}${db ? `&db=${encodeURIComponent(db)}` : ''}`;
  await gotoInTool(launched.evalPage, url, Number(flags.settle || 12));

  // 概览页首屏要十几秒。**认「Authority Score」而不是页面标题**——
  // 标题在骨架阶段就有了，认它会抓到一个空壳。
  //
  // **但认到标签也还不算数。** 标签挂上来的时候数值区往往还停在占位的 `0` 上，
  // 真实数字要再晚几秒才水合进去。2026-08-23 实测：一次跑 8 个域名，6 个被读成
  // authorityScore: 0，真值是 15~29（mmradar.gg 22、na.whatismymmr.com 29、
  // saveeditonline.com 38…）。而且**它不报错**——输出结构完整，只是数字是错的，
  // 一路进报告都没人看得出来。
  //
  // 【2026-08-29 修正】旧版的补法是「连读到数值两次完全一致才收下」——**那条判据对
  // 这个失败形态无效**，所以这个 bug 到今天仍然站着：水合前的占位 `0` 本身就是完美
  // 稳定的，两次读立刻就一致，重复多少次都一样。见
  // <law-ref id="readiness-must-bind-to-this-query"/>：重复次数和时长都不是页面产出的
  // 东西。改成把结论绑到 AS 组件自己的完成信号上（见 AS_WIDGET_PROBE_JS），
  // 拿不到信号就交 inconclusive，绝不把一个可能是占位符的 0 当事实写出去。
  const readOverview = () => launched.evalPage(`(() => JSON.stringify({
    url: location.href,
    title: document.title,
    ready: /Authority Score|权威分数/.test(document.body?.innerText || ''),
    bodyText: (document.body?.innerText || '').slice(0, 30000),
    asWidget: ${AS_WIDGET_PROBE_JS},
  }))()`);
  const settled = await pollOverview({
    read: readOverview,
    timeoutMs: Number(flags.timeout || 120) * 1000,
    intervalMs: Number(flags['stable-interval'] || 3) * 1000,
    needed: Number(flags['stable-reads'] || 2),
  });
  const captured = settled.capture;
  const verdict = settleVerdict(settled);
  if (verdict === 'never-rendered') {
    throw new Error(
      `Semrush overview for ${domain} never rendered its metrics. Most likely the node is down — ` +
        `rerun with a different --node. Second possibility: the domain has no data in db=${db || "(Semrush's default — not a global total)"}.`,
    );
  }
  if (verdict === 'churning') {
    throw new Error(
      `Semrush overview for ${domain} showed its labels but the numbers never settled ` +
        `(${settled.reads} reads over ${flags.timeout || 120}s). The values on screen are still ` +
        `placeholders — reporting them would silently under-count (typically Authority Score 0). ` +
        `Rerun, or raise --timeout / --stable-interval.`,
    );
  }

  const metrics = readMetrics(captured.bodyText);

  output = {
    version: 1,
    source: 'Semrush domain overview via authenticated Tools Share browser session',
    note: `organicTraffic 是 db=${db || '(Semrush 默认库，非全球)'} 这一个国家库的自然搜索流量估算，` +
      '与 Similarweb 的总访问量不是同一口径，不要并列比较；换一个 --db 会得到完全不同的数字，本脚本没有全球选项。'
      + ' 要和 Similarweb 同口径的总访问量，用 Traffic & Market（/analytics/traffic/traffic-overview/）——'
      + '2026-08-28 实测两家在 canva.com 上相差 2.4%。',
    retrievedAt: new Date().toISOString(),
    domain,
    db: db || null,
    searchType,
    session,
    title: captured.title,
    // 读了几次才稳下来：偶发的 4+ 次说明这个节点水合很慢，值得换。
    reads: settled.reads,
    subscription: {
      expiry: launched.state.expiry,
      daysLeft: launched.state.daysLeft,
      quotas: launched.state.quotas,
      warning: expiryWarning(launched.state),
    },
    // 拿到完成信号才配叫 metrics。没拿到就换个字段名放出去 —— 下游读 `metrics`
    // 的代码会读到 undefined 然后炸掉，这正是想要的：显式失败，而不是收下一份
    // 可能整块都是占位值的数（典型症状就是 authorityScore: 0）。
    ...(verdict === 'confirmed'
      ? { metrics: Object.fromEntries(Object.entries(metrics).filter(([, v]) => v !== null && v !== undefined)) }
      : {
        status: 'inconclusive',
        unconfirmedMetrics: Object.fromEntries(Object.entries(metrics).filter(([, v]) => v !== null && v !== undefined)),
        inconclusive: {
          code: 'render_signal_missing',
          message: `Semrush overview for ${domain}: 数值在 ${settled.reads} 次读数里一直稳定，但 Authority Score 组件` +
            `始终没有给出「已渲染完成」的信号（变化量 / 明确无数据 / 加载指示消失，一个都没等到）。` +
            `稳定的占位值和稳定的真值在这一刻长得一模一样，所以这里不下结论 —— ` +
            `**不要**把上面的 unconfirmedMetrics 当事实，尤其是 authorityScore。` +
            `重跑，或加大 --timeout；若某个域名反复如此，说明 AS 组件的完成信号探针需要按实际 DOM 复核。`,
        },
      }),
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
    // opencli 的报错里可能带着 __gmitm 令牌（它会打印活动会话的完整 URL）。
    error: { code: 'overview_failed', message: redactSecrets(error.message) },
  };
} finally {
  await launched?.releaseBrowserLocks();
}

if (typeof flags.out === 'string') {
  await writeFile(flags.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}
printJson(output);
// inconclusive 也是失败：批量脚本靠退出码决定要不要重跑，
// 一份「数字可能是占位符」的输出不许以 0 退出，否则它会被当成一次成功的读数归档。
if (output.status === 'unavailable' || output.status === 'inconclusive') process.exitCode = 1;
