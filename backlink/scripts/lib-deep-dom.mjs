/**
 * lib-deep-dom.mjs — 一份**穿透 shadow DOM** 的共用 DOM 遍历，外加它的两个副产品：
 * 「浅层 vs 深层」的差值诊断，和分段滚动的能力。
 *
 * ──────────────────────────────────────────────────────────────────────
 * 为什么存在（2026-08-29 只读实盘，同一页同一时刻）
 * ──────────────────────────────────────────────────────────────────────
 *
 *     document.body.innerText.length      →        59
 *     穿透 shadow DOM 的深层文本长度        → 1,605,054
 *     document 里的 shadow root 数量        →        44
 *
 * Semrush 把外壳和报表挂件渲染在 **44 个 shadow root** 里。`innerText` 不穿透
 * shadow DOM，`querySelectorAll` 也不穿透。**所以在这一天之前，本仓库所有按
 * `table` / 单元格 / `innerText` 计数的探针，量到的都只是页面的一小块。**
 * 同一页穿透前后的对照：`svg` 32 → 45、3 → 16、49 → 62。
 *
 * ⚠️ **这个教训本仓库已经交过一次学费了。** Semrush 的侧栏也在 shadow DOM 里，
 * 当时的结论是「侧栏看不见」，直到改用
 * `document.querySelectorAll('snav-sidebar-ribbon-item, snav-sidebar-list-item')`
 * + `el.shadowRoot.querySelector('a')` 才拿到 15 个额外页面。**那次只修了侧栏
 * 一处，没有推广到取数探针**，于是同一个失明又完整地演了一遍。这个文件就是那次
 * 「只修一处」的补课：**任何计数型 DOM 探针都从这里走，不许再各写各的。**
 *
 * ──────────────────────────────────────────────────────────────────────
 * 三条设计约束
 * ──────────────────────────────────────────────────────────────────────
 *
 * 1. **浅层读数保留，两个都输出。** `lightDom` 与 `deep` 的差值本身就是一个诊断
 *    信号：「这一页有多少东西藏在 shadow DOM 里」。只留深层读数就丢掉了这个信号，
 *    也丢掉了和历史记录对账的能力（历史那些数字全是浅层的）。
 * 2. **计数和取全文是两件事，性能上必须分开。** 深层文本 1.6M 字符，无脑
 *    `join('')` 再 `.length` 会在每一轮轮询里搬一次 1.6MB。所以
 *    `deepTextLength()` **只累加长度、从不拼接**，`deepTextSample()` 拼到上限就
 *    停手。要计数的地方永远不许调取全文的那个。
 * 3. **闭合 shadow root 拿不到。** `el.shadowRoot` 对 `mode: 'closed'` 返回 null，
 *    没有任何 API 能绕过。所以深层读数是**下界**，不是全集——`readDomCensus()`
 *    会把遍历到的 root 数一并回报，好让下游知道这次穿了多少层。
 *
 * ──────────────────────────────────────────────────────────────────────
 * 怎么用
 * ──────────────────────────────────────────────────────────────────────
 * 这些函数**既要能离线喂假 DOM 做测试，又要能被塞进页面里执行**。所以：
 *   - 每个函数都是自足的：不引用模块作用域的常量，选择器一律写成默认参数；
 *   - `DEEP_DOM_JS` 把它们 `.toString()` 拼成一段源码，探针模板这样用：
 *
 *       evalPage(`(() => { ${DEEP_DOM_JS}
 *         return JSON.stringify(readDomCensus(document, { scopeSelector: ... }));
 *       })()`)
 */

/**
 * 从 `root` 出发，收集它自己和它底下**所有**（开放的）shadow root。
 *
 * 走法就是标准那一套：`querySelectorAll('*')` 拿到本 root 内的全部元素，逐个看
 * `el.shadowRoot`，命中就入队继续往里走。`maxRoots` 是**兜底**，不是判据——它防的
 * 是病态页面把一次探针拖死，触发时 `readDomCensus` 会把 `rootsTruncated` 标出来，
 * 让下游知道这次读数不完整，而不是悄悄少数几个。
 */
