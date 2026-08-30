/**
 * lib-pagination.mjs — 大表翻页批采的**纯函数层**：分页器解析、采页计划、
 * 断点续跑状态机、行数自检。全部离线可测，一个字节都不碰浏览器。
 *
 * ──────────────────────────────────────────────────────────────────────
 * 为什么单独一层
 * ──────────────────────────────────────────────────────────────────────
 *
 * `harvest-paginated.mjs` 一轮要跑几十上百条浏览器命令，实盘一次几十分钟、
 * 还要占着配额站的机器级锁。**判据写在那种脚本里等于永远测不到。**
 * 所以凡是「不需要页面也能算清楚」的东西全放这里：
 *
 *   - 分页器文本长什么样 → `parsePager`
 *   - 这一轮该采哪些页 → `planPages`（含抽样）
 *   - 中断后从哪继续 → `applyPageResult` / `pagesRemaining`
 *   - 采完对不对得上 → `verifyRowCount`
 *   - 一屏格子怎么拼回行 → `clusterCellsByY`（与页面里跑的是同一份源码）
 *
 * ──────────────────────────────────────────────────────────────────────
 * 三条设计约束
 * ──────────────────────────────────────────────────────────────────────
 *
 * 1. **绝不默认全量。** `planPages` 的 `maxPages` 没有「不限」这个取值；
 *    调用方给多少就采多少，且计划一旦被总数截断，`capped` 必须为 true，
 *    由调用方在日志里明说「本轮只采了 N/M 页」。静默截断 = 把抽样冒充全量。
 * 2. **本层不下判断。** `verifyRowCount` 只回报「对不对得上」和差在哪，
 *    绝不推断「数据丢了 / 页面坏了 / 可以接受」——那是 AI 拿着证据做的事
 *    （SKILL.md 的 scripts-collect-ai-judges）。
 * 3. **解析失败要说不知道，不许猜。** `parsePager` 认不出就返回 null，
 *    调用方据此走「总页数未知」分支；返回一个瞎猜的总数会让行数自检
 *    从此失去意义。
 */

