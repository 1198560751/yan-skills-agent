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
import { gotoInTool, routeMismatch } from '../scripts/lib-tools-share.mjs';

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
