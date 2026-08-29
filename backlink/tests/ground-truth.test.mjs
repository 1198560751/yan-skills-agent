// backlink/scripts/ground-truth.mjs 纯函数断言 —— 全部注入假数据，不碰浏览器。
//
// 锁四件事（对应 2026-08-29 试点的三个实测事实 + 剥敏红线）：
//   1. 就绪判据绑 filledCells > 0，**不是文本长度**：deep text 9 秒就 1.6M（壳），
//      数据 76 秒才落（850 格）。文本长度判据会提前约 1 分钟误判。
//   2. 到底判据 = 双证人同时不变：census 指纹相同 **且** 截图 md5 相同。
//      单证人不变不算到底。
//   3. manifest 形状：下游（AI 对质、后续脚本）按这些键读，漂了要立刻红。
//   4. URL / eval 载荷剥敏：__gmitm 只留空值键名，token/jwt/auth 类删除，
//      cookie/authorization 形状的串替换为 [REDACTED]。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildManifest,
  censusFingerprint,
  detectEmptyState,
  isReady,
  isStalled,
  pairsIdentical,
  sanitizeUrlString,
  scrubEvalPayload,
} from '../scripts/ground-truth.mjs';

// ---------------------------------------------------------------------------
// 1. 就绪判据
// ---------------------------------------------------------------------------

test('就绪判据：filledCells > 0 才算就绪', () => {
  assert.equal(isReady({ deep: { filledCells: 850, textLength: 1_605_808 } }), true);
  assert.equal(isReady({ deep: { filledCells: 1, textLength: 100 } }), true);
});

test('就绪判据：1.6M 的深层文本、0 个非空单元格 —— 这是壳，不是货，不许判就绪', () => {
  // 试点 9 秒时刻的真实读数形状：textLength 已经 1,599,006，数据一个格都没落。
  const shellOnly = { deep: { filledCells: 0, textLength: 1_599_006 }, lightDom: { textLength: 59 } };
  assert.equal(isReady(shellOnly), false, '用文本长度当就绪判据会提前 1 分钟误判');
});

test('就绪判据：缺字段 / 非数字一律不就绪，不许静默放行', () => {
  assert.equal(isReady(undefined), false);
  assert.equal(isReady({}), false);
  assert.equal(isReady({ deep: {} }), false);
  assert.equal(isReady({ deep: { filledCells: 'yes' } }), false);
});

// ---------------------------------------------------------------------------
// 2. 到底判据：双证人同时不变
// ---------------------------------------------------------------------------

const pairAt = (scrollY, md5, filled = 850) => {
  const capture = { scrollY, census: { deep: { filledCells: filled, textLength: 1_605_808 } } };
  return { capture, md5, fingerprint: censusFingerprint(capture) };
};

test('到底判据：census 指纹相同 且 md5 相同 → 到底', () => {
  assert.equal(pairsIdentical(pairAt(2156, 'aaa'), pairAt(2156, 'aaa')), true);
});

test('到底判据：只有一个证人不变不算到底', () => {
  // 像素证人变了（虚拟滚动/动画），DOM 证人没变 → 不算。
  assert.equal(pairsIdentical(pairAt(2156, 'aaa'), pairAt(2156, 'bbb')), false);
  // DOM 证人变了（scrollY 或 census 任一），像素证人没变 → 不算。
  assert.equal(pairsIdentical(pairAt(1987, 'aaa'), pairAt(2156, 'aaa')), false);
  assert.equal(pairsIdentical(pairAt(2156, 'aaa', 850), pairAt(2156, 'aaa', 851)), false);
});

test('到底判据：首步没有上一步可比 → 不算到底', () => {
  assert.equal(pairsIdentical(null, pairAt(0, 'aaa')), false);
  assert.equal(pairsIdentical(undefined, pairAt(0, 'aaa')), false);
});

test('census 指纹不含时间戳：同一画面两次读，when 不同不影响指纹', () => {
  const a = { when: '2026-08-29T06:42:20.063Z', scrollY: 586.5, census: { deep: { filledCells: 850 } } };
  const b = { when: '2026-08-29T06:42:29.999Z', scrollY: 586.5, census: { deep: { filledCells: 850 } } };
  assert.equal(censusFingerprint(a), censusFingerprint(b));
});

// ---------------------------------------------------------------------------
// 3. manifest 形状
// ---------------------------------------------------------------------------

