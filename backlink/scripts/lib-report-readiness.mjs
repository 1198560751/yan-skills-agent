/**
 * lib-report-readiness.mjs — 报表路由的「就绪 / 目标 / 无表格」判据，从 SKILL.md 的
 * <law-ref id="readiness-must-bind-to-this-query"/> 的 <correct> 块里搬出来，变成可执行、
 * 可测、可传参的一份代码。以前它只是一段贴在文档里的片段，实盘 agent 手抄进页面执行，
 * 于是它自己的毛病没有任何一处会变红。
 *
 * ⚠️ **这条 law 是为了防「判据被页面上无关的东西满足」而写的，而它自己的两个承重条件
 * 正犯着同一个病。** 2026-08-29 复盘出四处未说出口的假设，处置如下：
 *
 * 1. `exportBtns >= 1` —— 作用域没绑。旧写法在 `main` 底下全量扫 `button, a` 的文本。
 *    自家记录里就有反例：`daily-trends` 主体区**每个渠道名各带一个「导出」**，所以一个
 *    「导出」按钮既可能来自全局工具栏，也可能来自别的章节，跟「本报表章节渲染完了」
 *    没有必然关系。**本轮只做可参数化**（`scopeSelector`），默认值不动。
 * 2. `chartHydrated >= 3` —— 同上。`svg text` 里含数字的节点没有绑到本路由的图表；
 *    实例 1 那张 `axa.fr / 42 / 758 / 15%` 的邻居挂件如果是 svg 画的，它自己就能凑够 3 个。
 *    **本轮同样只做可参数化。**
 * 3. `spinnerGone` —— 猜类名的**否定式**信号，已经**拆开**：`[aria-busy="true"]` 是
 *    ARIA 标准属性、是页面自己声明「我还在忙」，保留为**否决项**；
 *    `[class*="skeleton"|"spinner"]` 是猜厂商类名，**降级为只记录、永不参与判定**。
 *    理由见 `readBusyState()` 上方的长注释。
 * 4. `onTarget` 的否定半边写死了中文字面量 `创建新列表`。同一个共享账号如果 UI 是英文，
 *    落地页的 `Create a new list` 匹配不上，空态落地页上 `ok` 就是 `true` —— 实例 4 原封
 *    不动复现。现在标记按 locale 声明，并且**匹配不到标记不等于不在空态**：
 *    locale 不在覆盖表里时判 `unknown`，`ok` 为 false，而不是默认通过。
 *
 * 分工和 lib-submit-outcome.mjs 一样：`readReportProbe(document, options)` 会被
 * `.toString()` 进 eval 里在页面执行；下面每一个分类函数都是纯函数，可以离线喂假页面测。
 */

/**
 * ⚠️ **未验证的默认值，不是结论。**
 *
 * `main` 是从 DOM 惯例推来的，没有任何一次实测确认过「Semrush 流量与市场路由的本报表区
 * 根节点是 `main`」。它之所以还是默认值，只是因为**本轮不许在没有实测依据的情况下改变
 * 现有行为**——旧片段用的就是它。等实盘取回本报表区的真实根，改的是调用点的参数，
 * 不是这里的代码。
 *
 * 每一次探针输出都会带上 `scopeIsUnverifiedDefault`，让下游能把「绑到了报表区」和
 * 「退回了整页」区分开。
 */
export const DEFAULT_SCOPE_SELECTOR = 'main';

/** 判据阈值，和 SKILL.md 的 <correct> 块保持一致。 */
export const CHART_HYDRATED_MIN = 3;
export const EXPORT_CONTROLS_MIN = 1;

/** 「导出」控件的文案。作用域绑不上时这个正则是唯一的防线，所以它只负责认控件，
 *  **不负责认它属于谁**——那件事只能由 `scopeSelector` 来做。 */
export const EXPORT_CONTROL_PATTERN = /导出|export/i;

/**
 * 空态落地页的标记，**按 locale 声明**。
 *
 * 一条硬规则：这张表既是「怎么认出空态」，也是「我认得哪些 locale」。第二件事才是修掉
 * 实例 4 的关键——旧判据把「没匹配到中文标记」直接读成「不在空态」，那是一个**否定式、
 * 不可证伪**的信号，跟 3 号病一模一样。
 */
export const EMPTY_STATE_MARKERS = [
  { locale: 'zh', marker: '创建新列表' },
  { locale: 'en', marker: 'Create a new list' },
];

