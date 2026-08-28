// 为什么有这个文件（2026-08-28）：
//
// `backlink/scripts/semrush-report.mjs` 早就实现了 `keyword-magic` 和 `referring-domains`
// 两张报表，但 `rankup/data/provider-capabilities.json` 的
// `providers.semrush.scriptCoverage.reports` 里没有它们，而 `gapsRanked` 里**还把它们
// 列为待办缺口**。两个方向同时过时了好几天，没有任何东西会发现。
//
// 这是本仓库反复出的那类问题：**同一个事实写在两个地方，没有任何检查在守，
// 于是它悄悄变成假的。** 更糟的是缺口方向——一条已经做完的事还挂在待办里，
// 会让人以为某件事不能做而绕路；反过来目录里记了脚本其实不支持的能力，
// 会让人以为某件事能做而白跑。两个方向都要查。
//
// 三条检查：
//   1. 实现 ⊆ 记录：脚本里每个 report key 都必须出现在 JSON 的 reports 里。
//   2. 记录 ⊆ 实现：JSON 里记的每个 report 脚本都必须真的支持。
//   3. 已实现的报表不许还挂在 gapsRanked 里。
//
// 纯离线：不开浏览器、不联网。见下方 readImplementedReports 的说明。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(root, 'backlink/scripts/semrush-report.mjs');
const catalogPath = path.join(root, 'rankup/data/provider-capabilities.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const coverage = catalog.providers.semrush.scriptCoverage;

/**
 * 怎么读脚本里的 REPORTS —— 三种办法，选了第三种。
 *
 * a) `import` 它：不行。semrush-report.mjs 顶层就在跑副作用（parseFlags(process.argv)、
 *    resolveSession、缺 --report 时 process.exit(2)）。加个 `export { REPORTS }` 也救不了，
 *    因为 import 依然会执行整个模块体。这也是为什么本文件**没有改动 semrush-report.mjs**。
 *
 * b) 正则刮源码：脆，且刮失败时容易静默返回空集合——那会让「实现 ⊆ 记录」这条
 *    永远通过，正是本仓库出过的「删掉功能测试照样绿」那类坑。
 *
 * c) 问脚本自己（采用）：`--report <不存在的值>` 会走脚本自带的用法错误分支，
 *    打印 `--report must be one of: a, b, c` 然后 exit 2。这是**运行时真值**——
 *    直接来自 `Object.keys(REPORTS)`，不是对源码的猜测。它在任何浏览器/网络动作
 *    之前就退出（实测 ~30ms），所以完全离线。
 *
 * 失败要吵：退出码不是 2、或者 stderr 里找不到那行前缀、或者解析出来是空集合，
 * 一律 throw，绝不返回空集合。
 */
function readImplementedReports() {
  let stderr = '';
  let status = 0;
  try {
    execFileSync(process.execPath, [scriptPath, '--report', '__not_a_report__'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
  } catch (error) {
    stderr = String(error.stderr ?? '');
    status = error.status;
  }
  assert.equal(status, 2, `semrush-report.mjs 应当以退出码 2 拒绝未知 --report，实际 ${status}；` +
    '这个探针失效了，本文件的三条检查全部不可信，先修探针再说。');
  const line = stderr.split('\n').find((l) => l.startsWith('--report must be one of:'));
  assert.ok(line, '在 semrush-report.mjs 的 stderr 里找不到 `--report must be one of:` 那行。' +
    `脚本的用法错误信息改了格式，这个探针必须跟着改。实际 stderr：\n${stderr}`);
  const reports = line.slice('--report must be one of:'.length).split(',').map((s) => s.trim()).filter(Boolean);
  assert.ok(reports.length >= 5, `只从 semrush-report.mjs 解析出 ${reports.length} 个 report，` +
    '低到不可信——宁可报错也不要返回一个会让所有检查空过的集合。');
  return reports;
}

const implemented = readImplementedReports();
const recorded = coverage.reports ?? [];

test('semrush-report.mjs 实现的每张报表都记进了能力目录', () => {
  const missing = implemented.filter((r) => !recorded.includes(r));
  assert.deepEqual(missing, [], `脚本已支持但 providers.semrush.scriptCoverage.reports 里没有：${missing.join(', ')}`);
});

test('能力目录里记的每张报表脚本都真的支持', () => {
  // 记了不存在的能力比漏记更糟：漏记只是让人绕路，虚记会让人以为某件事已经能做。
  const phantom = recorded.filter((r) => !implemented.includes(r));
  assert.deepEqual(phantom, [], `目录里记了但 semrush-report.mjs 不支持：${phantom.join(', ')}`);
});

/**
 * 第 3 条：已实现的报表不许还挂在 gapsRanked 里。
 *
 * gapsRanked 是自然语言描述（`"Keyword Gap and Backlink Gap"`），不是 report key，
 * 所以不能直接字符串相等。两种做法：
 *
 *   A. 给每个 report key 维护一组「不该出现在 gapsRanked 里的辨识短语」（采用）。
 *   B. 给 gapsRanked 的每一条加结构化字段（比如 `{ gap, coveredBy }`）。
 *
 * 选 A，理由：**B 有个静默漏洞**。下次谁用自由文本再加一条缺口，多半不会想起来补
 * 那个字段，于是检查永远不触发——而 2026-08-28 这次漂移恰恰就是「自由文本条目
 * 在实现之后没人删」。一条永远不触发的检查等于没有检查。A 直接查已经在那儿的文本，
 * 不依赖未来的人记得填字段。
 *
 * 但 A 的代价是误报风险，所以短语必须**足够辨识**：
 *   - 不能只用单词。`keyword-magic` 若匹配 /keyword/，
 *     `"Keyword Gap and Backlink Gap"` 会立刻误报——那是另一件真没做的事。
 *   - 只用「这张报表的专名」级别的整词组（Keyword Magic / 关键词魔法 / Referring Domains …）。
 *
 * **宁可漏报也不要误报。** 短语宁可窄，漏掉一次也好过天天喊狼来了被人加进忽略名单。
 * 已知的漏报形态：同一张报表的**另一个**子能力仍是缺口（比如「Keyword Magic 的 CSV
 * 导出」），此时条目里会带 Keyword Magic 字样却是合法的缺口。真遇到了，把那一条改写成
 * 不含专名的描述，或者在下面给该 report 收窄短语——别把整条检查关掉。
 *
 * 每个已实现的 report 都必须在这张表里有条目（下面那条检查在守），
 * 所以脚本新增报表时会强制作者过一遍这里，不会静默漏守。
 */
const GAP_PHRASES = {
  'organic-overview': [/organic overview/i, /自然(搜索)?概览/],
  'organic-positions': [/organic positions/i, /organic rankings/i, /自然排名/],
  'organic-pages': [/organic pages/i, /top pages/i, /主要页面/],
  'backlinks-list': [/backlinks? list/i, /backlink analytics/i, /反链明细/],
  'backlinks-overview': [/backlinks? overview/i, /反链概览/],
  'referring-domains': [/referring domains?/i, /引荐域名/],
  'keyword-magic': [/keyword magic/i, /关键词魔法/],
  'keyword-overview': [/keyword overview/i, /关键词概览/],
};

test('已实现的报表不许还挂在 gapsRanked 里', () => {
  const gaps = coverage.gapsRanked ?? [];
  const stale = [];
  for (const report of implemented) {
    for (const gap of gaps) {
      const text = String(gap);
      const hit = text.includes(report) || (GAP_PHRASES[report] ?? []).some((re) => re.test(text));
      if (hit) stale.push(`${report} ← gapsRanked: ${JSON.stringify(text)}`);
    }
  }
  assert.deepEqual(stale, [], '这些报表脚本已经实现，却还被 gapsRanked 列为待办缺口：\n' + stale.join('\n'));
});

test('每个已实现的报表都在 GAP_PHRASES 里有条目', () => {
  // 少了这条，脚本新增一张报表时上面那条检查会对它静默失守。
  const unguarded = implemented.filter((r) => !GAP_PHRASES[r]);
  assert.deepEqual(unguarded, [], `这些报表没有 gapsRanked 辨识短语，缺口方向无人看守：${unguarded.join(', ')}`);
  const orphan = Object.keys(GAP_PHRASES).filter((r) => !implemented.includes(r));
  assert.deepEqual(orphan, [], `GAP_PHRASES 里有脚本已经不支持的报表，说明这张表也漂了：${orphan.join(', ')}`);
});
