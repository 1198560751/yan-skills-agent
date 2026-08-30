// backlink/scripts/lib-deep-dom.mjs 的行为断言。
//
// 这个文件锁的是 2026-08-29 那个**结构性失明**的根因：同一页同一刻，
// `document.body.innerText.length` = 59，穿透 shadow DOM 之后 = 1,605,054，
// 页面里 44 个 shadow root。`innerText` / `querySelectorAll` 都不穿透，所以在这之前
// 本仓库量到的 `table` / 单元格 / 文本长度全是页面的一小块。
//
// 锁五件事：
//   1. 穿透遍历真的穿透，而且**多层**都穿（shadow root 里还有 shadow root）；
//   2. 计数与取全文是分开的两条路径（1.6M 字符不许在轮询里被搬来搬去）；
//   3. 闭合 shadow root 拿不到，读数是**下界**，而且这件事要能被看见；
//   4. `readDomCensus` 同时输出浅层与深层，差值本身是诊断信号；
//   5. 分段滚动的分段计划（重叠、封顶、页面不够高就一段都不滚）。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEEP_DOM_JS,
  collectRoots,
  deepCount,
  deepFilledCells,
  deepQueryAll,
  deepScrollContainers,
  deepTextLength,
  deepTextSample,
  planScrollSegments,
  readChartGeometry,
  readDomCensus,
  scrollThroughSegments,
} from '../scripts/lib-deep-dom.mjs';

// ---------------------------------------------------------------------------
// 迷你 DOM，带 shadow root。选择器只支持标签、[attr="v"]、`*` 和逗号列表——
// 够跑本文件用到的那几条，不值得为它引 jsdom。
// ---------------------------------------------------------------------------
function element(tag, attributes = {}, children = []) {
  const node = {
    tag,
    tagName: tag.toUpperCase(),
    attrs: attributes,
    children: typeof children === 'string' ? [] : children,
    ownText: typeof children === 'string' ? children : '',
    shadowRoot: null,
    scrollHeight: 0,
    clientHeight: 0,
  };
  for (const child of node.children) child.parent = node;
  Object.defineProperty(node, 'textContent', { get: () => text(node) });
  Object.defineProperty(node, 'innerText', { get: () => text(node) });
  node.querySelectorAll = (selector) => queryAll(node, selector);
  node.querySelector = (selector) => queryAll(node, selector)[0] || null;
  return node;
}

/** open shadow root。`closed: true` 模拟闭合——`shadowRoot` 留 null，谁也拿不到。 */
function attachShadow(host, children = [], { closed = false } = {}) {
  const root = element('#shadow-root', {}, children);
  if (!closed) host.shadowRoot = root;
  return host;
}

function text(node) {
  return node.ownText + node.children.map(text).join('');
}

function descendants(node, out = []) {
  for (const child of node.children) {
    out.push(child);
    descendants(child, out);
  }
  return out;
}

function matches(node, selector) {
  const part = selector.trim();
  if (part === '*') return true;
  const attribute = part.match(/^\[([\w-]+)="([^"]*)"\]$/);
  if (attribute) return node.attrs[attribute[1]] === attribute[2];
  return node.tag === part;
}

function queryAll(root, selector) {
  const found = [];
  for (const branch of selector.split(',')) {
    for (const node of descendants(root)) {
      if (matches(node, branch) && !found.includes(node)) found.push(node);
    }
  }
  return found;
}

const cell = (value) => element('td', {}, value);

/**
 * 三层结构：body → shadow(外壳) → shadow(报表挂件) → 表格。
 * 报表区的表格藏在**第二层** shadow root 里，所以只穿一层的实现照样会漏。
 */
function shadowPage() {
  const table = element('table', {}, [
    element('tr', {}, [cell('canva.com'), cell('7.9亿'), cell(''), cell('84.26%')]),
  ]);
  const widget = attachShadow(element('sm-report-widget', {}, []), [
    table, element('svg', {}, [element('text', {}, '42')]), element('canvas', {}, []),
  ]);
  const shell = attachShadow(element('sm-app-shell', {}, []), [widget]);
  return element('body', {}, [element('div', {}, 'shell'), shell]);
}

