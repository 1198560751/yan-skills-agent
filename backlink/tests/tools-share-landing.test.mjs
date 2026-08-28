/**
 * gotoInTool() 的落地校验。
 *
 * 堵的是这条静默取错数据的路径：Similarweb 面板对未知路由**不报 404**，
 * 而是静默重定向到 `#/digitalsuite/ai-brand-visibility/home`。旧版 gotoInTool
 * 只把落地的 location.href 原样返回，从没跟请求的比过，于是别的页面上的数字
 * 会被标成「请求的那张报表」的结果输出出去。
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { gotoInTool, routeMismatch, routeWindow } from '../scripts/lib-tools-share.mjs';

const SW = 'https://sim.3ue.co';
const HIJACK = `${SW}/#/digitalsuite/ai-brand-visibility/home`;

/**
 * 假 evalPage：第一次调用是 `location.href = ...`（导航），之后的调用读回落地状态。
 * 落地 URL 由 `landedUrl` 决定——这就是被测的那个静默重定向。
 */
function fakeEvalPage(landedUrl, { title = 'Similarweb PRO', bodyText = 'ok' } = {}) {
  const calls = [];
  return {
    calls,
    evalPage: async (script) => {
      calls.push(script);
      // 真的 evalPage 会把页面回传的 JSON 解析好再交出来。
      if (script.includes('location.href =')) return { navigating: true };
      return { url: landedUrl, title, bodyText };
    },
  };
}

// settle 传 0，测试里不要真的睡 15 秒。
const goto = (evalPage, target, options) => gotoInTool(evalPage, target, 0, options);

test('landing on exactly the requested hash route passes', async () => {
  const route = `${SW}/#/digitalsuite/websiteanalysis/overview/website-performance/*/999/28d?webSource=Total&key=example.com`;
  const { evalPage } = fakeEvalPage(route);
  const landed = await goto(evalPage, route);
  assert.equal(landed.url, route);
});

test('a silent redirect to ai-brand-visibility throws, naming both routes', async () => {
  const route = `${SW}/#/digitalsuite/websiteanalysis/overview/website-performance/*/999/28d?key=example.com`;
  const { evalPage } = fakeEvalPage(HIJACK);
  await assert.rejects(
    () => goto(evalPage, route),
    (err) => {
      // 请求值和落地值都必须在错误信息里，否则读的人无从判断是哪条路由写错了。
      assert.match(err.message, /websiteanalysis\/overview\/website-performance/);
      assert.match(err.message, /ai-brand-visibility\/home/);
      // 必须明确说这是重定向，不是超时——否则下一个人会去加 --settle。
      assert.match(err.message, /redirect, not a timeout/);
      return true;
    },
  );
});

test('the app rewriting query parameters is not a mismatch', async () => {
  const requested = `${SW}/#/digitalsuite/websiteanalysis/traffic-overview/marketing-channels/999/28d/?webSource=Total&key=example.com`;
  // 落地时应用补了默认参数、改了参数顺序、丢了一个空参数，并且吃掉了尾斜杠。
  const landed = `${SW}/#/digitalsuite/websiteanalysis/traffic-overview/marketing-channels/999/28d?key=example.com&webSource=Total&comparedDuration=&isWWW=false`;
  const { evalPage } = fakeEvalPage(landed);
  const got = await goto(evalPage, requested);
  assert.equal(got.url, landed);
});

test('allowRedirect: true lets a redirect through', async () => {
  const route = `${SW}/#/digitalsuite/websiteanalysis/overview/website-performance/*/999/28d?key=example.com`;
  const { evalPage } = fakeEvalPage(HIJACK);
  const landed = await goto(evalPage, route, { allowRedirect: true });
  assert.equal(landed.url, HIJACK);
});

test('a non-hash Semrush pathname mismatch throws', async () => {
  const requested = 'https://sem.3ue.co/analytics/traffic/overview/?q=example.com&searchType=domain';
  // 实测：这条路由 302 到 Getting Started 落地页并丢掉 query。
  const landed = 'https://sem.3ue.co/analytics/traffic/getting-started/';
  const { evalPage } = fakeEvalPage(landed, { title: 'Traffic Analytics' });
  await assert.rejects(
    () => goto(evalPage, requested),
    (err) => {
      assert.match(err.message, /\/analytics\/traffic\/overview/);
      assert.match(err.message, /\/analytics\/traffic\/getting-started/);
      return true;
    },
  );
});

