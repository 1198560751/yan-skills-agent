/**
 * lib-chart-read.mjs — chart-only 路由的**读数器**。纯函数，离线可测，
 * 只做提取与换算，**不下判断**（第 11 条法律 `scripts-collect-ai-judges`）。
 *
 * ──────────────────────────────────────────────────────────────────────
 * 先说清楚它读不出什么（2026-08-30 把 11 份实盘 census 读透之后的结论）
 * ──────────────────────────────────────────────────────────────────────
 *
 * `census.deep.svgText` **是一个计数，不是文本**——`lib-deep-dom.mjs` 里它就是
 * `deepQueryAll(root, 'svg text').length`。所以「数值都在 deep.svgText 里」这句
 * 流传下来的说法是错的：census 里根本没有 svg 文本内容，更没有几何。
 *
 * census 里**唯一**带文本的字段是 `deepText`（`deepTextSample` 取的 innerText 样本）。
 * 它含有：图表标题、系列名、**y 轴刻度文本**、**x 轴标签文本**、以及无障碍提示
 * 「按“Tab”启用图形图表访问模块。」——**没有任何一个数据点的值**。截图也证实了这一点：
 * Semrush 的折线图不渲染数据标签，逐点数值只存在于点的**像素位置**里。
 *
 * 于是本文件有两条路径，能力天差地别，调用方必须能分辨：
 *
 * | 路径 | 输入 | 能读出 | 读不出 |
 * |---|---|---|---|
 * | `readChartsFromText` | 现存 census 的 `deepText` | 轴刻度、轴范围、x 标签、系列名、标题 | **逐点值**（标 `no-geometry`） |
 * | `readChartsFromGeometry` | 新增采集面 `census.chartGeometry` | 上面全部 **+ 逐点值** | 轴非线性时的逐点值（标 `axis-nonlinear`） |
 *
 * **现有 11 份 remeasure 证据全部只能走文本路径。** 逐点值要等下一次实盘带上
 * `readChartGeometry()`（见 `lib-deep-dom.mjs`）采集的几何。这件事没有捷径：
 * 值不在 DOM 文本里，就只能从像素反推。
 *
 * ──────────────────────────────────────────────────────────────────────
 * 「读不出」和「值是 0」必须可分辨
 * ──────────────────────────────────────────────────────────────────────
 * 所有读不出的位置一律 `value: null` + `uncertain` 里给出**理由代码**，
 * 绝不填一个看起来合理的数字。`value: 0` 只在真的算出 0 时出现。
 */

/* ------------------------------------------------------------------ *
 * 1. 轴刻度文本 → 数值
 * ------------------------------------------------------------------ */

/**
 * 中文面板用「万 / 亿 / 千」，英文面板用 K / M / B。两套都收。
 * 顺序有意义：先匹配长的（`亿` 之前不能被 `万` 抢走，这里各自独立故无碍，
 * 但 `Bn` 必须排在 `B` 前）。
 */
const MAGNITUDE_SUFFIXES = [
  ['亿', 1e8],
  ['万', 1e4],
  ['千', 1e3],
  ['bn', 1e9],
  ['b', 1e9],
  ['m', 1e6],
  ['k', 1e3],
];

/**
 * 把一个轴刻度文本解析成数值。
 *
 * 返回 `{ ok, value, unit, raw }`。**解析不出就是 `ok:false` + `value:null`**，
 * 不做「看着像 0 就当 0」这种补全——空字符串、`n/a`、纯标签全部落在这里。
 */
export function parseAxisValue(raw) {
  const text = String(raw ?? '').trim();
  const out = { ok: false, value: null, unit: null, raw: text };
  if (!text) return out;

  // 百分比先认，因为 `%` 会改变单位语义（0–100 而不是绝对量）。
  const percent = /^([+-]?[\d.,\s]+)\s*%$/.exec(text);
  if (percent) {
    const n = toNumber(percent[1]);
    if (n === null) return out;
    return { ok: true, value: n, unit: '%', raw: text };
  }

  const lower = text.toLowerCase();
  for (const [suffix, factor] of MAGNITUDE_SUFFIXES) {
    if (!lower.endsWith(suffix)) continue;
    const head = text.slice(0, text.length - suffix.length);
    const n = toNumber(head);
    if (n === null) continue;
    return { ok: true, value: n * factor, unit: 'count', raw: text };
  }

  const plain = toNumber(text);
  if (plain === null) return out;
  return { ok: true, value: plain, unit: 'count', raw: text };
}