test('穿透遍历逐层进 shadow root，浅层什么都看不到', () => {
  const body = shadowPage();

  // 浅层：这就是那份 `tables:0, cells:0` 的读数。
  assert.equal(body.querySelectorAll('table').length, 0);
  assert.equal(body.querySelectorAll('td').length, 0);

  // 深层：两层都穿过去了。
  assert.equal(deepCount(body, 'table'), 1, '第二层 shadow root 里的表也要数到');
  assert.equal(deepCount(body, 'td'), 4);
  assert.equal(deepCount(body, 'svg'), 1);
  assert.equal(deepCount(body, 'canvas'), 1);
  assert.equal(deepFilledCells(body), 3, '空单元格不算 —— 和表体区探针同一口径');

  const { roots, truncated } = collectRoots(body);
  assert.equal(roots.length, 3, 'body 自己 + 两个 shadow root');
  assert.equal(truncated, false);
  assert.equal(deepQueryAll(body, 'table')[0].tag, 'table');
});

test('闭合 shadow root 拿不到 —— 深层读数是下界，不是全集', () => {
  const hidden = attachShadow(element('sm-closed', {}, []), [element('table', {}, [])], { closed: true });
  const body = element('body', {}, [hidden]);
  assert.equal(deepCount(body, 'table'), 0, 'mode:closed 没有任何 API 能绕过');
  assert.equal(collectRoots(body).roots.length, 1);
});

test('maxRoots 是兜底，触发时必须自报 truncated 而不是悄悄少数几个', () => {
  const hosts = Array.from({ length: 5 }, () => attachShadow(element('x-host', {}, []), [element('table', {}, [])]));
  const body = element('body', {}, hosts);
  const all = collectRoots(body);
  assert.equal(all.roots.length, 6);
  assert.equal(all.truncated, false);
  const capped = collectRoots(body, { maxRoots: 3 });
  assert.equal(capped.roots.length, 3);
  assert.equal(capped.truncated, true, '读数不完整这件事必须能被下游看见');
});

test('计数和取全文是两条路径：长度只累加，样本拼到上限就停手', () => {
  const big = (n, char) => element('div', {}, char.repeat(n));
  const host = attachShadow(element('x-host', {}, []), [big(1000, 'b')]);
  const body = element('body', {}, [big(50, 'a'), host]);

  assert.equal(body.innerText.length, 50, '浅层只看得到 50');
  assert.equal(deepTextLength(body), 1050, '深层 = 各 root 自己文本长度之和，不重复计');

  // 取样：给上限就不许超。这就是「1.6M 字符不许在轮询里被无脑 join」的那条约束。
  const sample = deepTextSample(body, { maxChars: 100 });
  assert.ok(sample.length <= 101, `sample=${sample.length}`);
  assert.ok(sample.startsWith('a'.repeat(50)));
  assert.ok(deepTextSample(body).length > 1000, '不给上限时默认 60000，本例全取得到');
});

test('readDomCensus 同时输出浅层与深层，差值是诊断信号', () => {
  const body = shadowPage();
  const census = readDomCensus({ body });
  assert.equal(census.deepProbe, true);
  assert.equal(census.shadowRoots, 2);
  assert.equal(census.rootsTruncated, false);

  assert.deepEqual(census.lightDom, {
    tables: 0, grids: 0, cells: 0, filledCells: 0, svgText: 0, canvas: 0, textLength: 'shell'.length,
  });
  assert.equal(census.deep.tables, 1);
  assert.equal(census.deep.grids, 0);
  assert.equal(census.deep.cells, 4);
  assert.equal(census.deep.filledCells, 3);
  assert.equal(census.deep.canvas, 1);

  // 「这一页有多少东西藏在 shadow DOM 里」——这一栏本身就是这次事故的诊断量。
  assert.equal(census.hiddenBehindShadow.tables, 1);
  assert.equal(census.hiddenBehindShadow.grids, 0);
  assert.equal(census.hiddenBehindShadow.filledCells, 3);
  assert.ok(census.hiddenBehindShadow.textLength > 0);
  assert.ok(census.deepText.includes('7.9亿'));
});

test('table 与 [role=grid] 分开计数 —— 试点那份 tables:1 的歧义不能再出现', () => {
  // 2026-08-29 试点实测：top-pages 页面 0 个 <table>、1 个 role=grid 的 DIV，
  // 旧读数把两者混在 `tables: 1` 里，无法区分「真表格」和「grid 角色的容器」。
  const grid = element('div', { role: 'grid' }, [
    element('div', { role: 'gridcell' }, '主页'),
    element('div', { role: 'gridcell' }, '39.47%'),
    element('div', { role: 'gridcell' }, ''),
  ]);
  const body = element('body', {}, [grid]);
  const census = readDomCensus({ body });

  assert.equal(census.lightDom.tables, 0, '<table> 一个都没有，tables 必须是 0');
  assert.equal(census.lightDom.grids, 1, 'role=grid 的 DIV 记进 grids');
  assert.equal(census.deep.tables, 0);
  assert.equal(census.deep.grids, 1);
  // cells 的来源选择器不变：gridcell 照旧计入 cells / filledCells。
  assert.equal(census.deep.cells, 3);
  assert.equal(census.deep.filledCells, 2);
});

