// semrush-overview.mjs 的 Authority Score 完成信号。
//
// 这是仓库里记录在案的 2026-08-23 事故：一次跑 8 个域名，6 个被记成
// authorityScore: 0，真值 15~29。当年的修复是「连读两次一致再收下」——**对这个失败
// 形态无效**：水合前的占位 0 完全稳定，两次读立刻就一致。见
// <law-ref id="readiness-must-bind-to-this-query"/>：重复次数和时长都不是页面产出的东西。
//
// 【2026-08-29】第二轮修正。上一版换成了「骨架消失 / 趋势小标 / 无数据标记」三种信号，
// 实盘取回真实 DOM 后发现**三种全错**，而且爬升写死 `i < 4` 停在一个值都不含的层上，
// 严格不可能成功。本文件因此新增了一组**由真实祖先链构造**的夹具（见 REAL_CHAIN），
// 判据和探针 JS 都对着它跑，而不是对着我们想象中的 DOM 跑。
//
// semrush-overview.mjs 是可执行脚本（import 就会跑主流程、去开浏览器），所以这里用 vm
// 把判据连同**它在生产代码里的绑定**一起取出来跑：`pollOverview` 就是生产环境用的那
// 个函数，把它里面的 `renderSignal:` 一行删掉，下面第一个测试就会变红。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { captureStable } from '../scripts/lib-tools-share.mjs';

const source = await readFile(new URL('../scripts/semrush-overview.mjs', import.meta.url), 'utf8');

function extract(pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `semrush-overview.mjs must still define ${label}`);
  return match[0];
}

const context = vm.createContext({ JSON, Date, Math, Number, String, Object, Boolean, Set, captureStable, console });
vm.runInContext(
  `${extract(/function parseCompact\(value\) \{[\s\S]*?\n\}/, 'parseCompact()')}\n`
  + `${extract(/function pick\(lines, label, pattern\) \{[\s\S]*?\n\}/, 'pick()')}\n`
  + `${extract(/function readMetrics\(bodyText\) \{[\s\S]*?\n\}/, 'readMetrics()')}\n`
  + `${extract(/function asSignalLocaleCovered\(uiLocale\) \{[\s\S]*?\n\}/, 'asSignalLocaleCovered()')}\n`
  + `${extract(/function makeAuthorityScoreRenderSignal\(\) \{[\s\S]*?\n\}/, 'makeAuthorityScoreRenderSignal()')}\n`
  + `${extract(/function pollOverview\(\{[^}]*\}\) \{[\s\S]*?\n\}/, 'pollOverview()')}\n`
  + `${extract(/function settleVerdict\(settled\) \{[\s\S]*?\n\}/, 'settleVerdict()')}\n`
  + 'globalThis.api = { readMetrics, asSignalLocaleCovered, makeAuthorityScoreRenderSignal, pollOverview, settleVerdict };',
  context,
);
const { readMetrics, asSignalLocaleCovered, makeAuthorityScoreRenderSignal, pollOverview, settleVerdict } = context.api;

const PROBE_SOURCE = extract(/const AS_WIDGET_PROBE_JS = `[\s\S]*?`;\n/, 'AS_WIDGET_PROBE_JS');

/**
 * 把探针 JS 拿到一个假 DOM 上跑。**假 DOM 的形状是实盘取回来的**，不是我们推的：
 * 层 0–4 只有 `Authority Score`，层 5 才是挂件（值 + 等级标签），层 6 混进了别的指标；
 * 整条链**没有 aria-busy**、类名是哈希化的 CSS-modules、**没有 data-testid**。
 */
