/**
 * 配额站护栏的纯函数测试——不碰浏览器，可以随时跑。
 *   node --test opencli/tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  quotaSession, quotaSiteOf, sessionForUrl, guardSessionName,
  sleepStep, buildExtractCommands, QUOTA_SITES, resolveSession, urlFromArgs, logSiteAccess,
} from '../scripts/opencli-core.mjs';

test('配额站收敛成固定会话名，普通站不受影响', () => {
  assert.equal(quotaSession('https://sem.3ue.co/analytics/overview/'), 'semrush-nav');
  assert.equal(quotaSession('https://www.semrush.com/analytics/'), 'semrush-nav');
  assert.equal(quotaSession('https://sim.3ue.co/#/digitalsuite'), 'similarweb-nav');
  assert.equal(quotaSession('https://example.com'), null);
  assert.match(sessionForUrl('https://example.com', 'recon'), /^recon-/);
  assert.equal(sessionForUrl('https://sem.3ue.co/x', 'recon'), 'semrush-nav');
});

test('主机名要精确匹配，不能被撞名域名骗到', () => {
  assert.equal(quotaSiteOf('https://not-semrush.com.evil.test/'), null);
  // 子域**要**算进配额：cdn.semrush.com 打的还是 Semrush，
  // 漏掉它等于让一部分导航绕过节流。
  assert.equal(quotaSiteOf('https://cdn.semrush.com/')?.key, 'semrush');
  assert.equal(quotaSiteOf('https://semrush.com.evil.test/'), null, '后缀撞名不算');
  assert.ok(QUOTA_SITES.every((s) => s.gapMs > 0), '每个配额站都要有间隔');
});

test('拒绝 $$ 形状的会话名', () => {
  for (const bad of ['probe-483', 'probe-48321', 'opencli-wait-probe-11706']) {
    assert.throws(() => guardSessionName(bad), /PID 的形状/, bad);
  }
  for (const good of ['semrush-nav', 'backlink-probe-cn', 'recon-339e827ccb35']) {
    assert.equal(guardSessionName(good), good);
  }
});

test('节流必须走 eval，不能走 wait time', () => {
  // wait time 在 opencli 1.8.7 是坏的：报 "Waited 5s"，实测 928ms 就返回。
  // 这条一旦退回 {cmd:'wait'}，整套间隔机制会静默变成空操作。
  const step = sleepStep(4);
  assert.equal(step.cmd, 'eval', 'wait 分支会让节流静默失效');
  assert.match(step.args.js, /setTimeout\([^,]+,\s*4000\)/, '延时必须是 4000ms');
  // 断言到此为止：回调参数叫 r 还是 resolve 不是不变量。第一版把名字也钉住了，
  // 于是两份副本统一变量名时这条无辜变红——测试该守行为，不该守写法。
});

test('探活那一次不许带 open', () => {
  const evalStep = { cmd: 'eval', args: { js: 'X' } };
  const base = { url: 'https://x.test', evalStep, selector: 'h1', settleSeconds: 0, gapMs: 4000, timeout: 9 };
  const nav = buildExtractCommands({ ...base, navigate: true });
  const probe = buildExtractCommands({ ...base, navigate: false });

  assert.equal(nav[0].cmd, 'open');
  assert.equal(nav[1].args.selector, 'h1');
  assert.ok(!probe.some((c) => c.cmd === 'open'), '导航超时后重开新标签页正是要防的事');
  assert.deepEqual(probe[0], evalStep);
  assert.match(nav.at(-1).args.js, /4000/, '节流挂在 batch 末尾');
  assert.equal(buildExtractCommands({ ...base, gapMs: 0, navigate: true }).at(-1), evalStep);
});

test('配额站的会话名由站点决定，--session 不能悄悄恢复旧行为', () => {
  const errs = [];
  const real = console.error; console.error = (m) => errs.push(m);
  try {
    assert.equal(resolveSession({}, 'semrush-overview', 'semrush'), 'semrush-nav');
    assert.equal(resolveSession({ session: 'my-own' }, 'x', 'semrush'), 'semrush-nav',
      '传了 --session 也照样收敛');
    assert.equal(errs.length, 1, '忽略 --session 必须出声，不能静默');
    assert.match(errs[0], /配额站/);

    // 逃生舱：显式声明才放行
    assert.equal(resolveSession({ session: 'my-own', 'allow-parallel-session': true }, 'x', 'semrush'), 'my-own');
    // 非配额站不受影响
    assert.equal(resolveSession({ session: 'my-own' }, 'x'), 'my-own');
    assert.match(resolveSession({}, 'recon'), /^recon-/);
    // 守卫仍然拦 $$ 形状
    assert.throws(() => resolveSession({ session: 'probe-48321' }, 'x'), /PID 的形状/);
  } finally { console.error = real; }
});

test('访问记账能从各种参数形状里认出 URL', () => {
  assert.equal(urlFromArgs(['open', 'https://sem.3ue.co/analytics/overview/']),
    'https://sem.3ue.co/analytics/overview/');
  // batch 的 URL 埋在 --commands 的 JSON 里
  assert.equal(urlFromArgs(['batch', '--commands',
    JSON.stringify([{ cmd: 'open', args: { url: 'https://example.com/a' } }])]),
    'https://example.com/a');
  assert.equal(urlFromArgs(['state', '--source', 'ax']), null, '没有 URL 就是 null');
});

test('OPENCLI_ACCESS_LOG=0 时记账彻底闭嘴', () => {
  const prev = process.env.OPENCLI_ACCESS_LOG;
  process.env.OPENCLI_ACCESS_LOG = '0';
  try {
    // 不抛异常即可——记账绝不能把调用方搞挂，关掉时更不该有任何副作用
    assert.doesNotThrow(() => logSiteAccess({ ts: 'x', site: 'y' }));
  } finally {
    if (prev === undefined) delete process.env.OPENCLI_ACCESS_LOG;
    else process.env.OPENCLI_ACCESS_LOG = prev;
  }
});
