// backlink/scripts/lib-report-readiness.mjs 的行为断言。
//
// 这一族判据同属 <law-ref id="readiness-must-bind-to-this-query"/>，讽刺的是它们正是
// **那条 law 自己的承重条件**，而且犯着 law 要防的同一个病：「页面上出现了 X」没有先问
// 「X 有没有可能由别处提供？」。这里锁四件事：
//
//   1. `exportBtns` 绑到传进来的作用域根（默认仍是 main，行为不变）；
//   2. `chartHydrated` 同上——邻居挂件的 svg 数字不许算进本报表；
//   3. `spinnerGone` 被拆开：aria-busy 是否决项，猜类名那半只记录、不判定；
//   4. `onTarget` 的否定半边不再是中文字面量，且**匹配不到标记不等于不在空态**。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHART_HYDRATED_MIN,
  DEFAULT_SCOPE_SELECTOR,
  EMPTY_STATE_MARKERS,
  EXPORT_CONTROLS_MIN,
  classifyAbsence,
  classifyReportProbe,
  classifyTargetScope,
  detectUiLocale,
  isNoTableStructural,
  primaryLanguageSubtag,
  readBusyState,
  readReportProbe,
  renderFinished,
} from '../scripts/lib-report-readiness.mjs';

// ---------------------------------------------------------------------------
// 一个只够跑这几条选择器的迷你 DOM。仓库没有依赖，也不该为一个判据引 jsdom。
// 支持：标签、[attr]、[attr="v"]、[attr*="v" i]、逗号列表、后代组合。
// ---------------------------------------------------------------------------
function element(tag, attributes = {}, children = []) {
  const node = {
    tag,
    attrs: attributes,
    children: typeof children === 'string' ? [] : children,
    ownText: typeof children === 'string' ? children : '',
    parent: null,
  };
  for (const child of node.children) child.parent = node;
  Object.defineProperty(node, 'textContent', { get: () => text(node) });
  Object.defineProperty(node, 'innerText', { get: () => text(node) });
  node.querySelectorAll = (selector) => queryAll(node, selector);
  node.querySelector = (selector) => queryAll(node, selector)[0] || null;
  return node;
}

function text(node) {
  return node.ownText + node.children.map(text).join('\n');
}

function descendants(node, out = []) {
  for (const child of node.children) {
    out.push(child);
    descendants(child, out);
  }
  return out;
}

function parseCompound(part) {
  const tag = (part.match(/^[a-zA-Z][\w-]*/) || [''])[0];
  const attributes = [...part.matchAll(/\[([\w-]+)(?:([*^$]?=)"([^"]*)"(\s*i)?)?\]/g)].map((m) => ({
    name: m[1],
    operator: m[2] || null,
    value: m[3] ?? null,
    insensitive: Boolean(m[4]),
  }));
  return { tag, attributes };
}

function matchesCompound(node, compound) {
  if (compound.tag && node.tag !== compound.tag) return false;
  return compound.attributes.every((attribute) => {
    const raw = node.attrs[attribute.name];
    if (raw === undefined || raw === null) return false;
    if (!attribute.operator) return true;
    const actual = attribute.insensitive ? String(raw).toLowerCase() : String(raw);
    const expected = attribute.insensitive ? attribute.value.toLowerCase() : attribute.value;
    return attribute.operator === '*=' ? actual.includes(expected) : actual === expected;
  });
}

function queryAll(root, selector) {
  const found = [];
  for (const branch of selector.split(',')) {
    const compounds = branch.trim().split(/\s+(?![^[]*\])/).filter(Boolean).map(parseCompound);
    for (const node of descendants(root)) {
      if (!matchesCompound(node, compounds[compounds.length - 1])) continue;
      let cursor = node.parent;
      let index = compounds.length - 2;
      while (index >= 0 && cursor) {
        if (matchesCompound(cursor, compounds[index])) index -= 1;
        cursor = cursor.parent;
      }
      if (index < 0 && !found.includes(node)) found.push(node);
    }
  }
  return found;
}

function makeDocument({ body, lang = '', pathname = '/', visibilityState = 'visible' }) {
  const documentElement = element('html', { lang }, [body]);
  return {
    documentElement,
    body,
    location: { pathname },
    visibilityState,
    hasFocus: () => false,
    querySelector: (selector) => queryAll(documentElement, selector)[0] || null,
    querySelectorAll: (selector) => queryAll(documentElement, selector),
  };
}

const svgLabel = (value) => element('svg', {}, [element('text', {}, value)]);
const exportButton = (label = '导出') => element('button', {}, label);

