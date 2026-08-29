/**
 * 入口守卫回归测试——不碰浏览器，可以随时跑。
 *   node --test opencli/tests/entrypoint-guard.test.mjs
 *
 * 背景：skill 通过符号链接安装到 ~/.claude/skills/<name>，此时 ESM 的
 * import.meta.url 是真实路径而 process.argv[1] 是符号链接路径，
 * `import.meta.url === \`file://\${process.argv[1]}\`` 永不相等，
 * main() 静默不执行、脚本退出 0——闸门从来没关过。
 * 正确写法是 pathToFileURL(realpathSync(process.argv[1])).href。
 * 这里扫描仓库全部 .mjs，断言旧模式不再出现。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'opencli-workspace', '.git']);

// 拆开写，免得本文件自己命中自己要找的模式。
const BROKEN_GUARD = 'import.meta.url === `file://' + '${process.argv[1]}`';

function* mjsFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* mjsFiles(full);
    else if (name.endsWith('.mjs')) yield full;
  }
}

test('没有 .mjs 再使用对符号链接失效的入口守卫', () => {
  const offenders = [];
  for (const file of mjsFiles(REPO_ROOT)) {
    if (readFileSync(file, 'utf8').includes(BROKEN_GUARD)) {
      offenders.push(relative(REPO_ROOT, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `这些文件仍在用 \`file://\${process.argv[1]}\` 入口守卫（符号链接下 main 永不执行）：\n  ${offenders.join('\n  ')}`,
  );
});
