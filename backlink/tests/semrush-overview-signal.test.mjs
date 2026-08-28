// semrush-overview.mjs 的 Authority Score 完成信号。
//
// 这是仓库里记录在案的 2026-08-23 事故：一次跑 8 个域名，6 个被记成
// authorityScore: 0，真值 15~29。当年的修复是「连读两次一致再收下」——**对这个失败
// 形态无效**：水合前的占位 0 完全稳定，两次读立刻就一致。见
// <law-ref id="readiness-must-bind-to-this-query"/>：重复次数和时长都不是页面产出的东西。
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

const context = vm.createContext({ JSON, Date, Math, Number, String, Object, Boolean, captureStable, console });
vm.runInContext(
  `${extract(/function parseCompact\(value\) \{[\s\S]*?\n\}/, 'parseCompact()')}\n`
  + `${extract(/function pick\(lines, label, pattern\) \{[\s\S]*?\n\}/, 'pick()')}\n`
  + `${extract(/function readMetrics\(bodyText\) \{[\s\S]*?\n\}/, 'readMetrics()')}\n`
  + `${extract(/function makeAuthorityScoreRenderSignal\(\) \{[\s\S]*?\n\}/, 'makeAuthorityScoreRenderSignal()')}\n`
  + `${extract(/function pollOverview\(\{[^}]*\}\) \{[\s\S]*?\n\}/, 'pollOverview()')}\n`
  + `${extract(/function settleVerdict\(settled\) \{[\s\S]*?\n\}/, 'settleVerdict()')}\n`
  + 'globalThis.api = { readMetrics, makeAuthorityScoreRenderSignal, pollOverview, settleVerdict };',
  context,
);
const { readMetrics, makeAuthorityScoreRenderSignal, pollOverview, settleVerdict } = context.api;

/** 概览页的整页文本：AS 一行标签一行值，其余指标照旧。 */
function overviewText(as) {
  return [
    'Authority Score', String(as),
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

test('2026-08-23 incident: a placeholder 0 that is perfectly stable is NOT a fact', async () => {
  // 标签挂上了、数值区还停在占位 0、AS 组件没有给出任何完成信号
  //（没有变化量、没有「无数据」渲染、也没见过加载指示消失）。
  const settled = await pollOverview({
    ...POLL,
    read: constantRead({
      ready: true,
      title: 'Domain Overview',
      bodyText: overviewText(0),
      asWidget: { found: true, busy: false, trend: false, noData: false, text: 'Authority Score 0' },
    }),
  });

  // 旧判据在这里会 stable: true，然后把 authorityScore: 0 当成事实写进报告。
  assert.equal(settled.stable, false, 'a stable placeholder must never be accepted as settled');
  assert.equal(settled.inconclusive, true, 'no render signal → inconclusive, not empty and not a value');
  assert.equal(settleVerdict(settled), 'inconclusive');
  assert.ok(settled.reads >= 2, 'it really did read the same value repeatedly — and that changed nothing');
});

test('a real 0 is still reported as 0 once the widget says it finished rendering', async () => {
  // 同样的 0，但组件旁边渲染出了变化量 —— 这只有真值绑定之后才会有。
  const settled = await pollOverview({
    ...POLL,
    read: constantRead({
      ready: true,
      title: 'Domain Overview',
      bodyText: overviewText(0),
      asWidget: { found: true, busy: false, trend: true, noData: false, text: 'Authority Score 0 -1' },
    }),
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
      asWidget: { found: true, busy: false, trend: false, noData: true, text: 'Authority Score 不可用' },
    }),
  });
  assert.equal(settleVerdict(settled), 'confirmed');
});

test('signal: the loading indicator going away counts, but only if it was ever seen', () => {
  const seen = makeAuthorityScoreRenderSignal();
  const busy = { asWidget: { found: true, busy: true, trend: false, noData: false } };
  const quiet = { asWidget: { found: true, busy: false, trend: false, noData: false } };

  // 一上来就安静：可能它压根没渲染过骨架，「消失」是空话，不算信号。
  assert.equal(makeAuthorityScoreRenderSignal()(quiet), false);

  // 见过在转，然后不转了 —— 这是法条点名认可的完成信号之一。
  assert.equal(seen(busy), false);
  assert.equal(seen(quiet), true);

  // 连组件都定位不到，什么都别说。
  assert.equal(seen({ asWidget: null }), false);
  assert.equal(makeAuthorityScoreRenderSignal()({}), false);
});

test('the signal never binds to "the value is non-zero"', () => {
  // 如果哪天有人把「非 0」当成信号，这条会红：值 42、但组件毫无完成证据。
  const signal = makeAuthorityScoreRenderSignal();
  assert.equal(
    signal({ bodyText: overviewText(42), asWidget: { found: true, busy: false, trend: false, noData: false, text: 'Authority Score 42' } }),
    false,
    'the render signal must be read off the widget, never off the value it is judging',
  );
});

test('the probe scopes itself to the Authority Score widget, not the whole page', () => {
  const probe = extract(/const AS_WIDGET_PROBE_JS = `[\s\S]*?`;/, 'AS_WIDGET_PROBE_JS');
  // 往上爬遇到别的指标就停：否则取到的证据是别的卡片的，和 AS 无关。
  assert.match(probe, /自然流量\|付费流量\|引荐域名/);
  assert.match(probe, /if \(OTHER\.test/);
  // 探针不许把「值是多少」带进信号。
  assert.doesNotMatch(probe, /!==\s*0|>\s*0/);
});

test('an inconclusive overview is not archived as a reading', () => {
  // 输出必须走 status: 'inconclusive' + unconfirmedMetrics，且以非 0 退出码收场。
  assert.match(source, /status: 'inconclusive'/);
  assert.match(source, /unconfirmedMetrics/);
  assert.match(source, /output\.status === 'inconclusive'\) process\.exitCode = 1/);
});
