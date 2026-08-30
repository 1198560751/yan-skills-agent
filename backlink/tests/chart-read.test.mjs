// backlink/scripts/lib-chart-read.mjs 的行为断言。
//
// 这个文件锁的是 2026-08-30 读透 11 份实盘 census 之后的那条结论：
//
//   **`census.deep.svgText` 是一个计数，不是文本。** census 里唯一带文本的字段是
//   `deepText`，它有轴刻度和轴标签，**没有任何一个数据点的值**。所以逐点数值这件事
//   在现有证据上就是读不出来的，读数器必须**如实说读不出**，而不是猜一个填上。
//
// 锁六件事：
//   1. 轴刻度文本 → 数值（万/亿/K/M/B/%/千分位）；解析不了就是解析不了；
//   2. 图表块切分靠无障碍终止标记，CSS 噪声不进块；
//   3. 轴 = 长度≥2 的**单调**数值连续段，孤立数字不冒充轴；
//   4. **「读不出」与「值是 0」可分辨**——前者 value:null + uncertain 理由码；
//   5. 几何路径能标定线性轴并反推逐点值，轴对数/刻度不足时点仍在但标 uncertain；
//   6. deepText 为空 / census 残缺 / 没有几何面时不抛错。
//
// 第 7 件事在文件末尾：**用真实证据对质**（remeasure-referral / remeasure-daily-trends）。
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  calibrateAxis,
  parseAxisValue,
  pickAxisTicks,
  pickRepeatedLabels,
  readChartFromGeometry,
  readCharts,
  readChartsFromGeometry,
  readChartsFromText,
  splitChartBlocks,
} from '../scripts/lib-chart-read.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE = path.join(HERE, '..', 'evidence', 'ground-truth');

/* ------------------------------------------------------------------ *
 * 1. 轴刻度文本 → 数值
 * ------------------------------------------------------------------ */

test('parseAxisValue 认中文量级后缀', () => {
  assert.equal(parseAxisValue('6000万').value, 60_000_000);
  assert.equal(parseAxisValue('2000万').value, 20_000_000);
  assert.equal(parseAxisValue('1.5亿').value, 150_000_000);
  assert.equal(parseAxisValue('500千').value, 500_000);
  assert.equal(parseAxisValue('0').value, 0);
});

test('parseAxisValue 认英文量级后缀与千分位', () => {
  assert.equal(parseAxisValue('1.5M').value, 1_500_000);
  assert.equal(parseAxisValue('200K').value, 200_000);
  assert.equal(parseAxisValue('2B').value, 2_000_000_000);
  assert.equal(parseAxisValue('1,234').value, 1234);
});

test('parseAxisValue 认百分比并把单位标出来', () => {
  const p = parseAxisValue('12.18%');
  assert.equal(p.ok, true);
  assert.equal(p.value, 12.18);
  assert.equal(p.unit, '%');
  assert.equal(parseAxisValue('6000万').unit, 'count');
});

test('parseAxisValue 解析不了就是 ok:false + value:null，绝不退回 0', () => {
  for (const bad of ['', '   ', 'n/a', '2026年2月', '导出', '↑', null, undefined, {}]) {
    const p = parseAxisValue(bad);
    assert.equal(p.ok, false, `${JSON.stringify(bad)} 不该被解析出来`);
    assert.equal(p.value, null, `${JSON.stringify(bad)} 的 value 必须是 null，不是 0`);
  }
  // 对照组：真的 0 是 ok:true + value:0。这两者必须能分辨。
  assert.deepEqual(
    { ok: parseAxisValue('0').ok, value: parseAxisValue('0').value },
    { ok: true, value: 0 },
  );
});

/* ------------------------------------------------------------------ *
 * 2. 图表块切分
 * ------------------------------------------------------------------ */

const BLOCK_END = '按“Tab”启用图形图表访问模块。';

test('splitChartBlocks 按无障碍终止标记切块，尾巴单独标 terminated:false', () => {
  const text = ['流量趋势', '流量趋势', '0', '2000万', BLOCK_END, '侧栏', '页脚'].join('\n');
  const blocks = splitChartBlocks(text);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].terminated, true);
  assert.deepEqual(blocks[0].lines, ['流量趋势', '流量趋势', '0', '2000万']);
  assert.equal(blocks[1].terminated, false);
});

test('CSS 噪声不进图表块的 labels（deepText 尾部混进过整段 semi-ui 主题）', () => {
  const css = '.semi-always-dark,body{--semi-black:0,0,0;--semi-red-0:108,9,11}';
  const text = ['流量趋势', '流量趋势', css, '0', '2000万', BLOCK_END].join('\n');
  const { charts } = readChartsFromText({ census: { deepText: text } });
  assert.equal(charts.length, 1);
  assert.ok(!charts[0].labels.some((l) => l.includes('--semi')), 'CSS 行漏进了 labels');
});

/* ------------------------------------------------------------------ *
 * 3. 轴的识别
 * ------------------------------------------------------------------ */