test('a hash route landing on a plain path is a mismatch', async () => {
  const requested = `${SW}/#/digitalsuite/websiteanalysis/overview/website-performance/*/999/28d?key=example.com`;
  const { evalPage } = fakeEvalPage(`${SW}/login`);
  await assert.rejects(() => goto(evalPage, requested), /landed route:\s+\/login/);
});

test('the redirect error is redacted', async () => {
  const secret = 'aVeryLongGmitmTokenValue123456';
  const requested = `${SW}/#/digitalsuite/websiteanalysis/overview/website-performance/*/999/28d?key=example.com&__gmitm=${secret}`;
  const { evalPage } = fakeEvalPage(`${HIJACK}?__gmitm=${secret}`);
  await assert.rejects(
    () => goto(evalPage, requested),
    (err) => {
      assert.ok(!err.message.includes(secret), 'the __gmitm value must not survive into the error text');
      // 键名要留着，否则读的人看不出这里本来带了什么。
      assert.match(err.message, /__gmitm=<redacted>/);
      return true;
    },
  );
});

test('routeMismatch normalizes trailing slashes but not the path itself', () => {
  assert.equal(routeMismatch('https://a.co/#/x/y/?q=1', 'https://a.co/#/x/y?q=2'), null);
  assert.equal(routeMismatch('https://a.co/p/', 'https://a.co/p'), null);
  assert.deepEqual(routeMismatch('https://a.co/#/x/y', 'https://a.co/#/x/z'), { requested: '/x/y', landed: '/x/z' });
});

test('a relative target is compared against the absolute landed url', async () => {
  const { evalPage } = fakeEvalPage(`${SW}/#/digitalsuite/websiteanalysis/overview/website-performance/*/999/28d?key=e.com`);
  const landed = await goto(evalPage, '/#/digitalsuite/websiteanalysis/overview/website-performance/*/999/28d?key=e.com');
  assert.ok(landed.url.includes('website-performance'));
});

/* ------------------------------------------------------------------ *
 * 时间窗口段被面板改写：容忍，但必须把真实窗口带回来
 *
 * 2026-08-28 实测（creem.io）：请求
 *   /digitalsuite/websiteanalysis/traffic-overview/marketing-channels/999/28d
 * 落到
 *   /digitalsuite/websiteanalysis/traffic-overview/marketing-channels/999/6m
 * 顶层报表没变，只有窗口段被改写（小站没有 28 天数据，面板自动放宽）。
 * **逐字节相同的这条路由在 canva.com 上完全不被改写**，所以拿大站永远测不出来,
 * 而 payment-referrers.mjs 的全部工作负载就是这类小站——它在真实用途上必炸。
 *
 * 光「忽略窗口段」是不够的：落地 6m 而脚本仍按 28d 标注输出，
 * 就是把 6 个月的数字标成 28 天,正是这道校验本来要防的那类错标。
 * ------------------------------------------------------------------ */

const CHANNELS = `${SW}/#/digitalsuite/websiteanalysis/traffic-overview/marketing-channels/999`;

test('only the time-window segment differing is tolerated', () => {
  assert.equal(routeMismatch(`${CHANNELS}/28d?key=creem.io`, `${CHANNELS}/6m?key=creem.io`), null);
  assert.equal(routeMismatch(`${CHANNELS}/28d`, `${CHANNELS}/3m`), null);
  assert.equal(routeMismatch(`${CHANNELS}/28d`, `${CHANNELS}/1m`), null);
  assert.equal(routeMismatch(`${CHANNELS}/1m`, `${CHANNELS}/7d`), null);
});

test('a differing report segment still throws, window segment identical or not', () => {
  // 报表段变了：真重定向，照抛。
  assert.deepEqual(
    routeMismatch(`${CHANNELS}/28d`, `${SW}/#/digitalsuite/websiteanalysis/traffic-overview/referrals/999/28d`),
    {
      requested: '/digitalsuite/websiteanalysis/traffic-overview/marketing-channels/999/28d',
      landed: '/digitalsuite/websiteanalysis/traffic-overview/referrals/999/28d',
    },
  );
  // 报表段和窗口段一起变：更明显的重定向，同样照抛。
  assert.deepEqual(
    routeMismatch(`${CHANNELS}/28d`, `${SW}/#/digitalsuite/websiteanalysis/traffic-overview/referrals/999/6m`),
    {
      requested: '/digitalsuite/websiteanalysis/traffic-overview/marketing-channels/999/28d',
      landed: '/digitalsuite/websiteanalysis/traffic-overview/referrals/999/6m',
    },
  );
});

