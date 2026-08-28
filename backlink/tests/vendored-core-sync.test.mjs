// 两份 opencli-core.mjs 的分叉守卫。
//
// 仓库里有两份同源文件：
//   opencli/scripts/opencli-core.mjs   —— 规范副本（~/.claude/skills/opencli 指向该目录）
//   backlink/scripts/opencli-core.mjs  —— vendored 副本，17 个 backlink 脚本和
//                                        rankup/scripts/demand/payment-referrers.mjs
//                                        import 的是这一份（opencli Skill 没装时也要能跑）
// 规范副本的头部注释写着「改动任何一份时同步另一份」。在这个文件出现之前，
// 没有任何东西在守这条规则，于是它已经悄悄变成假的。
//
// —— 为什么不用「逐字节相同」——
// 因为那是错的判据，会天天红，红到有人加 skip，然后等于没有检查。
// 两份文件现在合理地不同：vendored 那份多了 showHelpIfRequested / helpGuard
// （它服务的脚本要能响应 --help）和两个提交守卫；规范那份多了头部说明块。
// 逐字节判据无法表达「这几处不同是对的、别的不同是错的」。
//
// —— 实际判据 ——
// 按顶层导出符号切块比对，注释和空白归一化之后：
//   1. 两份都有的同名导出，实现必须一致；
//   2. 只有一份有的导出，必须写进 ALLOWED_ONE_SIDED 并给理由，
//      新出现的单边导出直接变红，逼作者要么同步、要么显式声明；
//   3. 已经存在、暂时不动的分叉写进 KNOWN_DRIFT，并钉住两侧各自的哈希——
//      任何一侧再被改一个字符就变红，分叉被修好（两侧一致）也变红，
//      提示删掉这条记录。这是隔离区，不是豁免区。
//   4. REQUIRED_EXPORTS 兜底：这些符号必须在两份里都存在，
//      免得有人靠删函数把检查做空。
//
// —— 这个判据漏掉什么（写出来比假装没有强）——
//   * 顶层导出之外的东西：文件级常量、非导出的辅助函数、import 语句、
//     模块顶层副作用。两份的这些部分可以随便漂移而不报警。
//   * 语义等价但写法不同会误报（改了局部变量名就红），
//     语义不同但写法相同不可能发生 —— 前者是可接受的代价，宁可吵不可漏。
//   * 归一化会抹掉注释，所以两份的文档注释可以自由漂移。sleepStep 就是例子：
//     一份中文注释一份英文注释，本判据不管。
//   * 靠正则切块，不是真解析器。顶层块必须以第 0 列的 `}` 或 `]` 收尾
//     （本仓库的格式一直如此）；切不出来时 extractExports 直接抛错，不静默放过。
//   * 只看这两个文件。第三份副本出现了它不知道。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANONICAL = 'opencli/scripts/opencli-core.mjs';
const VENDORED = 'backlink/scripts/opencli-core.mjs';

// 这些当前就该两边一致，且必须两边都存在。
const REQUIRED_EXPORTS = [
  'QUOTA_SITES',
  'quotaSiteOf',
  'quotaSession',
  'quotaSessionForKey',
  'sessionForUrl',
  'defaultSession',
  'guardSessionName',
  'validateSession',
  'sleepStep',
];

// 允许只存在于一侧的导出。新增单边导出必须在这里登记，否则测试变红。
const ALLOWED_ONE_SIDED = [
  {
    name: 'showHelpIfRequested',
    only: 'vendored',
    reason:
      '面板脚本的 --help 守卫。这些脚本只在 backlink 侧，帮助文案取调用方自身的头部注释；' +
      '规范副本没有对应的消费者，同步过去只是死代码。',
  },
  {
    name: 'helpGuard',
    only: 'vendored',
    reason: 'showHelpIfRequested 的无依赖版本，给那些在解析参数之前就开工的 backlink 脚本用。同上，只服务 backlink 侧。',
  },
  {
    name: 'makeSubmitGuard',
    only: 'vendored',
    reason: '表单提交守卫，只被 backlink 的填表脚本用；属于 backlink 的业务语义，不属于 opencli 通用封装。',
  },
  {
    name: 'releaseSubmitGuard',
    only: 'vendored',
    reason: '同 makeSubmitGuard，成对存在。',
  },
];

// 已知分叉隔离区。两侧的归一化哈希都钉死：任何一侧再改就红，修好（两侧一致）也红。
// 这里的每一条都是欠账，不是设计。
const KNOWN_DRIFT = [
  {
    name: 'openAndEval',
    canonicalHash: '073cd61673f54c65',
    vendoredHash: 'acba09e716ccc53e',
    reason:
      '危险分叉，未修：vendored 侧用 sleepStep(wait)，规范侧仍用 { cmd: "wait", seconds } —— ' +
      '而规范副本自己的 sleepStep 注释就写着 opencli 1.8.7 的 `wait time` 是空操作。' +
      '也就是说规范副本的 openAndEval 根本没有等待。修法是把规范侧改成 sleepStep(wait)；' +
      '本轮不动源码（有别的任务在跑实盘），先钉在这里。',
  },
  {
    name: 'sleepStep',
    canonicalHash: '84d3714b3999e4fb',
    vendoredHash: 'd6e91fb591ed535a',
    reason:
      '无害分叉：两侧实现等价，只有 Promise 回调的形参名不同（规范侧 r，vendored 侧 resolve）。' +
      '本判据不做 alpha 重命名归一化（那会让判据变得聪明而脆弱），所以记在这里。' +
      '顺手统一形参名即可消除，届时删掉本条。',
  },
];