/** 从 `<html lang>` 或 URL 里的 locale 段取 UI 语言。
 *  两者都是页面/请求自己产出的事实，不是猜的类名：本仓库自测里就有
 *  `https://dash.3ue.co/zh-Hans/` 这样的路径。 */
export function detectUiLocale({ documentLang = '', pathname = '' } = {}) {
  const fromLang = String(documentLang || '').trim();
  if (fromLang) return fromLang;
  for (const segment of String(pathname || '').split('/')) {
    if (/^[a-z]{2}(-[A-Za-z0-9]+)*$/.test(segment)) return segment;
  }
  return '';
}

/** 主语言子标签：`zh-Hans` → `zh`，`en-US` → `en`。 */
export function primaryLanguageSubtag(locale) {
  return String(locale || '').trim().toLowerCase().split(/[-_]/)[0] || '';
}

/**
 * 目标检查：正向（目标标识出现）+ 否定（不在空态落地页）。两半都要。
 *
 * 相对旧片段的唯一行为变化，就是**否定半边不再默认成立**：
 *
 *   - 命中某个 locale 的标记 → `emptyState: 'yes'`，`ok: false`（和以前一样）；
 *   - 没命中，且这一页的 locale 在覆盖表里 → `emptyState: 'no'`，`ok` 看正向半边
 *     （和以前一样）；
 *   - 没命中，但这一页的 locale 我们根本没有标记 → `emptyState: 'unknown'`，
 *     **`ok: false`**。以前这里是 `true`，也就是实例 4 换个语言原样复现。
 *
 * 拿不准就显式失败，是本仓库的既定规矩。想在一个新 locale 上继续跑，办法是把观测到的
 * 标记加进 `markers`（或传 `uiLocale`），而不是让判据默认通过。
 */
export function classifyTargetScope({
  text = '',
  target = '',
  documentLang = '',
  pathname = '',
  uiLocale,
  markers = EMPTY_STATE_MARKERS,
} = {}) {
  const body = String(text || '');
  const hit = markers.find((entry) => entry.marker && body.includes(entry.marker)) || null;
  const hasTarget = Boolean(target) && body.includes(target);
  const locale = uiLocale !== undefined ? String(uiLocale || '') : detectUiLocale({ documentLang, pathname });
  const covered = markers.some((entry) => entry.locale === primaryLanguageSubtag(locale));

  let emptyState;
  if (hit) emptyState = 'yes';
  else if (covered) emptyState = 'no';
  else emptyState = 'unknown';

  return {
    hasTarget,
    emptyState,
    emptyStateMarkerLocale: hit ? hit.locale : null,
    // 老字段名保留，下游还在按它记证据。含义不变：空态标记就在页面上。
    listPickerVisible: emptyState === 'yes',
    uiLocale: locale || null,
    localeCovered: covered,
    ok: hasTarget && emptyState === 'no',
  };
}

/**
 * 「页面还在忙吗」——**只有一半可以参与判定**。
 *
 * 旧写法：`spinnerGone = !root.querySelector('[class*="skeleton" i], [class*="spinner" i], [aria-busy="true"]')`
 * 一个否定式判据，而且其中两项在猜厂商类名。厂商改一次类名，它就**恒为真**，于是一个
 * 从未开始渲染的页面被判成「加载指示已消失」。这正是这条 law 在要求「正向的结束渲染
 * 信号」时最不该用的那种东西：**不可证伪**。它和被删掉的 `vis === 'visible'` 是同一个
 * 形状——在它撒谎的地方自动为真，在它诚实的地方反而可能误杀（页面别处一个装饰性的
 * `class="spinner-icon"` 能把一个已经渲染完的页面永远卡住）。
 *
 * 所以拆开：
 *   - `ariaBusy` —— `[aria-busy="true"]` 是 ARIA 标准属性，是**页面自己声明**的状态，
 *     可证伪、有语义。保留，且**只作为否决项**：为真 ⇒ 没渲染完。为假**不构成**
 *     任何完成证据，完成证据永远由正向信号（paginator / rowCount）提供。
 *   - `loadingClassPresent` —— 猜类名的那两项，**降级为只记录**。写进证据供人看，
 *     永不进入任何判定式。
 */
export function readBusyState(root) {
  return {
    ariaBusy: Boolean(root.querySelector('[aria-busy="true"]')),
    // 记录项，绝不参与判定。见上方注释。
    loadingClassPresent: Boolean(root.querySelector('[class*="skeleton" i], [class*="spinner" i]')),
  };
}