test('999 is not a window segment — changing it still throws', () => {
  // `999` 在多条路由上都是这个固定值，它不是时间窗口。
  // 把容忍放宽成「忽略最后一段」或「忽略任何纯数字段」，这条就会漏过去。
  const base = `${SW}/#/digitalsuite/websiteanalysis/traffic-overview/marketing-channels`;
  assert.deepEqual(routeMismatch(`${base}/999/28d`, `${base}/123/28d`), {
    requested: '/digitalsuite/websiteanalysis/traffic-overview/marketing-channels/999/28d',
    landed: '/digitalsuite/websiteanalysis/traffic-overview/marketing-channels/123/28d',
  });
  // 末段就是 999 时（没有窗口段的路由）也一样必须抛。
  assert.deepEqual(routeMismatch(`${base}/999`, `${base}/6m`), {
    requested: '/digitalsuite/websiteanalysis/traffic-overview/marketing-channels/999',
    landed: '/digitalsuite/websiteanalysis/traffic-overview/marketing-channels/6m',
  });
  assert.deepEqual(routeMismatch(`${base}/28d`, `${base}/999`), {
    requested: '/digitalsuite/websiteanalysis/traffic-overview/marketing-channels/28d',
    landed: '/digitalsuite/websiteanalysis/traffic-overview/marketing-channels/999',
  });
});

test('a window-looking segment that is not the last one is not tolerated', () => {
  // 只放宽末段：中间段变了属于路由形状变了，不是窗口放宽。
  const a = `${SW}/#/digitalsuite/websiteanalysis/28d/marketing-channels/999`;
  const b = `${SW}/#/digitalsuite/websiteanalysis/6m/marketing-channels/999`;
  assert.deepEqual(routeMismatch(a, b), {
    requested: '/digitalsuite/websiteanalysis/28d/marketing-channels/999',
    landed: '/digitalsuite/websiteanalysis/6m/marketing-channels/999',
  });
});

test('gotoInTool tolerates the window rewrite and reports the landed window', async () => {
  const requested = `${CHANNELS}/28d/?webSource=Total&key=creem.io`;
  const landedUrl = `${CHANNELS}/6m?webSource=Total&key=creem.io`;
  const { evalPage } = fakeEvalPage(landedUrl);
  const landed = await goto(evalPage, requested);
  assert.equal(landed.url, landedUrl);
  // 回传必须同时带上「请求的窗口」和「实际的窗口」——只有实际窗口的话，
  // 下游看到 6m 也不知道它本来要的是 28d。
  assert.deepEqual(landed.routeWindow, { requested: '28d', landed: '6m', rewritten: true });
});

test('gotoInTool reports the window even when it was not rewritten', async () => {
  const route = `${CHANNELS}/28d?key=canva.com`;
  const { evalPage } = fakeEvalPage(route);
  const landed = await goto(evalPage, route);
  assert.deepEqual(landed.routeWindow, { requested: '28d', landed: '28d', rewritten: false });
});

test('routeWindow is null for routes whose last segment is not a window', () => {
  const base = `${SW}/#/digitalsuite/websiteanalysis/traffic-overview/marketing-channels/999`;
  assert.equal(routeWindow(base, base), null);
  assert.equal(routeWindow('https://sem.3ue.co/analytics/overview/', 'https://sem.3ue.co/analytics/overview/'), null);
});

test('the referrals hop also carries its landed window', async () => {
  // payment-referrers.mjs:281 —— 在窗口误报修掉之前，这一跳从来没被执行到
  // （280 行那一跳先抛了错）。它的输出同样要带上落地窗口。
  const requested = `${SW}/#/digitalsuite/websiteanalysis/referrals/*/999/28d?selectedTab=incomingTraffic&key=creem.io`;
  const landedUrl = `${SW}/#/digitalsuite/websiteanalysis/referrals/*/999/6m?selectedTab=incomingTraffic&key=creem.io`;
  const { evalPage } = fakeEvalPage(landedUrl);
  const landed = await goto(evalPage, requested);
  assert.deepEqual(landed.routeWindow, { requested: '28d', landed: '6m', rewritten: true });
});