function runProbe({ levels, lang = 'zh-Hans', pathname = '/analytics/overview/', busyAtLevel = null }) {
  const nodes = levels.map((innerText) => ({
    innerText,
    textContent: innerText,
    // 实测类名长这样：哈希化 CSS-modules，不含 skeleton/loading/shimmer，也没有 data-testid。
    className: '_inAfterOutline_false_w9nx7_gg_ ___SBox_w9nx7_gg_ sc-tagGt kEkzvb',
    children: [],
    parentElement: null,
    ariaBusy: false,
    getAttribute(name) {
      return name === 'aria-busy' ? (this.ariaBusy ? 'true' : null) : null;
    },
    querySelector(selector) {
      // 只有 aria-busy 这一个选择器在真实页面上有可能命中；猜类名的那些实测全是空。
      if (!/aria-busy/.test(selector)) return null;
      const stack = [...this.children];
      while (stack.length) {
        const node = stack.pop();
        if (node.ariaBusy) return node;
        stack.push(...node.children);
      }
      return null;
    },
  }));
  for (let i = 0; i < nodes.length - 1; i += 1) {
    nodes[i].parentElement = nodes[i + 1];
    nodes[i + 1].children = [nodes[i]];
  }
  if (busyAtLevel !== null) nodes[busyAtLevel].ariaBusy = true;

  const document = {
    documentElement: { lang },
    location: { pathname },
    querySelectorAll: () => nodes,
  };
  const probeContext = vm.createContext({ document });
  const result = vm.runInContext(`${PROBE_SOURCE}\nAS_WIDGET_PROBE_JS`, probeContext);
  return { widget: vm.runInContext(result, probeContext), nodes };
}

/** 2026-08-29 实盘取回的祖先链（canva.com，中文 UI）。层 0 是叶子。 */
const REAL_CHAIN = [
  'Authority Score',
  'Authority Score',
  'Authority Score',
  'Authority Score',
  'Authority Score',                                       // ← 旧版爬升停在这里，一个值都没有
  'Authority Score 100 行业领导者',                          // ← 真正的挂件
  'Authority Score 100 行业领导者 自然流量 287.9M +0.4% 付费流量 442.1K -28%',
];

/** 概览页的整页文本：AS 一行标签一行值，其余指标照旧。 */
function overviewText(as) {
  return [
    'Authority Score', String(as), '行业领导者',
    '自然流量', '23.8K', '+12%',
    '付费流量', '0',
    '引荐域名', '1.6K',
    '自然搜索关键词', '4.9K', '+3%',
    '反向链接', '27.1K',
  ].join('\n');
}

/** 每次读都返回同一份 capture —— 稳定得不能再稳定，正是事故当天的样子。 */
const constantRead = (capture) => () => capture;

const POLL = { timeoutMs: 120, intervalMs: 5, needed: 2 };

test('the climb reaches the level that actually holds the value (real 2026-08-29 DOM)', () => {
  const { widget } = runProbe({ levels: REAL_CHAIN });
  // 值在第 5 层。写死「爬 4 层」的旧版停在第 4 层，那一层的文本是光秃秃的 `Authority Score`。
  assert.equal(widget.climbed, 5, 'must climb until the widget holds a value, not a fixed 4 levels');
  assert.equal(widget.stoppedBy, 'value', 'the stop condition is "a value appeared", not a level count');
  assert.equal(widget.text, 'Authority Score 100 行业领导者');
  assert.equal(widget.hasValue, true);
  assert.equal(widget.hasGrade, true);
  assert.equal(widget.grade, '行业领导者');
  // 实测：整条链没有 aria-busy，也没有任何猜得到的加载类名。
  assert.equal(widget.ariaBusy, false);
  assert.equal(widget.loadingClassPresent, false);
});

test('the OTHER guard still stops the climb before the neighbouring metrics', () => {
  const { widget } = runProbe({ levels: REAL_CHAIN });
  // 第 6 层混进了自然流量/付费流量。爬到那里，取到的证据就是别人的。
  assert.doesNotMatch(widget.text, /自然流量|付费流量/, 'the widget must not swallow the neighbouring metrics');

  // 反过来构造：挂件层里**没有**值，值只在混着别的指标的那一层出现。
  // 此时宁可停在 OTHER 前面报「没值」，也不许越过去拿别人的数字充当证据。
  const noValueBeforeOther = [
    'Authority Score', 'Authority Score', 'Authority Score',
    'Authority Score 自然流量 287.9M +0.4% 付费流量 442.1K -28%',
  ];
  const stopped = runProbe({ levels: noValueBeforeOther }).widget;
  assert.equal(stopped.stoppedBy, 'other-metric');
  assert.equal(stopped.hasValue, false);
  assert.doesNotMatch(stopped.text, /自然流量/);
  assert.equal(makeAuthorityScoreRenderSignal()({ asWidget: stopped }), false);
});