// ---------------------------------------------------------------------------
// 1 + 2：作用域可传参，默认值不变
// ---------------------------------------------------------------------------
function pageWithForeignWidget() {
  // 邻居挂件（实例 1 那张 axa.fr 对比卡片，这次假设它是 svg 画的）挂在 main 之外，
  // 全局工具栏的「导出」按钮也在 main 之外；本报表区自己什么都没渲染。
  const widget = element('aside', { class: 'local-visibility-widget' }, [
    svgLabel('axa.fr'), svgLabel('42'), svgLabel('758'), svgLabel('15%'),
    exportButton('导出对比'),
  ]);
  const report = element('section', { 'data-testid': 'report-region' }, []);
  const main = element('main', {}, [report, widget, exportButton('Export')]);
  return { main, report, body: element('body', {}, [main]) };
}

test('默认作用域仍是 main，行为与旧片段逐位相同', () => {
  assert.equal(DEFAULT_SCOPE_SELECTOR, 'main');
  const { body } = pageWithForeignWidget();
  const probe = readReportProbe(makeDocument({ body, lang: 'zh-Hans' }), { target: 'canva.com' });
  assert.equal(probe.scopeSelector, 'main');
  assert.equal(probe.scopeResolved, true);
  // 挂件的 4 个 svg 数字 + 两个导出按钮，全都算进来了 —— 这就是旧行为，
  // 本轮不许改，只许标记出来。
  // axa.fr 不含数字，42 / 758 / 15% 含 —— 挂件自己**刚好凑够阈值 3**。
  assert.equal(probe.chartHydrated, 3);
  assert.equal(probe.exportBtns, 2);
  assert.equal(
    isNoTableStructural({ ...probe, onTarget: true }), true,
    '这就是病灶：本报表区一个像素都没渲染，判据却由邻居挂件独自满足',
  );
  assert.equal(probe.scopeIsUnverifiedDefault, true, '默认作用域必须自报「未验证」');
});

test('把作用域根传成本报表区，邻居挂件与全局工具栏就都掉出判据', () => {
  const { body } = pageWithForeignWidget();
  const probe = readReportProbe(
    makeDocument({ body, lang: 'zh-Hans' }),
    { scopeSelector: '[data-testid="report-region"]', target: 'canva.com' },
  );
  assert.equal(probe.scopeResolved, true);
  assert.equal(probe.scopeIsUnverifiedDefault, false);
  assert.equal(probe.chartHydrated, 0, '挂件的 svg 数字不是本报表的图表');
  assert.equal(probe.exportBtns, 0, '别处的导出按钮不证明本报表章节渲染完了');
  // 于是那个假的 no-table-structural 不成立了。
  assert.equal(isNoTableStructural({ ...probe, onTarget: true }), false);
});

test('作用域根找不到时退回 body，并且这件事必须写在输出里', () => {
  const { body } = pageWithForeignWidget();
  const probe = readReportProbe(makeDocument({ body }), { scopeSelector: '[data-testid="nope"]' });
  assert.equal(probe.scopeResolved, false, '绑没绑上，下游得看得见');
  assert.equal(probe.scopeIsUnverifiedDefault, false);
});

test('导出按钮的文案清单被记下来，作用域绑不上时它是唯一线索', () => {
  const { body } = pageWithForeignWidget();
  const probe = readReportProbe(makeDocument({ body }), {});
  assert.deepEqual(probe.exportControlLabels, ['导出对比', 'Export']);
});

test('阈值仍是 3 / 1，且是 svg 里含数字的文本节点', () => {
  assert.equal(CHART_HYDRATED_MIN, 3);
  assert.equal(EXPORT_CONTROLS_MIN, 1);
  const main = element('main', {}, [
    svgLabel('访问量'), svgLabel('12'), svgLabel('34'), svgLabel('56'), exportButton(),
  ]);
  const probe = readReportProbe(makeDocument({ body: element('body', {}, [main]) }), {});
  assert.equal(probe.chartHydrated, 3, '不含数字的坐标轴标题不算水合');
  assert.equal(isNoTableStructural({ ...probe, onTarget: true }), true);
  assert.equal(isNoTableStructural({ ...probe, chartHydrated: 2, onTarget: true }), false);
  assert.equal(isNoTableStructural({ ...probe, exportBtns: 0, onTarget: true }), false);
  assert.equal(isNoTableStructural({ ...probe, onTarget: false }), false, 'onTarget 不可丢');
  assert.equal(isNoTableStructural({ ...probe, noTable: false, onTarget: true }), false);
});