export function collectRoots(root, { maxRoots = 2000 } = {}) {
  const roots = [root];
  const seen = new Set([root]);
  const queue = [root];
  let truncated = false;
  while (queue.length) {
    const current = queue.shift();
    let elements;
    try { elements = current.querySelectorAll('*'); } catch { continue; }
    for (const element of elements) {
      const shadow = element.shadowRoot;
      if (!shadow || seen.has(shadow)) continue;
      if (roots.length >= maxRoots) { truncated = true; break; }
      seen.add(shadow);
      roots.push(shadow);
      queue.push(shadow);
    }
    if (truncated) break;
  }
  return { roots, truncated };
}

/** 穿透版 `querySelectorAll`。返回数组（不是 NodeList），跨 root 拼在一起。 */
export function deepQueryAll(root, selector, options = {}) {
  const { roots } = collectRoots(root, options);
  const out = [];
  for (const current of roots) {
    let found;
    try { found = current.querySelectorAll(selector); } catch { continue; }
    for (const node of found) out.push(node);
  }
  return out;
}

/** 穿透版计数。**只数个数，绝不碰文本**——轮询里跑的就是这一个。 */
export function deepCount(root, selector, options = {}) {
  return deepQueryAll(root, selector, options).length;
}

/**
 * 深层文本**长度**。逐个 root 累加，**从不拼接**——见文件头第 2 条。
 *
 * 每个 root 用它自己的 `innerText`（拿不到就退 `textContent`）：shadow host 的
 * `innerText` 不含它 shadow 里的内容，所以「各 root 分别取、把长度加起来」就是
 * 深层文本的长度，不会重复计。
 */
export function deepTextLength(root, options = {}) {
  const { roots } = collectRoots(root, options);
  let total = 0;
  for (const current of roots) {
    const text = current.innerText != null ? current.innerText : (current.textContent || '');
    total += String(text).length;
  }
  return total;
}

/**
 * 深层文本的**样本**，拼到 `maxChars` 就停手。给「要读内容」的场合用
 * （解析器、空态文案匹配），**不给计数用**。
 */
export function deepTextSample(root, options = {}) {
  const { maxChars = 60000 } = options;
  const { roots } = collectRoots(root, options);
  const parts = [];
  let length = 0;
  for (const current of roots) {
    if (length >= maxChars) break;
    const text = String(current.innerText != null ? current.innerText : (current.textContent || ''));
    if (!text) continue;
    parts.push(text.slice(0, maxChars - length));
    length += text.length;
  }
  return parts.join('\n');
}

/** 非空单元格计数。`filled` 的判断和 semrush-report.mjs 的表体区探针同一口径。 */
export function deepFilledCells(root, options = {}) {
  const { cellSelector = 'td, [role="gridcell"], [role="cell"]' } = options;
  let filled = 0;
  for (const cell of deepQueryAll(root, cellSelector, options)) {
    const text = cell.innerText != null ? cell.innerText : (cell.textContent || '');
    if (String(text).replace(/\s+/g, ' ').trim() !== '') filled += 1;
  }
  return filled;
}

/**
 * 找出**真正能滚的容器**，包括藏在 shadow root 里的那些。
 *
 * ⚠️ 这一条直接关系到 2026-08-29 那个「滚动不是根因」的结论能不能成立。那次的观测是
 * `body.scrollHeight === window.innerHeight`、`scrollY` 滚 8 次没动过。但在一个把
 * 外壳挂在 44 个 shadow root 里的页面上，**滚动条很可能根本不在 window 上**——
 * 滚了 8 次没动，也可能只是滚错了对象。所以这里把候选滚动容器数出来，让下一次实盘
 * 能用数据判，而不是继续推论。
 */
export function deepScrollContainers(root, options = {}) {
  const out = [];
  for (const element of deepQueryAll(root, '*', options)) {
    const scrollHeight = Number(element.scrollHeight || 0);
    const clientHeight = Number(element.clientHeight || 0);
    if (clientHeight > 0 && scrollHeight - clientHeight > 32) {
      out.push({
        tag: String(element.tagName || '').toLowerCase(),
        scrollHeight,
        clientHeight,
      });
    }
  }
  return out;
}