test('end to end on the real chain: value + grade label ⇒ confirmed, authorityScore 100', async () => {
  const { widget } = runProbe({ levels: REAL_CHAIN });
  const settled = await pollOverview({
    ...POLL,
    read: constantRead({ ready: true, title: 'Domain Overview', bodyText: overviewText(100), asWidget: widget }),
  });
  assert.equal(settleVerdict(settled), 'confirmed');
  assert.equal(readMetrics(settled.capture.bodyText).authorityScore, 100);
});

test('2026-08-23 incident: a placeholder 0 that is perfectly stable is NOT a fact', () => {
  // 标签挂上了、数值区还停在占位 0、等级标签**还没渲染**——这正是水合前的样子。
  const { widget } = runProbe({
    levels: ['Authority Score', 'Authority Score', 'Authority Score', 'Authority Score', 'Authority Score', 'Authority Score 0'],
  });
  assert.equal(widget.hasValue, true, 'the placeholder 0 is a value…');
  assert.equal(widget.hasGrade, false, '…but with no grade label next to it, nothing is finished');
  assert.equal(makeAuthorityScoreRenderSignal()({ asWidget: widget }), false);
});

test('2026-08-23 incident, through the production poll: stable placeholder ⇒ inconclusive', async () => {
  const settled = await pollOverview({
    ...POLL,
    read: constantRead({
      ready: true,
      title: 'Domain Overview',
      bodyText: overviewText(0),
      asWidget: { found: true, climbed: 5, stoppedBy: 'value', ariaBusy: false, loadingClassPresent: false, hasValue: true, hasGrade: false, grade: '', noData: false, uiLocale: 'zh-Hans', text: 'Authority Score 0' },
    }),
  });
  // 旧判据在这里会 stable: true，然后把 authorityScore: 0 当成事实写进报告。
  assert.equal(settled.stable, false, 'a stable placeholder must never be accepted as settled');
  assert.equal(settled.inconclusive, true, 'no render signal → inconclusive, not empty and not a value');
  assert.equal(settleVerdict(settled), 'inconclusive');
  assert.ok(settled.reads >= 2, 'it really did read the same value repeatedly — and that changed nothing');
});

test('a real 0 is still reported as 0 once the grade label renders next to it', async () => {
  // 一个 AS 真的是 0 的新站。**我们不知道 0 那一档的等级词长什么样**——判据也不需要知道：
  // 它认的是「数值旁边的那个位置上有一段词」，不是某个我们编出来的等级词。
  const { widget } = runProbe({
    levels: ['Authority Score', 'Authority Score', 'Authority Score', 'Authority Score', 'Authority Score', 'Authority Score 0 某个我们没见过的等级词'],
  });
  assert.equal(widget.hasValue, true);
  assert.equal(widget.hasGrade, true);

  const settled = await pollOverview({
    ...POLL,
    read: constantRead({ ready: true, title: 'Domain Overview', bodyText: overviewText(0), asWidget: widget }),
  });
  assert.equal(settled.stable, true);
  assert.equal(settleVerdict(settled), 'confirmed');
  // 新站的 AS 真的就是 0。修过头把合法的 0 也吃掉，和原来的事故一样是错的。
  assert.equal(readMetrics(settled.capture.bodyText).authorityScore, 0);
});

test('an explicit no-data rendering also counts as finished', async () => {
  const settled = await pollOverview({
    ...POLL,
    read: constantRead({
      ready: true,
      title: 'Domain Overview',
      bodyText: overviewText(0),
      asWidget: { found: true, ariaBusy: false, hasValue: false, hasGrade: false, noData: true, uiLocale: 'zh-Hans', text: 'Authority Score 不可用' },
    }),
  });
  assert.equal(settleVerdict(settled), 'confirmed');
});