test('manifest 形状：顶层键齐全，步与轮各带承重字段', () => {
  const manifest = buildManifest({
    url: 'https://sem.3ue.co/analytics/traffic/top-pages/?q=canva.com&searchType=domain&__gmitm=SECRET123',
    session: 'semrush-nav',
    startedAt: '2026-08-29T06:40:25.000Z',
    finishedAt: '2026-08-29T06:43:00.000Z',
    readyAfterMs: 76_000,
    budgetSeconds: 180,
    maxScreens: 12,
    stopReason: 'stable',
    polls: [
      { poll: 1, file: 'census-poll1.json', when: '2026-08-29T06:40:34.000Z', elapsedMs: 9000, scrollY: 0, filledCells: 0, deepTextLength: 1_599_006 },
    ],
    steps: [
      { step: 1, censusFile: 'census-s1.json', shotFile: 'shot-s1.png', when: '2026-08-29T06:41:45.000Z', scrollY: 0, filledCells: 850, screenshotMd5: 'aaa', sameAsPrevious: null },
      { step: 2, censusFile: 'census-s2.json', shotFile: 'shot-s2.png', when: '2026-08-29T06:41:52.000Z', scrollY: 2156, filledCells: 850, screenshotMd5: 'aaa', sameAsPrevious: true },
    ],
  });

  for (const key of ['schemaVersion', 'url', 'session', 'startedAt', 'finishedAt', 'budgetSeconds',
    'maxScreens', 'readyAfterMs', 'pollCount', 'stepCount', 'stopReason', 'error', 'polls', 'steps']) {
    assert.ok(key in manifest, `manifest 缺 ${key}`);
  }
  assert.equal(manifest.pollCount, 1);
  assert.equal(manifest.stepCount, 2);
  assert.equal(manifest.stopReason, 'stable');
  // 顶层 URL 必须已剥敏：__gmitm 只留空值键名。
  assert.ok(!manifest.url.includes('SECRET123'), '__gmitm 的值不许进 manifest');
  assert.ok(manifest.url.includes('__gmitm='), '__gmitm 键名（空值）保留，它是页面身份的一部分');
  // 每步都带「同一停留位置」声明所需的字段。
  for (const step of manifest.steps) {
    for (const key of ['step', 'censusFile', 'shotFile', 'when', 'scrollY', 'filledCells', 'screenshotMd5', 'sameAsPrevious']) {
      assert.ok(key in step, `step 缺 ${key}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 4. 剥敏
// ---------------------------------------------------------------------------

test('URL 剥敏：__gmitm 留空值键名，token/jwt/auth 类参数整个删除，普通参数保留', () => {
  const out = sanitizeUrlString(
    'https://sem.3ue.co/analytics/traffic/top-pages/?q=canva.com&searchType=domain&__gmitm=abc123def456&access_token=tok999&jwt=eyJx&auth=1',
  );
  assert.ok(out.includes('q=canva.com'));
  assert.ok(out.includes('searchType=domain'));
  assert.ok(out.includes('__gmitm='), '键名保留');
  assert.ok(!out.includes('abc123def456'), '__gmitm 的值必须消失');
  assert.ok(!/access_token|jwt=|auth=/.test(out), '凭证形状的参数整个删除');
});

test('URL 剥敏：相对 href（pathname + search）也接 —— census 里存的就是这个形状', () => {
  const out = sanitizeUrlString('/analytics/traffic/top-pages/?q=canva.com&__gmitm=abc123def456');
  assert.equal(out.startsWith('/analytics/traffic/top-pages/'), true);
  assert.ok(!out.includes('abc123def456'));
  assert.ok(out.includes('__gmitm='));
});

test('eval 载荷剥敏：cookie / authorization / bearer 形状替换为 [REDACTED]', () => {
  const dirty = JSON.stringify({
    deepText: 'Cookie: sid=SECRETCOOKIE111; authorization: Bearer eyJSECRET222 done',
    note: 'set-cookie=SECRET333',
  });
  const clean = scrubEvalPayload(dirty);
  assert.ok(!clean.includes('SECRETCOOKIE111'));
  assert.ok(!clean.includes('eyJSECRET222'));
  assert.ok(!clean.includes('SECRET333'));
  assert.ok(clean.includes('[REDACTED]'));
  // 剥敏后仍是合法 JSON —— 落盘的就是这份字符串。
  assert.doesNotThrow(() => JSON.parse(clean));
});

test('eval 载荷剥敏：__gmitm 值经 redactSecrets 一并抹掉', () => {
  const clean = scrubEvalPayload('failed at https://sem.3ue.co/home/?__gmitm=abc123def456');
  assert.ok(!clean.includes('abc123def456'));
});

// ---------------------------------------------------------------------------
// 卡住判据：停滞（3 轮完全不变 + 0 格），不是耗时
// ---------------------------------------------------------------------------

const pollOf = (fingerprint, filledCells = 0) => ({ fingerprint, filledCells });

test('卡住判据：连续 3 轮 census 完全不变且 0 格 → 卡住，触发刷新', () => {
  assert.equal(isStalled([pollOf('shell'), pollOf('shell'), pollOf('shell')]), true);
  // 前面有过变化不影响：看的是**最近** 3 轮。
  assert.equal(isStalled([pollOf('a'), pollOf('shell'), pollOf('shell'), pollOf('shell')]), true);
});

test('卡住判据：有进展就不是卡 —— 试点 61 秒 light innerText 59 → 127 属于进展', () => {
  // 指纹里带着 light/deep 文本长度，任何一轮变化都打断停滞计数。
  assert.equal(isStalled([pollOf('light:59'), pollOf('light:59'), pollOf('light:127')]), false);
  assert.equal(isStalled([pollOf('a'), pollOf('b'), pollOf('c')]), false);
});

test('卡住判据：正常 76 秒慢加载不触发 —— 只要窗口里有一轮不同', () => {
  // 试点节奏：9s/45s 两轮相同，61s 变化，76s 数据落地。任何以耗时为判据的
  // 实现（「等了 60 秒还是 0 格 ⇒ 卡了」）都会在这条上翻车。
  const timeline = [pollOf('9s-shell'), pollOf('45s-shell'), pollOf('61s-progress'), pollOf('76s-data', 850)];
  assert.equal(isStalled(timeline), false);
});

test('卡住判据：不足 3 轮不触发；已有数据（filledCells > 0）不触发', () => {
  assert.equal(isStalled([]), false);
  assert.equal(isStalled([pollOf('shell'), pollOf('shell')]), false);
  assert.equal(isStalled([pollOf('x', 850), pollOf('x', 850), pollOf('x', 850)]), false, '数据已就绪的稳定不是卡住');
});

test('manifest：refreshes / refreshCount 进 manifest —— 「刷了 2 次没起来」和「从没刷过」必须可分辨', () => {
  const refreshes = [
    { refresh: 1, at: '2026-08-29T07:00:30.000Z', afterPoll: 3, reason: 'stalled: 3 consecutive polls with identical census and filledCells=0', lastCensus: { filledCells: 0, deepTextLength: 1_599_006, lightTextLength: 59 } },
  ];
  const manifest = buildManifest({
    url: 'https://sem.3ue.co/x', session: 'semrush-nav',
    startedAt: 'a', finishedAt: 'b', readyAfterMs: null,
    polls: [], steps: [], stopReason: 'budget', budgetSeconds: 180, maxScreens: 12,
    refreshes,
  });
  assert.equal(manifest.refreshCount, 1);
  assert.deepEqual(manifest.refreshes, refreshes);
  for (const key of ['refresh', 'at', 'afterPoll', 'reason', 'lastCensus']) {
    assert.ok(key in manifest.refreshes[0], `refresh 事件缺 ${key}`);
  }
  // 不传 refreshes 时是空数组而不是 undefined —— 「从没刷过」也要显式可读。
  const bare = buildManifest({ url: 'https://x.example/', session: 's', startedAt: 'a', finishedAt: 'b', readyAfterMs: 1, polls: [], steps: [], stopReason: 'stable', budgetSeconds: 180, maxScreens: 12 });
  assert.equal(bare.refreshCount, 0);
  assert.deepEqual(bare.refreshes, []);
});

// ---------------------------------------------------------------------------
// 空态标记（采集侧停轮询用，不构成结论）
// ---------------------------------------------------------------------------

test('空态标记：命中已知空态文案返回标记，普通文本返回 null', () => {
  assert.ok(detectEmptyState('该报告没有数据可显示'));
  assert.ok(detectEmptyState('No data available for this query'));
  assert.equal(detectEmptyState('主页 39.47% 4.1亿'), null);
  assert.equal(detectEmptyState(''), null);
  assert.equal(detectEmptyState(undefined), null);
});