test('pickAxisTicks 认长度≥2 的单调数值连续段', () => {
  const axis = pickAxisTicks(['流量趋势', '0', '2000万', '4000万', '6000万', '2026年2月']);
  assert.ok(axis);
  assert.equal(axis.min, 0);
  assert.equal(axis.max, 60_000_000);
  assert.equal(axis.ticks.length, 4);
  assert.equal(axis.direction, 'ascending');
});

test('孤立数字不冒充轴（洞察卡上的 37.1万% / 7413 不是刻度）', () => {
  assert.equal(pickAxisTicks(['剧增', '37.1万%', 'canva.com/x', '7413', '↑']), null);
});

test('不单调的数值连续段不是轴', () => {
  assert.equal(pickAxisTicks(['10', '90', '20', '80']), null);
});

test('pickRepeatedLabels 抓连续重复行（面板把标题/图例各渲染两遍）', () => {
  assert.deepEqual(
    pickRepeatedLabels(['跳到内容', '价格', '流量趋势', '流量趋势', '访问量', '访问量']),
    ['流量趋势', '访问量'],
  );
});

/* ------------------------------------------------------------------ *
 * 4. 「读不出」 vs 「值是 0」
 * ------------------------------------------------------------------ */

test('文本路径：轴读得出，逐点值一律 no-geometry，points 为空数组而不是编造的点', () => {
  const text = ['流量趋势', '流量趋势', '导出', '0', '2000万', '4000万', '2026年2月', '2026年8月', BLOCK_END].join('\n');
  const out = readCharts({ census: { deepText: text } });
  assert.equal(out.capability, 'axis-only');
  const chart = out.text.charts[0];
  assert.equal(chart.title, '流量趋势');
  assert.equal(chart.yAxis.max, 40_000_000);
  assert.deepEqual(chart.points, []);
  const reasons = chart.uncertain.map((u) => u.reason);
  assert.ok(reasons.includes('no-geometry'), '必须显式标 no-geometry');
});

test('几何路径：轴刻度不足 2 条时，点仍在，但 value:null + uncertain，绝不填 0', () => {
  const chart = readChartFromGeometry({
    texts: [{ text: '0', x: 10, y: 300 }, { text: '2026年2月', x: 50, y: 320 }],
    marks: [{ kind: 'circle', x: 50, y: 200 }, { kind: 'circle', x: 90, y: 250 }],
  });
  assert.equal(chart.points.length, 2, '读不出值不等于没有点');
  for (const p of chart.points) {
    assert.equal(p.value, null);
    assert.equal(p.uncertain, 'axis-too-few-ticks');
  }
  assert.equal(chart.yAxis, null);
});

test('几何路径：线性轴标定后反推逐点值，真的 0 出现为 value:0 而不是 null', () => {
  // y=300px → 0，y=100px → 4000万。线性，200px 跨 4000万。
  const chart = readChartFromGeometry({
    title: '流量趋势',
    texts: [
      { text: '0', x: 10, y: 300 },
      { text: '2000万', x: 10, y: 200 },
      { text: '4000万', x: 10, y: 100 },
      { text: '2026年2月', x: 60, y: 320 },
    ],
    marks: [
      { kind: 'circle', x: 60, y: 300 },  // 值 0
      { kind: 'circle', x: 100, y: 200 }, // 值 2000万
      { kind: 'circle', x: 140, y: 150 }, // 值 3000万
    ],
  });
  assert.equal(chart.yAxis.linear, true);
  assert.deepEqual(chart.points.map((p) => p.value), [0, 20_000_000, 30_000_000]);
  // 「值是 0」不带 uncertain；这一条就是 0 与 null 的分水岭。
  assert.equal(chart.points[0].uncertain, null);
  assert.deepEqual(chart.xLabels, ['2026年2月']);
});

test('几何路径：对数轴被查出来，点不给值只给 axis-nonlinear', () => {
  // 100 / 1000 / 10000 等距排布 —— 线性映射下中点残差极大。
  const chart = readChartFromGeometry({
    texts: [
      { text: '100', x: 10, y: 300 },
      { text: '1000', x: 10, y: 200 },
      { text: '10000', x: 10, y: 100 },
    ],
    marks: [{ kind: 'circle', x: 60, y: 250 }],
  });
  assert.equal(chart.yAxis.linear, false);
  assert.equal(chart.points[0].value, null);
  assert.equal(chart.points[0].uncertain, 'axis-nonlinear');
});

test('柱图的 y 由采集侧归一到柱顶，读数器直接用', () => {
  const chart = readChartFromGeometry({
    texts: [{ text: '0', x: 10, y: 300 }, { text: '100', x: 10, y: 100 }],
    marks: [{ kind: 'rect', x: 60, y: 200, width: 10, height: 100 }],
  });
  assert.equal(chart.points[0].value, 50);
});

test('calibrateAxis 两条刻度落在同一像素 → degenerate，不产生除零', () => {
  const axis = calibrateAxis([{ text: '0', y: 100 }, { text: '100', y: 100 }]);
  assert.equal(axis.ok, false);
  assert.equal(axis.reason, 'axis-degenerate');
});