/** 千分位/空格/不换行空格都剥掉；`~50,988` 的波浪号也剥。认不出返回 null。 */
export function parseCount(value) {
  const raw = String(value ?? '').trim().replace(/^~/, '');
  if (!/^[\d][\d,   ]*$/.test(raw)) return null;
  const digits = raw.replace(/[,   ]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * 分页器锚点：`of N` 这种碎片单独出现太容易误命中正文（"3 of 4 steps"、
 * "part of 5 series"）。所以先找一个分页锚点，再**只在它后面的一小段窗口里**
 * 找数字。窗口 48 字符是实测出来的：Semrush 的碎片形态
 * `Prev Next Page: of 1,430 Page: 1` 全长 32 字符。
 */
export const PAGER_ANCHOR = /(?:\bpage\b\s*:?|第|共)/i;
export const PAGER_WINDOW = 48;

/**
 * 从穿透文本里解析分页器。返回 `{ current, total, totalRows, shape }`，
 * 认不出返回 **null**（见文件头第 3 条）。
 *
 * 认得的四种形态（前三种是分页，第四种是行区间）：
 *
 *   1. `Page 1 of 1,430`                  英文行内式          shape: 'inline'
 *   2. `Prev Next Page: of 1,430 Page: 1` Semrush TA 碎片式   shape: 'split'
 *      （`Page:` 后面是个输入框，文本里只剩标签；当前页在无障碍副本 `Page: 1` 里）
 *   3. `第 3 页，共 1,430 页`              中文式              shape: 'zh'
 *   4. `1 - 100 (~50,988)`                行区间式（无页码）  shape: 'range'
 *      —— Semrush backlinks 的形态，`total`（页数）为 null，
 *      但 `totalRows` 有值，行数自检照样能用。
 */
export function parsePager(text) {
  const norm = String(text ?? '').replace(/[\s  ]+/g, ' ');

  // ── 3. 中文式：第 N 页 / 共 M 页 ────────────────────────────────────
  const zhCurrent = norm.match(/第\s*([\d,]+)\s*页/);
  const zhTotal = norm.match(/共\s*([\d,]+)\s*页/);
  if (zhCurrent || zhTotal) {
    const current = zhCurrent ? parseCount(zhCurrent[1]) : null;
    const total = zhTotal ? parseCount(zhTotal[1]) : null;
    if (current != null || total != null) {
      return { current, total, totalRows: null, shape: 'zh' };
    }
  }

  // ── 1 / 2. 英文式：锚点后 PAGER_WINDOW 字符内找 `N of M` 或 `of M` ──
  let current = null;
  let total = null;
  const anchor = /\bpage\b\s*:?/gi;
  let hit;
  while ((hit = anchor.exec(norm)) !== null) {
    const window = norm.slice(hit.index, hit.index + PAGER_WINDOW);
    const inline = window.match(/^page\s*:?\s*([\d,]+)\s+of\s+([\d,]+)/i);
    if (inline) {
      current = current ?? parseCount(inline[1]);
      total = total ?? parseCount(inline[2]);
      continue;
    }
    const ofOnly = window.match(/^page\s*:?\s*of\s+([\d,]+)/i);
    if (ofOnly) { total = total ?? parseCount(ofOnly[1]); continue; }
    const labelOnly = window.match(/^page\s*:?\s*([\d,]+)\b/i);
    if (labelOnly) current = current ?? parseCount(labelOnly[1]);
  }
  if (current != null || total != null) {
    return { current, total, totalRows: null, shape: current != null && total != null ? 'inline' : 'split' };
  }

  // ── 4. 行区间式：`1 - 100 (~50,988)` ────────────────────────────────
  const range = norm.match(/\b([\d,]+)\s*[-–—]\s*([\d,]+)\s*\(\s*~?\s*([\d,]+)\s*\)/);
  if (range) {
    const from = parseCount(range[1]);
    const to = parseCount(range[2]);
    const totalRows = parseCount(range[3]);
    if (from != null && to != null && totalRows != null && to >= from) {
      return { current: null, total: null, totalRows, rangeFrom: from, rangeTo: to, shape: 'range' };
    }
  }
  return null;
}

/**
 * 分页机制的**形状分类**（纯函数版；实盘那一半在 harvest-paginated.mjs 的
 * `--probe`）。只看三个可离线判定的信号，绝不猜：
 *
 *   - `pager`：`parsePager` 的结果（有没有分页器）
 *   - `urlPageParam`：URL 里有没有形如 page/p/offset/start 的参数
 *   - `rowsGrewOnScroll`：滚动前后行数有没有增长（懒加载/虚拟滚动的签名）
 *
 * 返回 `{ kind, confidence, reasons }`，`kind` ∈
 *   'url'      URL 参数驱动 —— 改参数重载即可翻页，最省事
 *   'client'   客户端分页 —— 有分页器但状态不在 URL，必须操作 DOM 控件
 *   'scroll'   虚拟滚动/懒加载 —— 没有分页器，行数随滚动增长
 *   'single'   一屏到底 —— 既没分页器也不随滚动增长
 *   'unknown'  信号不足（比如页面还没就绪）
 *
 * **confidence 'low' 一律当 unknown 处理**：这里给的是待验证的假设，
 * 不是判决——判决要跑一次 `--probe` 拿实证。
 */
export function classifyPagination({ pager = null, urlPageParam = null, rowsGrewOnScroll = null } = {}) {
  const reasons = [];
  if (urlPageParam) {
    reasons.push(`url carries a page-like param: ${urlPageParam}`);
    if (pager) reasons.push(`pager text present (shape=${pager.shape})`);
    return { kind: 'url', confidence: pager ? 'high' : 'medium', reasons };
  }
  if (pager && (pager.total != null || pager.totalRows != null)) {
    reasons.push(`pager text present (shape=${pager.shape}) but no page param in url`);
    if (rowsGrewOnScroll === true) {
      reasons.push('rows also grew on scroll — pager and lazy-load coexist');
      return { kind: 'client', confidence: 'medium', reasons };
    }
    return { kind: 'client', confidence: 'high', reasons };
  }
  if (rowsGrewOnScroll === true) {
    reasons.push('no pager text, row count grew on scroll');
    return { kind: 'scroll', confidence: 'medium', reasons };
  }
  if (rowsGrewOnScroll === false) {
    reasons.push('no pager text, row count flat across scroll');
    return { kind: 'single', confidence: 'medium', reasons };
  }
  reasons.push('no pager text and scroll growth unmeasured');
  return { kind: 'unknown', confidence: 'low', reasons };
}

/** URL 里像页码的参数名。命中即认为分页可能是 URL 驱动的（仍需 probe 证实）。 */
export const PAGE_PARAM_NAMES = /^(page|pageno|page_num|page_number|p|offset|start|from|skip|cursor)$/i;

export function findUrlPageParam(url) {
  let parsed;
  try { parsed = new URL(String(url ?? ''), 'https://placeholder.invalid'); } catch { return null; }
  for (const key of parsed.searchParams.keys()) if (PAGE_PARAM_NAMES.test(key)) return key;
  return null;
}

/* ------------------------------------------------------------------ *
 * 采页计划：**绝不默认全量**
 * ------------------------------------------------------------------ */

/** `--max-pages` 的保守默认。5 页 = 250 行（每页 50 行），够看清头部又不烧配额。 */
export const DEFAULT_MAX_PAGES = 5;
/** 硬上限：单轮再怎么也不该超过这个数，超了必须拆成多轮（锁不该被一个进程握几小时）。 */
export const HARD_MAX_PAGES = 200;

/**
 * 这一轮采哪些页。
 *
 * @param total     总页数；null = 未知（分页器没解析出来）
 * @param maxPages  本轮上限（必给，没有「不限」这个取值）
 * @param mode      'head' 顺序从头（默认）| 'stratified' 等距系统抽样
 * @param startPage head 模式的起点（续跑时用不到，done 已经能表达）
 * @param done      已经采过的页码数组（断点续跑）
 * @param offset    stratified 的随机偏移（0..step-1）；**必须由调用方传入并落盘**，
 *                  否则每次续跑抽到不同的页，样本就不是一个系统样本了
 *
 * @returns { pages, capped, coverage, step, offset, notice }
 *   capped   —— 计划被 maxPages 截断（还有页没采）。调用方必须把 notice 打出来。
 *   coverage —— 'full' 本轮结束后 done ∪ pages 覆盖了 1..total；否则 'partial'
 */
export function planPages({
  total = null, maxPages = DEFAULT_MAX_PAGES, mode = 'head',
  startPage = 1, done = [], offset = 0,
} = {}) {
  const limit = Math.max(1, Math.min(HARD_MAX_PAGES, Math.floor(Number(maxPages) || DEFAULT_MAX_PAGES)));
  const doneSet = new Set((Array.isArray(done) ? done : []).map((n) => Number(n)).filter(Number.isInteger));
  const totalPages = Number.isInteger(total) && total > 0 ? total : null;

  let candidates = [];
  let step = null;
  let usedOffset = 0;
  if (mode === 'stratified') {
    if (totalPages == null) {
      // 总页数未知就抽不了等距样本——退回 head，并在 notice 里说清楚。
      return { ...planPages({ total, maxPages: limit, mode: 'head', startPage, done }), fellBackToHead: true };
    }
    step = Math.max(1, Math.floor(totalPages / limit));
    usedOffset = ((Math.floor(Number(offset) || 0) % step) + step) % step;
    for (let k = 0; k < limit; k += 1) {
      const page = usedOffset + 1 + k * step;
      if (page > totalPages) break;
      candidates.push(page);
    }
  } else {
    const first = Math.max(1, Math.floor(Number(startPage) || 1));
    const ceiling = totalPages ?? Number.POSITIVE_INFINITY;
    for (let page = first; page <= ceiling && candidates.length < limit + doneSet.size; page += 1) {
      candidates.push(page);
      if (candidates.length > limit + doneSet.size) break;
    }
  }

  const pages = candidates.filter((page) => !doneSet.has(page)).slice(0, limit);
  const willHave = new Set([...doneSet, ...pages]);
  const coverage = totalPages != null && willHave.size >= totalPages ? 'full' : 'partial';
  const capped = coverage !== 'full';
  const totalLabel = totalPages == null ? '?' : String(totalPages);
  const notice = capped
    ? `本轮只采了 ${pages.length}/${totalLabel} 页（累计 ${willHave.size}/${totalLabel}），`
      + `mode=${mode} maxPages=${limit}${step ? ` step=${step} offset=${usedOffset}` : ''}`
      + `。这是抽样，不是全量。`
    : `本轮采 ${pages.length} 页，累计覆盖 ${willHave.size}/${totalLabel} 页（全量）。`;
  return { pages, capped, coverage, step, offset: usedOffset, notice, mode };
}

/* ------------------------------------------------------------------ *
 * 断点续跑状态机
 * ------------------------------------------------------------------ */

export const CHECKPOINT_SCHEMA_VERSION = 1;

/** 空白检查点。`url` 与 `mode`/`offset` 一旦定下就不许改（改了样本就换了）。 */
export function newCheckpoint({ url, mode = 'head', offset = 0, rowsPerPage = null, totalPages = null }) {
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    url: String(url ?? ''),
    mode,
    offset: Math.floor(Number(offset) || 0),
    rowsPerPage: rowsPerPage == null ? null : Number(rowsPerPage),
    totalPages: totalPages == null ? null : Number(totalPages),
    pages: [],       // [{ page, rows, censusFile, shotFile, fingerprint, at }]
    failures: [],    // [{ page, reason, at }]
  };
}

/**
 * 读回一个检查点。**版本对不上 / URL 对不上 / 结构不像 → 返回 null**，
 * 让调用方从头开始并把旧文件另存，绝不在一个不认识的状态上续跑
 * （harvest.md 的「写入方必须假定目标位置上已经有一份比自己更值钱的东西」）。
 */
export function loadCheckpoint(raw, { url = null } = {}) {
  let state = raw;
  if (typeof raw === 'string') {
    try { state = JSON.parse(raw); } catch { return null; }
  }
  if (!state || typeof state !== 'object') return null;
  if (state.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) return null;
  if (!Array.isArray(state.pages) || !Array.isArray(state.failures)) return null;
  if (url != null && String(state.url ?? '') !== String(url)) return null;
  return state;
}

/** 已成功采到的页码（升序，去重）。 */
export function donePages(state) {
  const set = new Set((state?.pages ?? []).map((entry) => Number(entry?.page)).filter(Number.isInteger));
  return [...set].sort((a, b) => a - b);
}

/**
 * 记一页结果。**同一页重复记录时以新的覆盖旧的**（重采一次就该用新的），
 * 但页数不重复计入 —— 否则续跑几次之后 pages.length 会虚高，行数自检跟着错。
 * 失败的页记进 `failures` 且**不**进 `pages`：下一轮计划会自然把它排进去重入。
 */
export function applyPageResult(state, result) {
  const next = { ...state, pages: [...(state?.pages ?? [])], failures: [...(state?.failures ?? [])] };
  const page = Number(result?.page);
  if (!Number.isInteger(page)) return next;
  if (result?.ok === false) {
    next.failures.push({ page, reason: String(result?.reason ?? 'unknown'), at: result?.at ?? null });
    return next;
  }
  const index = next.pages.findIndex((entry) => Number(entry.page) === page);
  const entry = {
    page,
    rows: Number(result?.rows ?? 0),
    censusFile: result?.censusFile ?? null,
    shotFile: result?.shotFile ?? null,
    fingerprint: result?.fingerprint ?? null,
    at: result?.at ?? null,
  };
  if (index >= 0) next.pages[index] = entry; else next.pages.push(entry);
  if (result?.totalPages != null) next.totalPages = Number(result.totalPages);
  if (result?.rowsPerPage != null && next.rowsPerPage == null) next.rowsPerPage = Number(result.rowsPerPage);
  return next;
}

/** 计划里还没采到的页（续跑时用来判断「这一轮还剩什么」）。 */
export function pagesRemaining(state, plannedPages) {
  const done = new Set(donePages(state));
  return (Array.isArray(plannedPages) ? plannedPages : []).filter((page) => !done.has(page));
}

/* ------------------------------------------------------------------ *
 * 行数自检
 * ------------------------------------------------------------------ */

/**
 * 采完对账。**只回报，不判决**（文件头第 2 条）。
 *
 * 四类可机器判定的不一致，各自单独回报：
 *
 *   - `shortPages`      非末页却少于 rowsPerPage 行 —— 静默丢行的头号签名
 *                       （harvest.md：长 URL 换行把整行拆散、被 minCells 滤掉，
 *                        100 行只回收 18 行且毫无报错）
 *   - `duplicatePages`  相邻两页 fingerprint 相同 —— 翻页没生效、同一页抓了两遍
 *                       （harvest.md 实测：连点 12 次 Next 抓回 1200 行、90 个唯一源）
 *   - `duplicateRows`   跨页重复行数（去重前后之差）
 *   - `totalMismatch`   全量采完时 uniqueRows ≠ 页面自报总行数
 *
 * 任一命中 → `rowCountMismatch: true`。**这个字段进 manifest，结论留给 AI。**
 */
export function verifyRowCount({
  pages = [], rowsPerPage = null, totalPages = null,
  reportedTotalRows = null, uniqueRows = null, coverage = 'partial',
} = {}) {
  const list = (Array.isArray(pages) ? pages : []).filter((entry) => Number.isInteger(Number(entry?.page)));
  const collectedRows = list.reduce((sum, entry) => sum + (Number(entry?.rows) || 0), 0);
  const perPage = Number(rowsPerPage) > 0 ? Number(rowsPerPage) : null;
  const lastPage = Number.isInteger(totalPages) && totalPages > 0 ? totalPages : null;

  const shortPages = perPage == null ? [] : list
    .filter((entry) => Number(entry.page) !== lastPage && (Number(entry.rows) || 0) < perPage)
    .map((entry) => ({ page: Number(entry.page), rows: Number(entry.rows) || 0, expected: perPage }));

  const byFingerprint = new Map();
  const duplicatePages = [];
  for (const entry of list) {
    const fingerprint = entry?.fingerprint;
    if (!fingerprint) continue;
    if (byFingerprint.has(fingerprint)) {
      duplicatePages.push({ page: Number(entry.page), sameAs: byFingerprint.get(fingerprint) });
    } else byFingerprint.set(fingerprint, Number(entry.page));
  }

  const unique = uniqueRows == null ? null : Number(uniqueRows);
  const duplicateRows = unique == null ? null : Math.max(0, collectedRows - unique);

  let expectedTotalRows = null;
  if (coverage === 'full') {
    if (reportedTotalRows != null) expectedTotalRows = Number(reportedTotalRows);
    else if (perPage != null && lastPage != null) expectedTotalRows = null; // 末页行数未知，不猜
  }
  const totalMismatch = expectedTotalRows != null && unique != null && unique !== expectedTotalRows;

  const reasons = [];
  if (shortPages.length) reasons.push(`shortPages:${shortPages.length}`);
  if (duplicatePages.length) reasons.push(`duplicatePages:${duplicatePages.length}`);
  if (duplicateRows) reasons.push(`duplicateRows:${duplicateRows}`);
  if (totalMismatch) reasons.push(`totalRows:${unique}!=${expectedTotalRows}`);

  return {
    rowCountMismatch: reasons.length > 0,
    coverage,
    pagesCounted: list.length,
    collectedRows,
    uniqueRows: unique,
    duplicateRows,
    expectedTotalRows,
    reportedTotalRows: reportedTotalRows == null ? null : Number(reportedTotalRows),
    shortPages,
    duplicatePages,
    reasons,
  };
}

/* ------------------------------------------------------------------ *
 * 行重建（与页面里跑的是同一份源码）
 * ------------------------------------------------------------------ */

/**
 * 按 Y 坐标把散落的单元格聚回行。**这份源码会被 `.toString()` 塞进页面执行**
 * （同 ground-truth.mjs 的 `pickScrollContainer` 手法），所以：
 *   - 不许引用模块作用域的任何东西；
 *   - 阈值写成默认参数。
 *
 * 两条从 harvest.browser.js 搬过来的血泪（那边是唯一记着这两件事的地方）：
 *   - 锚点不能用行号列：实测 100 行漏 23 行（行号格偶尔落进相邻 Y 分桶）。
 *     所以这里**不设锚点列**，纯按 Y 聚类再按 X 排序。
 *   - **不用固定分桶（`round(y/6)*6`），用「排序后按间隙断行」。** 固定分桶有
 *     边界伪影：y=140 落 138 桶、y=141 落 144 桶，同一行被劈成两半，
 *     再各自不足 `minCells` 被丢掉——正是 harvest.browser.js 那类「静默丢行」
 *     的成因。按间隙断行没有边界，只有「和本行第一个格差多远」。
 *
 * @param cells [{ x, y, t }]
 * @param tolerance 同一行内 y 的最大跨度（px）。比行高小、比同行抖动大。
 * @returns [{ y, cells: [t...] }] 按 y 升序
 */
export function clusterCellsByY(cells, { tolerance = 6, minCells = 2 } = {}) {
  const points = [];
  for (const cell of (Array.isArray(cells) ? cells : [])) {
    const y = Number(cell?.y);
    const x = Number(cell?.x);
    const t = cell?.t;
    if (!Number.isFinite(y) || !Number.isFinite(x) || t == null || t === '') continue;
    points.push({ x, y, t: String(t) });
  }
  points.sort((a, b) => a.y - b.y);
  const groups = [];
  for (const point of points) {
    const last = groups[groups.length - 1];
    if (last && point.y - last.anchor <= tolerance) last.items.push(point);
    else groups.push({ anchor: point.y, items: [point] });
  }
  const rows = [];
  for (const group of groups) {
    if (group.items.length < minCells) continue;
    group.items.sort((a, b) => a.x - b.x);
    rows.push({ y: group.anchor, cells: group.items.map((item) => item.t) });
  }
  return rows;
}

/**
 * 一页的指纹：**只用行内容，不用页码**——这样「翻页没生效」才暴露得出来
 * （页码变了但内容没变 = 同一页抓了两遍）。
 */
export function pageFingerprint(rows) {
  const body = (Array.isArray(rows) ? rows : []).map((row) => (Array.isArray(row) ? row.join('\t') : String(row ?? ''))).join('\n');
  let hash = 5381;
  for (let index = 0; index < body.length; index += 1) {
    hash = ((hash * 33) ^ body.charCodeAt(index)) >>> 0;
  }
  return `${body.length}-${hash.toString(16)}`;
}

/** 跨页去重：整行文本相同即同一行。返回 { rows, unique, duplicates }。 */
export function dedupeRows(rowsByPage) {
  const seen = new Set();
  const rows = [];
  let duplicates = 0;
  for (const page of (Array.isArray(rowsByPage) ? rowsByPage : [])) {
    for (const row of (Array.isArray(page) ? page : [])) {
      const line = Array.isArray(row) ? row.join('\t') : String(row ?? '');
      if (seen.has(line)) { duplicates += 1; continue; }
      seen.add(line);
      rows.push(line);
    }
  }
  return { rows, unique: rows.length, duplicates };
}