test('报表区的根要在深层里找 —— 找不到必须 scopeResolved:false，不许静默退回整页', () => {
  const report = element('section', { 'data-testid': 'report-region' }, [cell('900')]);
  const shell = attachShadow(element('sm-app-shell', {}, []), [report]);
  const body = element('body', {}, [shell]);

  const scoped = readDomCensus({ body }, { scopeSelector: '[data-testid="report-region"]' });
  assert.equal(scoped.scopeResolved, true, '报表区自己就在 shadow root 里 —— 浅层 querySelector 找不到它');
  assert.equal(scoped.deep.filledCells, 1);

  const missing = readDomCensus({ body }, { scopeSelector: '[data-testid="nope"]' });
  assert.equal(missing.scopeResolved, false);
});

test('滚动容器也要穿透着找 —— 「滚 window 不动」不等于「没有首屏之下的内容」', () => {
  const scroller = element('div', {}, []);
  scroller.scrollHeight = 4000;
  scroller.clientHeight = 772;
  const body = element('body', {}, [attachShadow(element('x-host', {}, []), [scroller])]);
  const found = deepScrollContainers(body);
  assert.equal(found.length, 1, '真正的滚动条在 shadow root 里，滚 window 当然不动');
  assert.deepEqual(found[0], { tag: 'div', scrollHeight: 4000, clientHeight: 772 });
});

test('分段计划：重叠、封顶、不够高就一段都不滚', () => {
  // 2026-08-29 实测的形状：scrollHeight === innerHeight === 772 ⇒ 无事可做。
  assert.deepEqual(planScrollSegments({ scrollHeight: 772, viewportHeight: 772 }), []);
  assert.deepEqual(planScrollSegments({ scrollHeight: 0, viewportHeight: 0 }), []);

  const offsets = planScrollSegments({ scrollHeight: 3000, viewportHeight: 1000, overlapRatio: 0.2 });
  assert.deepEqual(offsets, [800, 1600, 2000], '每段前进 800（留 20% 重叠），末段停在 scrollHeight-viewport');
  assert.ok(offsets.every((y, i) => i === 0 || y > offsets[i - 1]), '严格递增');

  const capped = planScrollSegments({ scrollHeight: 1e6, viewportHeight: 800, maxSegments: 4 });
  assert.equal(capped.length, 4, 'maxSegments 是兜底：scrollHeight 读错了也不许把探针拖死');
});

test('分段滚动驱动层：滚一段等一段，最后回顶，window 没动过要说出来', async () => {
  const calls = [];
  const waits = [];
  const evalPage = async (source) => {
    calls.push(source);
    if (source.includes('scrollHeight:')) {
      return JSON.stringify({ scrollHeight: 3000, viewportHeight: 1000, scrollY: 0 });
    }
    // 这就是实盘那 8 次「scrollY 从没动过」——因为真正的滚动容器不是 window。
    return JSON.stringify({ requested: 0, scrollY: 0 });
  };
  const result = await scrollThroughSegments(evalPage, { sleep: async (ms) => waits.push(ms), segmentPauseMs: 1500 });

  assert.equal(result.segments, 3);
  assert.deepEqual(waits, [1500, 1500, 1500], '每段之间必须等 —— 滚过去不等于渲染出来了');
  assert.equal(result.windowNeverMoved, true);
  assert.ok(calls[calls.length - 1].includes('window.scrollTo(0, 0)'), '读页头之前要回到顶部');
  assert.equal(calls.filter((c) => c.includes('window.scrollTo')).length, 4, '3 段 + 1 次回顶');

  // 页面不够高时一次都不滚，也不回顶。
  const flat = await scrollThroughSegments(
    async () => JSON.stringify({ scrollHeight: 772, viewportHeight: 772, scrollY: 0 }),
    { sleep: async () => {} },
  );
  assert.equal(flat.segments, 0);
  assert.equal(flat.windowNeverMoved, false, '一段都没滚，不构成「window 没动过」的证据');
});