/**
 * 「这一页渲染完了吗」——正向信号 + `aria-busy` 否决。
 * 正向那半（paginator / rowCount）是唯一能提供「完成」的东西；缺了它，无论 spinner
 * 在不在，都不算完成。
 */
export function renderFinished(done = {}) {
  return Boolean((done.paginator || done.rowCount) && !done.ariaBusy);
}

/** 结构判据：四条件全满足才是 `no-table-structural`。 */
export function isNoTableStructural(probe = {}) {
  return Boolean(
    probe.noTable
    && Number(probe.chartHydrated) >= CHART_HYDRATED_MIN
    && Number(probe.exportBtns) >= EXPORT_CONTROLS_MIN
    && probe.onTarget,
  );
}

/**
 * 三个判定名，只有两个是结果。先查 `data-not-in-table`——「没有表格」和「没有数据」
 * 是两句不同的话。
 */
export function classifyAbsence({ anchoredReady, noTableStructuralTwiceRunning, budgetExhausted } = {}) {
  if (anchoredReady) return 'data-not-in-table';
  if (noTableStructuralTwiceRunning) return 'no-table-structural';
  if (budgetExhausted) return 'no-table';
  return 'inconclusive';
}

/**
 * 在页面里跑的那一半。`.toString()` 进 eval 执行，所以这里只能用页面自带的东西，
 * 不能引用模块作用域里的常量——阈值和标记都通过 `options` 传进来。
 *
 * `scopeSelector` 是这次改动的全部意义：判据从「写死在 main 底下」变成「绑到调用方
 * 声明的作用域根」。默认值仍是 `main`，**行为与旧片段逐位相同**，等实测确认了本报表区
 * 的真实根，只要传参。
 */
export function readReportProbe(document, options = {}) {
  const {
    scopeSelector = 'main',
    target = '',
    markers = [],
    uiLocale,
  } = options;

  const scoped = scopeSelector ? document.querySelector(scopeSelector) : null;
  const root = scoped || document.body;
  const bodyText = (document.body && document.body.innerText) || '';

  const exportControls = [];
  for (const control of root.querySelectorAll('button, a')) {
    const label = (control.innerText || '').trim();
    if (/导出|export/i.test(label)) exportControls.push(label);
  }

  let chartHydrated = 0;
  for (const node of root.querySelectorAll('svg text')) {
    if (/\d/.test(node.textContent || '')) chartHydrated += 1;
  }

  return {
    // 作用域自报家门。判据绑没绑上，下游得看得见。
    scopeSelector: scopeSelector || null,
    scopeResolved: Boolean(scoped),
    scopeIsUnverifiedDefault: scopeSelector === 'main',

    noTable: root.querySelectorAll('table, [role="grid"]').length === 0,
    chartHydrated,
    exportBtns: exportControls.length,
    // 作用域没绑上时，这份标签清单是判断「这些导出按钮到底属于谁」的唯一线索。
    exportControlLabels: exportControls,

    ariaBusy: Boolean(root.querySelector('[aria-busy="true"]')),
    loadingClassPresent: Boolean(root.querySelector('[class*="skeleton" i], [class*="spinner" i]')),

    paginator: Boolean(root.querySelector('[class*="pagination" i], nav[aria-label*="page" i]')),
    rowCount: Boolean(root.querySelector('[data-testid*="row-count" i], [class*="total-rows" i]')),

    bodyText,
    target,
    markers,
    uiLocale: uiLocale !== undefined ? uiLocale : ((document.documentElement && document.documentElement.lang) || ''),
    pathname: (document.location && document.location.pathname) || '',

    // 只记录，永不作为判定依据。见 law 里 `vis` 那段更正。
    visibilityStateAtVerdict: document.visibilityState,
    hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
  };
}

/** 把页面读回来的原料拼成一次完整判定。纯函数。 */
export function classifyReportProbe(probe = {}) {
  const scope = classifyTargetScope({
    text: probe.bodyText,
    target: probe.target,
    documentLang: probe.uiLocale,
    pathname: probe.pathname,
    markers: probe.markers && probe.markers.length ? probe.markers : EMPTY_STATE_MARKERS,
  });
  const structural = { ...probe, onTarget: scope.ok };
  return {
    scope,
    onTarget: scope.ok,
    renderFinished: renderFinished(probe),
    noTableStructural: isNoTableStructural(structural),
  };
}