/**
 * 一次读完：浅层一份、深层一份、差值一份。
 *
 * `scopeSelector` 是报表区的根。**它在深层里找**（旧代码用
 * `document.querySelector(sel)`，在这个站上连报表区都可能因为在 shadow root 里而
 * 找不到，于是静默退回 `document.body`——也就是退回到 59 个字符）。
 * `scopeResolved: false` 必须被下游看见：判据没绑上就不许出结论。
 */
export function readDomCensus(documentRef, options = {}) {
  const {
    scopeSelector = null,
    sampleChars = 60000,
    // 2026-08-29 试点发现的计数歧义：`'table, [role="grid"]'` 混在一个 `tables`
    // 计数里，top-pages 页面 0 个 <table>、1 个 role=grid 的 DIV，读数报
    // `tables: 1`——下游无法区分「真表格」和「grid 角色的 DIV」。所以拆成两个
    // 字段分别数。**cells 的来源选择器不变**：单元格口径本来就同时收
    // td / gridcell / cell，没有歧义。
    tableSelector = 'table',
    gridSelector = '[role="grid"]',
    cellSelector = 'td, [role="gridcell"], [role="cell"]',
  } = options;

  const documentRoot = documentRef.body || documentRef.documentElement || documentRef;
  const scoped = scopeSelector
    ? (deepQueryAll(documentRoot, scopeSelector)[0] || null)
    : null;
  const root = scoped || documentRoot;

  const lightText = String(
    (root.innerText != null ? root.innerText : root.textContent) || '',
  );
  const lightCells = (() => {
    let filled = 0;
    let cells;
    try { cells = root.querySelectorAll(cellSelector); } catch { return { total: 0, filled: 0 }; }
    let total = 0;
    for (const cell of cells) {
      total += 1;
      const text = cell.innerText != null ? cell.innerText : (cell.textContent || '');
      if (String(text).replace(/\s+/g, ' ').trim() !== '') filled += 1;
    }
    return { total, filled };
  })();

  const collected = collectRoots(root);
  const deepCells = deepQueryAll(root, cellSelector);
  let deepFilled = 0;
  for (const cell of deepCells) {
    const text = cell.innerText != null ? cell.innerText : (cell.textContent || '');
    if (String(text).replace(/\s+/g, ' ').trim() !== '') deepFilled += 1;
  }

  const lightDom = {
    tables: root.querySelectorAll(tableSelector).length,
    grids: root.querySelectorAll(gridSelector).length,
    cells: lightCells.total,
    filledCells: lightCells.filled,
    svgText: root.querySelectorAll('svg text').length,
    canvas: root.querySelectorAll('canvas').length,
    textLength: lightText.length,
  };
  const deep = {
    tables: deepQueryAll(root, tableSelector).length,
    grids: deepQueryAll(root, gridSelector).length,
    cells: deepCells.length,
    filledCells: deepFilled,
    svgText: deepQueryAll(root, 'svg text').length,
    canvas: deepQueryAll(root, 'canvas').length,
    textLength: deepTextLength(root),
  };

  return {
    scopeSelector: scopeSelector || null,
    // 报表区的根有没有真的找到。false = 判据退回了整页，**不许据此出结论**。
    scopeResolved: Boolean(scoped),
    // 穿透遍历自报家门：下游据此区分「浅层探针」和「穿透探针」的读数。
    deepProbe: true,
    // `roots[0]` 是起点本身，所以 shadow root 数 = 长度 - 1。
    shadowRoots: collected.roots.length - 1,
    rootsTruncated: collected.truncated,
    lightDom,
    deep,
    // 差值就是「这一页有多少东西藏在 shadow DOM 里」，本身是诊断信号，不是废话。
    hiddenBehindShadow: {
      tables: deep.tables - lightDom.tables,
      grids: deep.grids - lightDom.grids,
      cells: deep.cells - lightDom.cells,
      filledCells: deep.filledCells - lightDom.filledCells,
      svgText: deep.svgText - lightDom.svgText,
      canvas: deep.canvas - lightDom.canvas,
      textLength: deep.textLength - lightDom.textLength,
    },
    deepText: deepTextSample(root, { maxChars: sampleChars }),
    scrollContainers: deepScrollContainers(root).slice(0, 20),
  };
}