// ---------------------------------------------------------------------------
// 3：spinnerGone 拆开
// ---------------------------------------------------------------------------
test('aria-busy 是否决项，猜类名那半只记录、不参与判定', () => {
  const busy = element('main', {}, [element('div', { 'aria-busy': 'true' }, [])]);
  const skeleton = element('main', {}, [element('div', { class: 'ChartSkeleton' }, [])]);
  assert.deepEqual(readBusyState(busy), { ariaBusy: true, loadingClassPresent: false });
  assert.deepEqual(readBusyState(skeleton), { ariaBusy: false, loadingClassPresent: true });

  // 正向信号在 + 页面没自称在忙 → 完成。
  assert.equal(renderFinished({ paginator: true, ariaBusy: false }), true);
  assert.equal(renderFinished({ rowCount: true, ariaBusy: false }), true);
  // 页面自称还在忙 → 否决。
  assert.equal(renderFinished({ paginator: true, ariaBusy: true }), false);
  // ⚠️ 关键：猜类名那半**不许**改变判定。厂商换了类名它恒为真，
  // 一个从未开始渲染的页面就会被判成「加载指示已消失」。
  assert.equal(
    renderFinished({ paginator: true, ariaBusy: false, loadingClassPresent: true }),
    true,
    'loadingClassPresent 是记录项，不得阻断一个有正向完成信号的判定',
  );
  // 而且没有正向信号时，「没有 spinner」永远不构成完成 —— 这才是那条 law 要的方向。
  assert.equal(renderFinished({ loadingClassPresent: false }), false);
  assert.equal(renderFinished({}), false, '什么都没有 ⇒ 未完成，不是「已完成」');
});

test('renderFinished 的入参名里不再有 spinnerGone 这种否定式信号', () => {
  assert.equal(renderFinished({ paginator: true, spinnerGone: true, ariaBusy: true }), false,
    '外部传一个 spinnerGone 进来也不许绕过 aria-busy 否决');
});

// ---------------------------------------------------------------------------
// 4：onTarget 的否定半边
// ---------------------------------------------------------------------------
test('中文空态标记照旧命中', () => {
  const scope = classifyTargetScope({
    text: '创建新列表\ncanva.com', target: 'canva.com', documentLang: 'zh-Hans',
  });
  assert.equal(scope.hasTarget, true, '空态的已存列表选择器里就列着目标 —— 正向半边独自不够用');
  assert.equal(scope.emptyState, 'yes');
  assert.equal(scope.listPickerVisible, true);
  assert.equal(scope.ok, false);
});

test('英文空态落地页不再被判成 ok —— 实例 4 换个语言的原样复现', () => {
  const scope = classifyTargetScope({
    text: 'Create a new list\ncanva.com', target: 'canva.com', documentLang: 'en-US',
  });
  assert.equal(scope.emptyState, 'yes');
  assert.equal(scope.emptyStateMarkerLocale, 'en');
  assert.equal(scope.ok, false, '英文空态必须和中文空态一样被拦下');
});

test('没匹配到标记，但 locale 不在覆盖表里 → unknown，不是 ok', () => {
  const scope = classifyTargetScope({
    text: 'Créer une nouvelle liste\ncanva.com', target: 'canva.com', documentLang: 'fr-FR',
  });
  assert.equal(scope.localeCovered, false);
  assert.equal(scope.emptyState, 'unknown', '「没匹配到」不等于「不在空态」');
  assert.equal(scope.ok, false, '拿不准就显式失败，不许默认通过');
});

test('locale 覆盖得到、且没有空态标记 → 正常放行', () => {
  const zh = classifyTargetScope({ text: 'canva.com 概览', target: 'canva.com', documentLang: 'zh-Hans' });
  assert.equal(zh.emptyState, 'no');
  assert.equal(zh.ok, true);
  const en = classifyTargetScope({ text: 'canva.com Overview', target: 'canva.com', documentLang: 'en' });
  assert.equal(en.ok, true);
  // 正向半边不成立时照旧不通过。
  assert.equal(classifyTargetScope({ text: 'other.com', target: 'canva.com', documentLang: 'en' }).ok, false);
});

test('locale 从 URL 段里也能取到，两者都取不到就是 unknown', () => {
  assert.equal(detectUiLocale({ documentLang: 'zh-Hans' }), 'zh-Hans');
  assert.equal(detectUiLocale({ pathname: '/zh-Hans/analytics/traffic/' }), 'zh-Hans');
  assert.equal(detectUiLocale({}), '');
  assert.equal(primaryLanguageSubtag('zh-Hans'), 'zh');
  assert.equal(primaryLanguageSubtag('en_US'), 'en');
  const blind = classifyTargetScope({ text: 'canva.com', target: 'canva.com' });
  assert.equal(blind.emptyState, 'unknown');
  assert.equal(blind.ok, false, '连 locale 都读不到时，否定半边根本没有依据');
});

