// semrush-report.mjs 的两条判据缺陷，同族于
// <law-ref id="readiness-must-bind-to-this-query"/>：
//   1. 配额检测方向反了 —— 在**整个文档**里搜「已达到每日报告限额」；
//   2. 翻页终止条件没有下限 —— 「找不到下一页控件」当成「已到最后一页」。
//
// semrush-report.mjs 是个可执行脚本（import 就会跑主流程），所以这里用 vm 把两段
// 判据从源码里取出来单独执行。**取的是生产代码本身**，不是抄写版——把生产代码里
// 的判据删掉，下面的断言就会红。`--self-test` 里另有一份走完整诊断路径的集成断言。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../scripts/semrush-report.mjs', import.meta.url), 'utf8');

function extract(pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `semrush-report.mjs must still define ${label}`);
  return match[0];
}

test('quota is a table-body verdict, not a page-wide text search', () => {
  const context = vm.createContext({});
  vm.runInContext(
    `${extract(/const QUOTA_BLOCKED = [^\n]+/, 'QUOTA_BLOCKED')}\n`
    + `${extract(/function classifyQuotaBlock\(probe\) \{[\s\S]*?\n\}/, 'classifyQuotaBlock()')}\n`
    + 'globalThis.classify = classifyQuotaBlock;',
    context,
  );
  const classify = context.classify;

  // 表体区 0 个单元格 **且** 提示就在表体区里 —— 这才是限额。
  assert.equal(classify({ region: { filledCells: 0, text: '已达到每日报告限额' } }), 'quota-blocked');
  assert.equal(
    classify({ region: { filledCells: 0, text: 'Daily report limit reached' } }),
    'quota-blocked',
  );

  // 整页别处（帮助气泡）含有限额字样，但表体区有 850 个填好的单元格 ——
  // 老的整页判据在这里会判限额，把一份好报表当成节点问题扔掉。
  assert.equal(
    classify({
      region: { filledCells: 850, text: 'coacht.com 知识 75,501' },
      bodyText: '帮助：账号已达到每日报告限额时会看到提示',
    }),
    'not-quota',
  );

  // 表体区渲染了但空着，提示不在里面 —— 是「没数据/没渲染」，不是限额。
  assert.equal(classify({ region: { filledCells: 0, text: '' }, bodyText: '' }), 'not-quota');

  // 表体区根本没定位到 —— 判据没能绑上，第三态，既不能报 blocked 也不能装没看见。
  assert.equal(classify({ region: null, bodyText: '已达到每日报告限额' }), 'quota-suspected');
  assert.equal(classify({ region: null, bodyText: '正常报表' }), 'not-quota');
  assert.equal(classify(null), 'not-quota');
});

async function loadPager() {
  const context = vm.createContext({ setTimeout, Date, JSON, Math, console });
  vm.runInContext(
    'const sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n'
    + `${extract(/const NEXT_PAGE_JS = `[\s\S]*?`;/, 'NEXT_PAGE_JS')}\n`
    + `${extract(/const PAGER_ABSENT_BUDGET_MS = \d+;/, 'PAGER_ABSENT_BUDGET_MS')}\n`
    + `${extract(/const PAGE_SETTLE_BUDGET_MS = \d+;/, 'PAGE_SETTLE_BUDGET_MS')}\n`
    + `${extract(/function readPageInfo\(bodyText\) \{[\s\S]*?\n\}/, 'readPageInfo()')}\n`
    + `${extract(/async function clickNextPage\(evalPage, before, options = \{\}\) \{[\s\S]*?\n\}/, 'clickNextPage()')}\n`
    + `${extract(/function makeNextPageFingerprint\(\{[\s\S]*?\n\}/, 'makeNextPageFingerprint()')}\n`
    + 'globalThis.api = { clickNextPage, makeNextPageFingerprint, PAGER_ABSENT_BUDGET_MS, PAGE_SETTLE_BUDGET_MS, NEXT_PAGE_JS };',
    context,
  );
  return context.api;
}