/**
 * 分段滚动的**分段计划**。纯函数，离线可测。
 *
 * 每段前进不到一屏（留 `overlapRatio` 的重叠），因为按整屏跳会让「刚好卡在两段
 * 边界上的一行」两次都不在视口里。`maxSegments` 是兜底：不封顶的话一个
 * `scrollHeight` 读错的页面能把探针拖到超时。
 */
export function planScrollSegments({
  scrollHeight = 0,
  viewportHeight = 0,
  maxSegments = 12,
  overlapRatio = 0.2,
} = {}) {
  const view = Number(viewportHeight) || 0;
  const total = Number(scrollHeight) || 0;
  if (view <= 0 || total <= view) return [];
  const step = Math.max(1, Math.round(view * (1 - overlapRatio)));
  const offsets = [];
  for (let y = step; y < total - view + step && offsets.length < maxSegments; y += step) {
    offsets.push(Math.min(y, total - view));
    if (offsets[offsets.length - 1] >= total - view) break;
  }
  return offsets;
}

/**
 * 驱动层的分段滚动：滚一段、等一段、再读。`evalPage` 与 `sleep` 由调用方注入，
 * 所以这个函数离线可测（喂一个假的 evalPage 即可）。
 *
 * ⚠️ **默认关闭，理由写在调用方的 flag 注释里。** 这里只提供能力。
 *
 * ⚠️ **本次观测的限度，必须写下来：** 2026-08-29 实测这几条路由
 * `body.scrollHeight === window.innerHeight`（772）、`scrollY` 滚 8 次没动过、
 * 350 秒内所有数字冻结。**但那是因为整个报表模块渲染成了空白**——一个什么都没渲染的
 * 页面当然没有首屏之下的内容。**不能推广成「这个站不需要滚动」**，也不能推广成
 * 「window 就是滚动容器」：见 `deepScrollContainers()` 的注释，真正的滚动条很可能
 * 在某个 shadow root 里，滚 window 不动是完全一致的表现。
 */
export async function scrollThroughSegments(evalPage, {
  sleep,
  segmentPauseMs = 1500,
  maxSegments = 12,
  overlapRatio = 0.2,
} = {}) {
  const metrics = JSON.parse(await evalPage(`(() => JSON.stringify({
    scrollHeight: Math.max(document.documentElement.scrollHeight, (document.body && document.body.scrollHeight) || 0),
    viewportHeight: window.innerHeight,
    scrollY: window.scrollY,
  }))()`));
  const offsets = planScrollSegments({ ...metrics, maxSegments, overlapRatio });
  const visited = [];
  for (const offset of offsets) {
    const landed = JSON.parse(await evalPage(
      `(() => { window.scrollTo(0, ${offset}); return JSON.stringify({ requested: ${offset}, scrollY: window.scrollY }); })()`,
    ));
    visited.push(landed);
    if (sleep) await sleep(segmentPauseMs);
  }
  // 回到顶部：探针后面还要读页头，停在半路会让页头的域名核对读到空。
  if (offsets.length) await evalPage('(() => { window.scrollTo(0, 0); return JSON.stringify({ scrollY: window.scrollY }); })()');
  return {
    ...metrics,
    segments: offsets.length,
    visited,
    // window 一次都没真的动过 —— 别把它读成「没有首屏之下的内容」，
    // 它同样可能是「滚动容器不是 window」。
    windowNeverMoved: offsets.length > 0 && visited.every((v) => Number(v.scrollY) === 0),
  };
}

/**
 * 把上面这些函数拼成一段可以塞进 `evalPage` 的源码。
 *
 * 只收**页面侧**要用的那几个。`scrollThroughSegments` 是驱动层的（它 await
 * evalPage 自己），不进这里。
 */
export const DEEP_DOM_JS = [
  collectRoots,
  deepQueryAll,
  deepCount,
  deepTextLength,
  deepTextSample,
  deepFilledCells,
  deepScrollContainers,
  readDomCensus,
].map((fn) => fn.toString()).join('\n');