// ---------------------------------------------------------------------------
// 注入源码：探针模板把 DEEP_DOM_JS 塞进 evalPage 执行，所以它必须是自足的
// （不引用任何模块作用域的常量），否则在页面里跑会 ReferenceError。
// ---------------------------------------------------------------------------
test('DEEP_DOM_JS 自足可执行，且带上了页面侧要用的每一个函数', () => {
  for (const name of ['collectRoots', 'deepQueryAll', 'deepCount', 'deepTextLength',
    'deepTextSample', 'deepFilledCells', 'deepScrollContainers', 'readDomCensus']) {
    assert.match(DEEP_DOM_JS, new RegExp(`function ${name}\\(`), `${name} 必须在注入源码里`);
  }
  assert.doesNotMatch(DEEP_DOM_JS, /\bexport\b/, '注入的是函数体，不是模块');
  // 驱动层的那个要 await evalPage，不能进页面。
  assert.doesNotMatch(DEEP_DOM_JS, /function scrollThroughSegments\(/);

  // 真的跑一遍：在一个干净的作用域里 eval 出来，喂同一个假 DOM，结果必须和
  // 直接 import 的实现逐位相同。这才是「自足」的证明，光 grep 函数名不算。
  // eslint-disable-next-line no-new-func
  const run = new Function(`${DEEP_DOM_JS}\nreturn readDomCensus(arguments[0]);`);
  const body = shadowPage();
  assert.deepEqual(run({ body }), readDomCensus({ body }));
});

// ---------------------------------------------------------------------------
// readChartGeometry() —— chart-only 路由的采集面（2026-08-30 补）。
//
// 它存在的理由写在函数注释里：census 的 `svgText` 是**计数**，`deepText` 有轴刻度
// 但**没有任何一个数据点的值**。Semrush 折线图不渲染数据标签，逐点数值只在像素里。
// 这里锁三件事：坐标取渲染后的 rect（不是被 viewBox 缩放过的属性）、柱取顶而点取心、
// 图标级的小 svg 不当图表。
// ---------------------------------------------------------------------------
function svgNode(tag, rect, attrs = {}, children = []) {
  const node = element(tag, attrs, children);
  node.getBoundingClientRect = () => rect;
  node.getAttribute = (name) => (name in attrs ? attrs[name] : null);
  return node;
}

test('readChartGeometry 取渲染后的 rect，柱取顶、点取心，图标级小 svg 不当图表', () => {
  const tick = svgNode('text', { left: 0, top: 95, width: 20, height: 10 }, {}, '4000万');
  const dot = svgNode('circle', { left: 55, top: 145, width: 10, height: 10 });
  const bar = svgNode('rect', { left: 80, top: 120, width: 8, height: 60 });
  const chart = svgNode('svg', { left: 0, top: 0, width: 600, height: 300 }, {}, [tick, dot, bar]);
  const icon = svgNode('svg', { left: 0, top: 0, width: 16, height: 16 }, {}, [
    svgNode('circle', { left: 0, top: 0, width: 8, height: 8 }),
  ]);
  const body = element('body', {}, [chart, icon]);

  const out = readChartGeometry(body);
  assert.equal(out.charts.length, 1, '16×16 的图标 svg 不该被当成图表');
  assert.equal(out.svgCount, 2, 'svgCount 报的是遍历到的全部 svg，含被过滤掉的');
  assert.deepEqual(out.charts[0].texts, [{ text: '4000万', x: 10, y: 100 }]);
  // 点取圆心 145+5=150；柱取顶 120（不是柱心 150）——柱图的值在柱顶。
  assert.equal(out.charts[0].marks[0].y, 150);
  assert.equal(out.charts[0].marks[1].y, 120);
});

test('readChartGeometry 在没有 getBoundingClientRect 的节点上不抛错', () => {
  const plain = element('svg', {}, [element('text', {}, '4000万')]);
  assert.doesNotThrow(() => readChartGeometry(element('body', {}, [plain])));
  // rect 拿不到 ⇒ 该 svg 尺寸未知 ⇒ 不当图表，而不是当成一张空图表。
  assert.deepEqual(readChartGeometry(element('body', {}, [plain])).charts, []);
});

test('readDomCensus 默认不采几何；chartGeometry:true 时字段才出现', () => {
  const chart = svgNode('svg', { left: 0, top: 0, width: 600, height: 300 }, {}, [
    svgNode('text', { left: 0, top: 95, width: 20, height: 10 }, {}, '0'),
  ]);
  const body = element('body', {}, [chart]);
  // 「这轮没开几何」和「开了但一张图都没有」必须可分辨：前者字段不存在。
  assert.equal('chartGeometry' in readDomCensus({ body }), false);
  const on = readDomCensus({ body }, { chartGeometry: true });
  assert.equal(Array.isArray(on.chartGeometry), true);
  assert.equal(on.chartGeometry.length, 1);
});