/* ------------------------------------------------------------------ *
 * 5. 残缺输入不抛错
 * ------------------------------------------------------------------ */

test('deepText 为空 / census 缺失 / 无几何面 都不抛错', () => {
  for (const input of [undefined, null, {}, { census: {} }, { census: { deepText: '' } }]) {
    const out = readCharts(input);
    assert.equal(out.capability, 'none');
    assert.equal(out.text.available, false);
    assert.equal(out.geometry.available, false);
    assert.deepEqual(out.text.charts, []);
  }
});

test('chartGeometry 缺失与 chartGeometry 为空数组都报 available:false 并说明原因', () => {
  const g = readChartsFromGeometry({ census: {} });
  assert.equal(g.available, false);
  assert.ok(g.notes[0].includes('chartGeometry'));
});

test('没有终止标记时报 no-chart-blocks，不假装读到了图表', () => {
  const out = readChartsFromText({ census: { deepText: '侧栏\n页脚\n0\n100' } });
  assert.deepEqual(out.charts, []);
  assert.ok(out.notes.some((n) => n.startsWith('no-chart-blocks')));
});

/* ------------------------------------------------------------------ *
 * 6. 真实证据对质
 * ------------------------------------------------------------------ *
 * 用 backlink/evidence/ 下的实盘 census 跑一遍。evidence/ 整体 gitignore，
 * 所以证据不在时**跳过而不是失败**——CI 上没有证据目录是正常的。
 */
function loadCensus(dir) {
  const p = path.join(EVIDENCE, dir, 'census-s1.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

test('实盘对质：remeasure-referral 的三张趋势图轴顶 = 6000万 / 6000万 / 2000万', (t) => {
  const capture = loadCensus('remeasure-referral');
  if (!capture) return t.skip('evidence/ground-truth/remeasure-referral 不在本机');

  // 先把那条被写错的结论钉住：deep.svgText 是计数，census 里没有 svg 文本内容。
  assert.equal(typeof capture.census.deep.svgText, 'number');
  assert.equal(capture.census.deep.filledCells, 0);

  const out = readCharts(capture);
  assert.equal(out.capability, 'axis-only', 'census 无几何，只能到 axis-only');

  const byTitle = new Map(out.text.charts.map((c) => [c.title, c]));
  // 截图 shot-s1.png 上肉眼可读：流量趋势 y 轴 0/2000万/4000万/6000万，
  // 桌面设备趋势同顶，移动设备趋势顶 2000万。
  assert.equal(byTitle.get('流量趋势').yAxis.max, 60_000_000);
  assert.equal(byTitle.get('流量趋势').yAxis.min, 0);
  assert.equal(byTitle.get('桌面设备趋势').yAxis.max, 60_000_000);
  assert.equal(byTitle.get('移动设备趋势').yAxis.max, 20_000_000);
  // 横轴 7 个月，与 PAGE.md 记录的 2026年2月–2026年8月一致。
  assert.ok(byTitle.get('流量趋势').labels.includes('2026年2月'));
  assert.ok(byTitle.get('流量趋势').labels.includes('2026年8月'));

  // PAGE.md 已确认的量级区间 4000万–6000万 必须落在读出的轴内。
  assert.ok(byTitle.get('流量趋势').yAxis.max >= 60_000_000);

  // 逐点值一条都读不出——这就是本轮证据的上限，测试把它钉死。
  for (const chart of out.text.charts) {
    assert.deepEqual(chart.points, []);
    assert.ok(chart.uncertain.some((u) => u.reason === 'no-geometry'));
  }
});

test('实盘对质：remeasure-daily-trends 读出 11 张带轴的图与各自轴顶', (t) => {
  const capture = loadCensus('remeasure-daily-trends');
  if (!capture) return t.skip('evidence/ground-truth/remeasure-daily-trends 不在本机');

  assert.equal(capture.census.deep.svgText, 1132);
  const out = readCharts(capture);
  const withAxis = out.text.charts.filter((c) => c.yAxis);
  assert.ok(withAxis.length >= 10, `带轴的图表块只读出 ${withAxis.length} 张`);

  // 各渠道分图的轴顶跨 3.4 个数量级（1.5万「付费社交」→ 4000万「访问量」）——
  // 正是「一个量级区间答不了所有渠道」的原因，也是轴刻度本身就有信息量的证据。
  const maxes = withAxis.map((c) => c.yAxis.max);
  assert.equal(Math.max(...maxes), 40_000_000);
  assert.equal(Math.min(...maxes), 15_000);

  // 日期轴：横轴是日粒度（7月1日…9月28日），不是月粒度。
  assert.ok(out.text.charts.some((c) => c.labels.includes('7月1日')));

  // deepText 被截断这件事必须被说出来，否则「只有 12 块」会被误读成「只有 12 张图」。
  assert.ok(out.text.notes.some((n) => n.includes('截断')));
});
