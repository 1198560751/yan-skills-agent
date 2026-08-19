#!/usr/bin/env node
/**
 * apply-traffic-screen.mjs —— 把 similarweb-batch.mjs 的 JSONL 结果写回
 * data/submission-targets.json 的 `traffic` 字段。
 *
 * 为什么要单独一步：流量结论必须是**可查询的字段**，不是备注里的一句话。
 * 写成备注的后果是下一轮选批次时没人筛得动，于是又把没流量的站填一遍。
 *
 * 只写 `traffic`，**不改 `status`**。两个字段答的是不同问题：
 *   status  —— 这个入口还在不在（可达性）
 *   traffic —— 值不值得走这个入口（准入）
 * 把没流量的站标成 dead 会丢掉"入口是好的，只是站太小"这个事实，
 * 而流量是会变的，可达性不会自己回来。筛选交给 targets-select 的 --min-traffic。
 *
 * 用法：node scripts/apply-traffic-screen.mjs --in traffic.jsonl [--source similarweb] [--dry]
 */
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, '..', 'data', 'submission-targets.json');

const a = { in: [], source: 'similarweb', dry: false };
for (let i = 2; i < process.argv.length; i++) {
  const f = process.argv[i]; const v = () => process.argv[++i];
  if (f === '--in') a.in.push(v());
  else if (f === '--source') a.source = v();
  else if (f === '--dry') a.dry = true;
  else { process.stderr.write(`unknown flag ${f}\n`); process.exit(2); }
}
if (!a.in.length) { process.stderr.write('--in <jsonl> is required (repeatable)\n'); process.exit(2); }

const byDomain = new Map();
for (const line of a.in.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n'))) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  // error 不是结论，是这次没测成。绝不写进去冒充判决——而且如果表里已经写着一条
  // 由 error 降级来的旧判决（例如超时被误记成 below-floor），必须**清掉**它，
  // 不能留在那儿冒充已测。所以 error 也要进 map，只是带上删除标记。
  if (r.verdict === 'error') { byDomain.set(r.domain, { ...r, __clear: true }); continue; }
  const prev = byDomain.get(r.domain);
  if (prev && Date.parse(prev.checkedAt) >= Date.parse(r.checkedAt)) continue;
  byDomain.set(r.domain, r);
}

const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
let applied = 0;
let cleared = 0;
const counts = { pass: 0, fail: 0, 'below-floor': 0 };
for (const t of doc.targets) {
  const r = byDomain.get(t.domain);
  if (!r) continue;
  // **只清掉同一个数据源留下的旧判决。** A 源这次超时，对 B 源已经测出来的数字
  // 不构成任何否定——跨源清除会让「先跑 B 再跑 A」把 B 的成果全抹掉，
  // 而输出只轻描淡写地说 cleared N，极易被当成正常。
  if (r.__clear) {
    if (t.traffic && t.traffic.source === a.source) { delete t.traffic; cleared++; }
    continue;
  }
  t.traffic = {
    monthlyVisits: (r.totalVisits ?? r.organicTraffic) ?? null,
    verdict: r.verdict,
    checkedAt: r.checkedAt,
    source: a.source,
    globalRank: Number.isInteger(r.globalRank) ? r.globalRank : null,
  };
  applied++;
  counts[r.verdict] = (counts[r.verdict] || 0) + 1;
}
doc.updatedAt = new Date().toISOString().slice(0, 10);

const unmatched = [...byDomain.keys()].filter((d) => !doc.targets.some((t) => t.domain === d));
process.stderr.write(`applied ${applied} of ${byDomain.size} rows; verdicts ${JSON.stringify(counts)}; cleared ${cleared} stale measurement(s)\n`);
if (unmatched.length) process.stderr.write(`${unmatched.length} measured domain(s) not in the table (ignored): ${unmatched.slice(0, 8).join(', ')}\n`);
if (a.dry) { process.stderr.write('--dry: nothing written\n'); process.exit(0); }
fs.writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
process.stderr.write(`wrote ${FILE}\n`);
