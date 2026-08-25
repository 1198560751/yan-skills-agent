import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireToolsShareLock,
  assertToolsShareAvailable,
  toolsShareBlockReason,
} from '../scripts/lib-tools-share.mjs';

test('recognizes redirect, expired session, and cooldown pages', () => {
  assert.match(toolsShareBlockReason({ url: 'https://gmitm.redirect.dash/error' }), /access-denied/);
  assert.match(
    toolsShareBlockReason({ url: 'https://sem.3ue.co/gmitm.redirect.dash?msg=%E7%99%BB%E5%BD%95%E8%BF%87%E6%9C%9F%E6%88%96%E6%97%A0%E6%95%88' }),
    /expired/,
  );
  assert.match(toolsShareBlockReason({ bodyText: '登录过期或无效，请重新登录' }), /expired/);
  assert.match(toolsShareBlockReason({ bodyText: '账号已冻结，剩余冷却 350 分钟' }), /frozen/);
  assert.equal(toolsShareBlockReason({ url: 'https://sem.3ue.co/home/', bodyText: '关键词难度 22' }), null);
  assert.throws(
    () => assertToolsShareAvailable({ bodyText: 'session expired' }),
    (error) => error.code === 'TOOLS_SHARE_BLOCKED',
  );
});

test('serializes concurrent users of the same tool lock', async () => {
  const lockRoot = await mkdtemp(join(tmpdir(), 'tools-share-lock-test-'));
  try {
    const first = await acquireToolsShareLock('test-sem', { lockRoot, pollMs: 10, timeoutMs: 1000 });
    let secondAcquired = false;
    const secondPromise = acquireToolsShareLock('test-sem', { lockRoot, pollMs: 10, timeoutMs: 1000 })
      .then((lock) => { secondAcquired = true; return lock; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(secondAcquired, false);
    await first.release();
    const second = await secondPromise;
    assert.equal(secondAcquired, true);
    await second.release();
  } finally {
    await rm(lockRoot, { recursive: true, force: true });
  }
});