function extractExports(src, label) {
  const lines = src.split('\n');
  const blocks = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^export\s+(?:async\s+)?(?:function|const|class|let|var)\s+([A-Za-z0-9_$]+)/);
    if (!m) continue;
    let end = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^[}\]]/.test(lines[j])) { end = j; break; }
    }
    assert.notEqual(end, -1, `${label}: 找不到导出 ${m[1]} 的块尾（第 0 列的 } 或 ]）。切块器坏了，不是代码没问题。`);
    blocks.set(m[1], lines.slice(i, end + 1).join('\n'));
    i = end;
  }
  assert.ok(blocks.size > 10, `${label}: 只切出 ${blocks.size} 个导出，切块器多半坏了。`);
  return blocks;
}

// 去注释、塌空白。故意不做任何标识符层面的归一化。
const normalize = (block) => block
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

const hash = (block) => createHash('sha256').update(normalize(block)).digest('hex').slice(0, 16);

const canonical = extractExports(readFileSync(resolve(repoRoot, CANONICAL), 'utf8'), CANONICAL);
const vendored = extractExports(readFileSync(resolve(repoRoot, VENDORED), 'utf8'), VENDORED);

const drift = new Map(KNOWN_DRIFT.map((d) => [d.name, d]));
const oneSided = new Map(ALLOWED_ONE_SIDED.map((d) => [d.name, d]));

test('两份 opencli-core.mjs：必须一致的导出都存在于两侧', () => {
  for (const name of REQUIRED_EXPORTS) {
    assert.ok(canonical.has(name), `${CANONICAL} 缺少导出 ${name}；不能靠删函数把同步检查做空。`);
    assert.ok(vendored.has(name), `${VENDORED} 缺少导出 ${name}；生产代码 import 的就是这一份。`);
  }
});

test('两份 opencli-core.mjs：同名导出的实现一致', () => {
  const diverged = [];
  for (const [name, block] of canonical) {
    if (!vendored.has(name)) continue;
    if (drift.has(name)) continue;
    if (normalize(block) !== normalize(vendored.get(name))) diverged.push(name);
  }
  assert.deepEqual(
    diverged,
    [],
    `这些导出在两份副本之间分叉了：${diverged.join(', ')}\n` +
    `两份必须同步（见 ${CANONICAL} 头部注释）。真要保留差异，就写进本文件的 KNOWN_DRIFT 并说明理由。`,
  );
});

test('两份 opencli-core.mjs：单边导出必须已登记', () => {
  const unregistered = [];
  for (const name of canonical.keys()) {
    if (!vendored.has(name) && oneSided.get(name)?.only !== 'canonical') unregistered.push(`${name} (仅 canonical)`);
  }
  for (const name of vendored.keys()) {
    if (!canonical.has(name) && oneSided.get(name)?.only !== 'vendored') unregistered.push(`${name} (仅 vendored)`);
  }
  assert.deepEqual(
    unregistered,
    [],
    `这些导出只存在于一侧且没有登记：${unregistered.join(', ')}\n` +
    '要么同步到另一份，要么写进本文件的 ALLOWED_ONE_SIDED 并说清为什么只该有一份。',
  );
});

test('两份 opencli-core.mjs：登记表本身不许过期', () => {
  for (const entry of ALLOWED_ONE_SIDED) {
    const present = entry.only === 'vendored' ? vendored.has(entry.name) : canonical.has(entry.name);
    assert.ok(present, `ALLOWED_ONE_SIDED 里的 ${entry.name} 已经不存在了，删掉这条登记。`);
    const other = entry.only === 'vendored' ? canonical.has(entry.name) : vendored.has(entry.name);
    assert.ok(!other, `${entry.name} 现在两侧都有了，从 ALLOWED_ONE_SIDED 里删掉它，让它回到一致性检查里。`);
    assert.ok(entry.reason?.length > 20, `${entry.name} 的登记理由太短，写清楚为什么只该有一份。`);
  }
});

test('两份 opencli-core.mjs：已知分叉被钉住，不许继续漂', () => {
  for (const entry of KNOWN_DRIFT) {
    assert.ok(canonical.has(entry.name) && vendored.has(entry.name), `KNOWN_DRIFT 里的 ${entry.name} 已不是两侧共有，删掉这条。`);
    const c = hash(canonical.get(entry.name));
    const v = hash(vendored.get(entry.name));
    assert.notEqual(c, v, `${entry.name} 的分叉已经消失（两侧一致）。把它从 KNOWN_DRIFT 删掉，好让它受常规检查保护。`);
    assert.equal(c, entry.canonicalHash, `${CANONICAL} 的 ${entry.name} 变了。这是已登记的分叉，改它之前先确认另一份要不要跟着改；确认后更新 KNOWN_DRIFT 的哈希。`);
    assert.equal(v, entry.vendoredHash, `${VENDORED} 的 ${entry.name} 变了。这是已登记的分叉，改它之前先确认另一份要不要跟着改；确认后更新 KNOWN_DRIFT 的哈希。`);
    assert.ok(entry.reason?.length > 20, `${entry.name} 的分叉理由太短。`);
  }
});