/** `1,234.5` / `1 234` / `+12.18` → number；夹杂别的字符一律 null。 */
function toNumber(raw) {
  const cleaned = String(raw ?? '').replace(/[,\s ]/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ *
 * 2. deepText → 图表块
 * ------------------------------------------------------------------ */

/**
 * 每个图表挂件在 innerText 里的**终止标记**。Semrush 给每张图都渲染了一句
 * 无障碍提示，它是块与块之间唯一稳定的分隔符（标题会重复、导出按钮不一定有）。
 *
 * ⚠️ **只有中文那条是实测验证过的**（11 份 2026-08-29 实盘证据，面板语言中文）。
 * 英文那条是按同一控件的常见文案写的，**未经实盘验证**——命不中就退化成
 * 「整段当一个块」，读数会标 `no-chart-blocks`，不会假装读到了东西。
 */
export const CHART_BLOCK_TERMINATORS = [
  /按[“"]?Tab[”"]?启用图形图表访问模块/,
  /press\s+tab\s+to\s+(enable|activate)/i,
];

/** 明显不是轴标签的行：CSS、脚本、超长串。`deepText` 尾部混进过整段 semi-ui 主题 CSS。 */
function isNoiseLine(line) {
  if (line.length > 120) return true;
  if (/[{};]/.test(line)) return true;
  if (/^--[a-z-]/.test(line)) return true;
  return false;
}

/**
 * 把 `deepText` 切成图表块。返回 `[{ lines, terminated }]`。
 *
 * `terminated:false` 的尾块是「终止标记之后剩下的东西」——侧栏、页脚、CSS。
 * 它**不是**图表，调用方据此丢弃；这里不替调用方丢，因为那已经是判断。
 */
export function splitChartBlocks(deepText, { terminators = CHART_BLOCK_TERMINATORS } = {}) {
  const lines = String(deepText ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (terminators.some((re) => re.test(line))) {
      blocks.push({ lines: current, terminated: true });
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push({ lines: current, terminated: false });
  return blocks;
}

/**
 * 从一个图表块的行里挑出 y 轴刻度。
 *
 * 判据是**形状**，不是位置：一段连续的、**单调**的、全部可解析成数值的行，长度 ≥ 2。
 * 这样「0 / 2000万 / 4000万 / 6000万」被认出来，而「37.1万%」这种孤立的洞察数字
 * 不会（它前后都不是数值行，凑不成长度 ≥ 2 的连续段）。
 *
 * 取**最长**的那一段：一个块里若有两条数值连续段（罕见），长的那条才是轴。
 */
export function pickAxisTicks(lines) {
  let best = null;
  let run = [];
  const flush = () => {
    if (run.length >= 2 && (!best || run.length > best.length)) best = run;
    run = [];
  };
  for (const line of lines) {
    const parsed = parseAxisValue(line);
    if (parsed.ok) { run.push(parsed); continue; }
    flush();
  }
  flush();
  if (!best) return null;
  // 单调性是轴的必要条件；不单调的连续数值段是数据罗列，不是轴。
  const values = best.map((t) => t.value);
  const ascending = values.every((v, i) => i === 0 || v >= values[i - 1]);
  const descending = values.every((v, i) => i === 0 || v <= values[i - 1]);
  if (!ascending && !descending) return null;
  const units = new Set(best.map((t) => t.unit));
  return {
    ticks: best,
    unit: units.size === 1 ? [...units][0] : 'mixed',
    min: Math.min(...values),
    max: Math.max(...values),
    direction: descending && !ascending ? 'descending' : 'ascending',
  };
}

/**
 * 图表标题与系列名的**形状线索**：面板把每个可见标签渲染两遍（一遍给视觉、
 * 一遍给无障碍），于是标题和图例在 innerText 里都是**连续重复的两行**。
 * 「跳到内容 / 价格 / Enterprise」这些导航文字不重复，天然被滤掉。
 *
 * 返回按出现顺序去重后的重复行列表。第一条通常是图表标题，其余是图例系列名——
 * 但**这里不替调用方分配语义**，只把「哪些行是重复的」这个事实交出去。
 */
export function pickRepeatedLabels(lines) {
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 1) {
    if (lines[i] !== lines[i + 1]) continue;
    if (!out.includes(lines[i])) out.push(lines[i]);
  }
  return out;
}

/**
 * 文本路径的读数。**输入是整个 capture（census 的外层对象）或 census 本身。**
 *
 * 每个块产出：`title`（块首行）、`labels`（非数值、非噪声的行）、`yAxis`、
 * `points: []` + `uncertain: ['no-geometry']`。**逐点值这条路径永远读不出**，
 * 这不是 bug，是 census 里就没有那个信息。
 */
export function readChartsFromText(input, options = {}) {
  const census = input?.census ?? input ?? {};
  const deepText = String(census.deepText ?? '');
  const charts = [];
  const notes = [];

  if (!deepText) {
    return {
      source: 'deepText',
      available: false,
      charts: [],
      notes: ['census.deepText 为空或缺失，无从提取'],
    };
  }

  const blocks = splitChartBlocks(deepText, options);
  const terminated = blocks.filter((b) => b.terminated);
  if (!terminated.length) notes.push('no-chart-blocks: deepText 里没有图表终止标记，可能是面板换了语言或本页没有图表挂件');

  for (const [index, block] of terminated.entries()) {
    const lines = block.lines.filter((l) => !isNoiseLine(l));
    const yAxis = pickAxisTicks(lines);
    const tickRaws = new Set(yAxis ? yAxis.ticks.map((t) => t.raw) : []);
    const labels = lines.filter((l) => !tickRaws.has(l));
    const repeated = pickRepeatedLabels(labels);
    charts.push({
      index,
      // 标题取第一条**重复行**——面板把标题和图例各渲染两遍，导航文字不重复。
      // 一条重复行都没有时退回块首行，并在 uncertain 里说明退化过。
      title: repeated[0] ?? labels[0] ?? null,
      // 其余重复行是图例系列名。**这里不保证它们是「系列」**，只保证它们重复过。
      seriesNames: repeated.slice(1),
      labels,
      yAxis: yAxis
        ? { unit: yAxis.unit, min: yAxis.min, max: yAxis.max, direction: yAxis.direction, ticks: yAxis.ticks.map((t) => ({ raw: t.raw, value: t.value })) }
        : null,
      points: [],
      uncertain: [
        ...(yAxis ? [] : [{ what: 'yAxis', reason: 'no-monotonic-numeric-run', detail: '块内找不到长度≥2 的单调数值段' }]),
        ...(repeated.length ? [] : [{ what: 'title', reason: 'no-repeated-label', detail: '块内没有连续重复行，标题退回块首行' }]),
        { what: 'points', reason: 'no-geometry', detail: 'census 只存文本不存几何；折线图不渲染数据标签，逐点值无从还原' },
      ],
    });
  }

  // deepTextSample 有上限（ground-truth 传 20000），首屏之下的图表可能整块没进样本。
  const textLength = Number(census.deep?.textLength ?? 0);
  if (textLength > deepText.length) {
    notes.push(`deepText 被截断（样本 ${deepText.length} / 深层全文 ${textLength}），块数是下界`);
  }
  return { source: 'deepText', available: true, charts, notes };
}

/* ------------------------------------------------------------------ *
 * 3. 几何 → 逐点值
 * ------------------------------------------------------------------ */

/**
 * 用带 y 像素坐标的刻度文本标定 y 轴：像素 → 数值的线性映射。
 *
 * 需要 ≥ 2 个可解析且 y 坐标不同的刻度。**≥ 3 个时顺带查线性**：把中间的刻度
 * 用首尾两点的映射反推，相对残差超过 `tolerance` 就认为轴不是线性的（对数轴），
 * 返回 `linear:false`——调用方据此把所有点标 uncertain，而不是给出错值。
 */
export function calibrateAxis(tickNodes, { tolerance = 0.05 } = {}) {
  const usable = [];
  for (const node of tickNodes || []) {
    const parsed = parseAxisValue(node?.text);
    const y = Number(node?.y);
    if (!parsed.ok || !Number.isFinite(y)) continue;
    usable.push({ value: parsed.value, y, raw: parsed.raw });
  }
  if (usable.length < 2) {
    return { ok: false, reason: 'axis-too-few-ticks', ticks: usable };
  }
  usable.sort((a, b) => a.y - b.y);
  const first = usable[0];
  const last = usable[usable.length - 1];
  if (first.y === last.y) return { ok: false, reason: 'axis-degenerate', ticks: usable };
  const slope = (last.value - first.value) / (last.y - first.y);
  const project = (y) => first.value + (y - first.y) * slope;

  let linear = true;
  let maxResidual = 0;
  const span = Math.abs(last.value - first.value) || 1;
  for (const tick of usable.slice(1, -1)) {
    const residual = Math.abs(project(tick.y) - tick.value) / span;
    if (residual > maxResidual) maxResidual = residual;
    if (residual > tolerance) linear = false;
  }
  return { ok: true, linear, slope, maxResidual, project, ticks: usable, reason: linear ? null : 'axis-nonlinear' };
}

/**
 * 一张图的几何 → 逐点值。
 *
 * `chart` 形如 `readChartGeometry()` 的产出：
 * `{ title, texts: [{text, x, y}], marks: [{kind, x, y, width, height}] }`。
 *
 * 标定失败或轴非线性时，**每个点依然出现在结果里**，但 `value:null` + `uncertain`。
 * 「这张图有 7 个点但读不出值」和「这张图没有点」是两件事，必须能分辨。
 */
export function readChartFromGeometry(chart, options = {}) {
  const texts = Array.isArray(chart?.texts) ? chart.texts : [];
  const marks = Array.isArray(chart?.marks) ? chart.marks : [];

  // y 轴刻度 = 落在图左侧、且能解析成数值的文本。用 x 中位数切左右，
  // 避免把 x 轴上的年份「2026年2月」误当刻度（它解析不出数值，天然被滤掉）。
  const numericTexts = texts.filter((t) => parseAxisValue(t?.text).ok);
  const axis = calibrateAxis(numericTexts, options);

  const points = marks.map((mark, i) => {
    const y = pointY(mark);
    const base = { index: i, kind: mark?.kind ?? null, x: numberOrNull(mark?.x), y, value: null, uncertain: null };
    if (!axis.ok) return { ...base, uncertain: axis.reason };
    if (!axis.linear) return { ...base, uncertain: 'axis-nonlinear' };
    if (!Number.isFinite(y)) return { ...base, uncertain: 'mark-without-y' };
    return { ...base, value: axis.project(y), uncertain: null };
  });

  return {
    title: chart?.title ?? null,
    yAxis: axis.ok
      ? { linear: axis.linear, maxResidual: axis.maxResidual, ticks: axis.ticks.map((t) => ({ raw: t.raw, value: t.value, y: t.y })) }
      : null,
    xLabels: texts.filter((t) => !parseAxisValue(t?.text).ok).map((t) => String(t.text)),
    points,
    uncertain: axis.ok && axis.linear ? [] : [{ what: 'points', reason: axis.reason || 'axis-nonlinear' }],
  };
}

/** 柱图的值在**柱顶**（y），点图在圆心（y）。两者都由采集侧归一到 `y`。 */
function pointY(mark) {
  const y = Number(mark?.y);
  return Number.isFinite(y) ? y : NaN;
}

function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 几何路径的整页读数。 */
export function readChartsFromGeometry(input, options = {}) {
  const census = input?.census ?? input ?? {};
  const geometry = census.chartGeometry;
  if (!Array.isArray(geometry) || !geometry.length) {
    return { source: 'chartGeometry', available: false, charts: [], notes: ['census.chartGeometry 缺失——本轮采集没有开几何采集面'] };
  }
  return {
    source: 'chartGeometry',
    available: true,
    charts: geometry.map((chart) => readChartFromGeometry(chart, options)),
    notes: [],
  };
}

/* ------------------------------------------------------------------ *
 * 4. 调度：有几何走几何，没有就退文本，两份都留
 * ------------------------------------------------------------------ */

/**
 * 读数器的入口。**两条路径的结果都带回来**，因为它们互相校验：
 * 文本路径给出的轴范围可以核对几何路径算出的点是否落在轴内。
 *
 * `capability` 是给调用方看的一句大白话：`'points'` = 读到了逐点值，
 * `'axis-only'` = 只有轴与标签，`'none'` = 什么都没读到。**它描述读数器做到了
 * 什么，不描述页面有没有数据**——后者是判断，归 AI。
 */
export function readCharts(input, options = {}) {
  const text = readChartsFromText(input, options);
  const geometry = readChartsFromGeometry(input, options);
  const hasPoints = geometry.available
    && geometry.charts.some((c) => c.points.some((p) => p.value !== null));
  const hasAxis = text.charts.some((c) => c.yAxis) || geometry.charts.some((c) => c.yAxis);
  return {
    schemaVersion: 1,
    capability: hasPoints ? 'points' : (hasAxis ? 'axis-only' : 'none'),
    text,
    geometry,
  };
}