test('新 locale 的正确接法是补标记，不是让判据默认通过', () => {
  const markers = [...EMPTY_STATE_MARKERS, { locale: 'fr', marker: 'Créer une nouvelle liste' }];
  assert.equal(
    classifyTargetScope({ text: 'Créer une nouvelle liste\ncanva.com', target: 'canva.com', documentLang: 'fr', markers }).emptyState,
    'yes',
  );
  assert.equal(
    classifyTargetScope({ text: 'canva.com 概览', target: 'canva.com', documentLang: 'fr', markers }).ok,
    true,
  );
});

// ---------------------------------------------------------------------------
// 判定名与端到端
// ---------------------------------------------------------------------------
test('三个判定名，只有两个是结果，且先查 data-not-in-table', () => {
  assert.equal(classifyAbsence({ anchoredReady: true, noTableStructuralTwiceRunning: true }), 'data-not-in-table');
  assert.equal(classifyAbsence({ noTableStructuralTwiceRunning: true }), 'no-table-structural');
  assert.equal(classifyAbsence({ budgetExhausted: true }), 'no-table');
  assert.equal(classifyAbsence({}), 'inconclusive');
});

test('端到端：英文空态落地页是一个完美的 noTable===true，仍然不许过', () => {
  const main = element('main', {}, [
    svgLabel('12'), svgLabel('34'), svgLabel('56'),
    exportButton('Export'),
    element('button', {}, 'Create a new list'),
    element('div', {}, 'canva.com'),
  ]);
  const document = makeDocument({ body: element('body', {}, [main]), lang: 'en-US' });
  const probe = readReportProbe(document, { target: 'canva.com' });
  const verdict = classifyReportProbe(probe);
  assert.equal(probe.noTable, true);
  assert.equal(verdict.scope.emptyState, 'yes');
  assert.equal(verdict.onTarget, false);
  assert.equal(verdict.noTableStructural, false, '空态落地页不许拿到结构判定');
});

test('可见性只记录，不参与任何判定', () => {
  const main = element('main', {}, [svgLabel('1'), svgLabel('2'), svgLabel('3'), exportButton()]);
  const hidden = makeDocument({ body: element('body', {}, [main]), lang: 'zh', visibilityState: 'hidden' });
  const probe = readReportProbe(hidden, { target: 'canva.com' });
  assert.equal(probe.visibilityStateAtVerdict, 'hidden');
  assert.equal(probe.hasFocus, false);
  assert.equal(isNoTableStructural({ ...probe, onTarget: true }), true, 'hidden 不得否决结构判定');
});

// ---------------------------------------------------------------------------
// SKILL.md 的 <correct> 块是实盘 agent 直接抄进页面执行的那一份。它和这个模块
// 只要有一处漂回旧形状，下面就红。
// ---------------------------------------------------------------------------
test('SKILL.md 的判据片段不许漂回旧形状', async () => {
  const { readFile } = await import('node:fs/promises');
  const skill = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8');

  // 3：spinnerGone 这个否定式、猜类名的门必须已经不在判定式里。
  assert.doesNotMatch(skill, /spinnerGone:/, 'spinnerGone 已降级，不该再作为字段被算出来');
  assert.doesNotMatch(skill, /done\.spinnerGone/, 'renderFinished 不许再由 spinnerGone 把关');
  assert.match(skill, /renderFinished = \(done\.paginator \|\| done\.rowCount\) && !done\.ariaBusy/);
  assert.match(skill, /loadingClassPresent:/, '猜类名那半必须仍被记录下来');

  // 4：空态标记必须是按 locale 声明的表，且有 unknown 这一态。
  assert.match(skill, /EMPTY_STATE_MARKERS = \[/);
  assert.match(skill, /Create a new list/);
  assert.match(skill, /emptyState === 'no'/, "ok 必须绑到 'no'，而不是「没匹配到标记」");
  assert.doesNotMatch(skill, /ok: t\.includes\('canva\.com'\) && !emptyStateMarker/);

  // 1 + 2：作用域必须是参数，且默认值自报「未验证」。
  assert.match(skill, /SCOPE_SELECTOR = 'main';\s+\/\/ <- UNVERIFIED DEFAULT/);
  assert.match(skill, /scopeIsUnverifiedDefault: SCOPE_SELECTOR === 'main'/);
  assert.doesNotMatch(
    skill,
    /const structural = \(\(\) => \{\n  const root = document\.querySelector\('main'\)/,
    '结构探针不许再把 main 写死',
  );
});