test('an unrendered pager is inconclusive — never "the last page"', async () => {
  const { clickNextPage, PAGER_ABSENT_BUDGET_MS, NEXT_PAGE_JS } = await loadPager();

  // 分页器和表体一样是后渲染的：翻完一页的那一瞬间它不存在，而且非常稳定。
  let probes = 0;
  let clock = 0;
  const late = await clickNextPage(
    async (js) => {
      if (js !== NEXT_PAGE_JS) return { t: '页码：2\n/\n5' };
      probes += 1;
      return probes >= 4 ? { control: 'enabled', clicked: true } : { control: 'absent' };
    },
    1,
    { now: () => clock, sleepFn: async (ms) => { clock += ms; }, probeIntervalMs: 1500 },
  );
  assert.equal(late.advanced, true, 'a pager that renders late must still be used');
  assert.equal(late.verdict, 'advanced');
  assert.equal(probes, 4, 'the driver must keep probing, not give up on the first absent read');

  // 【本轮修的就是这一条】分页器一直不出现 → **inconclusive**。
  // 上一版等满 9 秒就报「没有下一页」，那是同一个阈值赌博换了个数：
  // 见 <law-ref id="readiness-must-bind-to-this-query"/>，时长不是页面产出的东西。
  // 而且在这条代码路径上，页面自己已经报了总页数 > 1 —— 「分页器不存在」和那个
  // 页面产出的事实直接矛盾，所以它只能是「还没渲染」，绝不可能是「已到最后一页」。
  let absentClock = 0;
  const never = await clickNextPage(
    async () => ({ control: 'absent' }), 1,
    { now: () => absentClock, sleepFn: async (ms) => { absentClock += ms; }, probeIntervalMs: 1500 },
  );
  assert.equal(never.advanced, false);
  assert.equal(never.verdict, 'inconclusive', 'an absent pager must NEVER be reported as the last page');
  assert.notEqual(never.verdict, 'last-page');
  assert.match(never.reason, /这不等于已经到最后一页/);
  // 下限还在，但它只是**一轮的时间上界**（别让探针死等），不是判据。
  assert.ok(absentClock >= PAGER_ABSENT_BUDGET_MS, 'the round is still bounded in time');

  // 点了「下一页」但页码不动：同样是 inconclusive。
  const stalled = await clickNextPage(
    async (js) => (js === NEXT_PAGE_JS ? { control: 'enabled', clicked: true } : { t: '页码：1\n/\n5' }),
    1,
    { now: () => 0, sleepFn: async () => {}, probeIntervalMs: 1, pageWaits: 2 },
  );
  assert.equal(stalled.advanced, false);
  assert.equal(stalled.verdict, 'inconclusive');

  // disabled 是页面自己产出的「这是最后一页」信号 —— 唯一配得上 last-page 的一种，
  // 而且可以立刻采信，不用等。
  let fastClock = 0;
  const last = await clickNextPage(
    async () => ({ control: 'disabled' }), 1,
    { now: () => fastClock, sleepFn: async (ms) => { fastClock += ms; } },
  );
  assert.equal(last.advanced, false);
  assert.equal(last.verdict, 'last-page');
  assert.equal(fastClock, 0, 'a rendered, disabled pager is a positive signal — no waiting needed');
  assert.match(last.reason, /最后一页/);
});

test('a next page whose table has not hydrated is decided by structure, not by elapsed time', async () => {
  const { makeNextPageFingerprint, PAGE_SETTLE_BUDGET_MS } = await loadPager();
  let clock = 0;
  const prevPrint = JSON.stringify({ rows: [{ referringDomain: 'a.com' }] });
  const fingerprint = makeNextPageFingerprint({ prevPrint, prevRowCount: 1, now: () => clock });

  const empty = JSON.stringify({ rows: [] });
  const filled = JSON.stringify({ rows: [{ referringDomain: 'b.com' }] });

  // 实测出来的结构判据，两态互斥且可观测：
  //   table 在、列头齐全、只是无行  → 表来得晚，继续等（**不论等了多久**）
  //   整页不存在 table/[role=grid] → 本来就没有表，这是页面产出的事实，可以下结论
  assert.equal(fingerprint(empty, { tableCount: 1 }), null, 'table present but empty → keep waiting');
  clock = PAGE_SETTLE_BUDGET_MS * 100;
  assert.equal(
    fingerprint(empty, { tableCount: 1 }), null,
    'and the answer must not change just because a lot of time passed — that is the gamble this replaced',
  );
  // 还是上一页的内容 —— 任何时候都要继续等。
  assert.equal(fingerprint(prevPrint, { tableCount: 1 }), null);
  // 水合完成 —— 立刻采信。
  assert.equal(fingerprint(filled, { tableCount: 1 }), filled);
  // 整页无表 —— 结构事实，可以收下。
  assert.equal(fingerprint(empty, { tableCount: 0 }), empty);

  // 拿不到结构信号的老调用方退回旧的时间兜底（只为兼容，别在新调用点上依赖）。
  let legacyClock = 0;
  const legacy = makeNextPageFingerprint({ prevPrint, prevRowCount: 1, now: () => legacyClock });
  assert.equal(legacy(empty), null);
  legacyClock = PAGE_SETTLE_BUDGET_MS + 1;
  assert.equal(legacy(empty), empty);
});

test('the pagination loop consumes the structured verdict, not a bare boolean', () => {
  assert.match(source, /const advance = await clickNextPage\(evalPage, pagesRead\);/);
  // 停下的**原因**（给人读）和停下**说明了什么**（给机器读）必须分开传，
  // 否则下游只能靠正则去猜 reason 的措辞来分辨 last-page 和 inconclusive。
  assert.match(source, /stoppedBecause = advance\.reason;/);
  assert.match(source, /paginationVerdict = advance\.verdict;/);
  assert.match(source, /verdict: pagesRead >= pageInfo\.total \? 'complete' : \(paginationVerdict \|\| 'inconclusive'\),/);
  // 翻页路径上的限额检测同样必须绑表体区。
  assert.match(source, /const quota = classifyQuotaBlock\(freshProbe\);/);
  assert.doesNotMatch(source, /QUOTA_BLOCKED\.test\(freshBody\)/);
});