test('aria-busy is a veto only — its absence proves nothing', () => {
  const signal = makeAuthorityScoreRenderSignal();
  const finished = { found: true, ariaBusy: false, hasValue: true, hasGrade: true, noData: false, uiLocale: 'zh' };

  // 为真 ⇒ 没渲染完，哪怕值和等级标签都在。
  assert.equal(signal({ asWidget: { ...finished, ariaBusy: true } }), false);
  assert.equal(signal({ asWidget: finished }), true);

  // 为假**不构成**任何完成证据：没有正向信号时，不忙 ≠ 完成。
  assert.equal(signal({ asWidget: { found: true, ariaBusy: false, hasValue: true, hasGrade: false, noData: false, uiLocale: 'zh' } }), false);
  assert.equal(signal({ asWidget: { found: true, ariaBusy: false, hasValue: false, hasGrade: false, noData: false, uiLocale: 'zh' } }), false);

  // 「见过在忙、现在不忙了」也不是信号——那仍然是拿一个否定式当正证据。
  const stateful = makeAuthorityScoreRenderSignal();
  const busy = { asWidget: { found: true, ariaBusy: true, hasValue: false, hasGrade: false, noData: false, uiLocale: 'zh' } };
  const quiet = { asWidget: { found: true, ariaBusy: false, hasValue: false, hasGrade: false, noData: false, uiLocale: 'zh' } };
  assert.equal(stateful(busy), false);
  assert.equal(stateful(quiet), false, 'the loading indicator going away is NOT a completion signal');

  // 连组件都定位不到，什么都别说。
  assert.equal(signal({ asWidget: null }), false);
  assert.equal(makeAuthorityScoreRenderSignal()({}), false);
});

test('an uncovered locale is unknown, not a default pass', () => {
  const signal = makeAuthorityScoreRenderSignal();
  const finished = { found: true, ariaBusy: false, hasValue: true, hasGrade: true, noData: false };

  // 实测过的只有中文 UI。
  assert.equal(asSignalLocaleCovered('zh-Hans').covered, true);
  assert.equal(signal({ asWidget: { ...finished, uiLocale: 'zh-Hans' } }), true);

  // 英文 / 德文 / 语言未知：**没人见过**那些 UI 下的挂件，判 unknown 而不是默认通过。
  for (const locale of ['en', 'en-US', 'de', '']) {
    assert.equal(asSignalLocaleCovered(locale).covered, false, `${locale || '(empty)'} must not be silently covered`);
    assert.equal(
      signal({ asWidget: { ...finished, uiLocale: locale } }),
      false,
      `an uncovered locale must fail closed, not pass by default (${locale || '(empty)'})`,
    );
  }
});

test('the locale comes from the page, not from us guessing', () => {
  // <html lang> 优先；没有就退回路径里的 locale 段。两者都是页面/请求自己产出的事实。
  assert.equal(runProbe({ levels: REAL_CHAIN, lang: 'zh-Hans' }).widget.uiLocale, 'zh-Hans');
  assert.equal(runProbe({ levels: REAL_CHAIN, lang: '', pathname: '/zh-Hans/analytics/overview/' }).widget.uiLocale, 'zh-Hans');
  assert.equal(runProbe({ levels: REAL_CHAIN, lang: '', pathname: '/analytics/overview/' }).widget.uiLocale, '');
});

test('the probe scopes itself to the Authority Score widget, not the whole page', () => {
  const probe = extract(/const AS_WIDGET_PROBE_JS = `[\s\S]*?`;/, 'AS_WIDGET_PROBE_JS');
  // 往上爬遇到别的指标就停：否则取到的证据是别的卡片的，和 AS 无关。
  assert.match(probe, /自然流量\|付费流量\|引荐域名/);
  assert.match(probe, /OTHER\.test/);
  // 探针不许把「值是多少」带进信号。
  assert.doesNotMatch(probe, /!==\s*0|>\s*0/);
  // 层数只许当上界，不许当判据：停止条件必须是「挂件里出现了数字」。
  assert.match(probe, /while \(!\/\\\\d\/\.test\(restOf\(widget\)\)\)/);
  // 猜类名的那一坨已经作废（实测是哈希化 CSS-modules），只许留在「只记录」字段里。
  assert.doesNotMatch(probe, /role="progressbar"/);
  assert.match(probe, /loadingClassPresent: Boolean/);
});

test('an inconclusive overview is not archived as a reading', () => {
  // 输出必须走 status: 'inconclusive' + unconfirmedMetrics，且以非 0 退出码收场。
  assert.match(source, /status: 'inconclusive'/);
  assert.match(source, /unconfirmedMetrics/);
  assert.match(source, /output\.status === 'inconclusive'\) process\.exitCode = 1/);
  // 并且把探针卡在哪一环的证据一起交出去，否则下一次复核又得重新猜。
  assert.match(source, /stoppedBy: w\.stoppedBy/);
  assert.match(source, /localeCovered: locale\.covered/);
});
