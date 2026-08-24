#!/usr/bin/env node
// 挖「叫好不叫卖」的 Skill：**故意不按星数排**，因为星数在这个索引里根本不是质量信号。
//
// 【为什么星数会误导，这是实测的】
// API 返回的 `stars` 是**所在 GitHub 仓库**的星数，不是这个 Skill 的。
// 实测 `affaan-m/ECC` 报 240467，与该仓库真实星数 240743 对得上——所以确认无疑。
// 后果：一个塞在超高星仓库里的 Skill 自动继承那个星数，
// 而一个作者单独开仓库、认真写的 Skill 只有 3 颗星。
// 实测搜 `backlink` 按星排序，前四条有三条来自同一个 28562★ 的笔记仓库，
// 讲的是笔记内部的双链，跟外链毫无关系。**高星把语义对口的结果淹掉了。**
//
// 【所以按什么排】
// 用四个跟仓库名气无关的信号，全部可从搜索结果本身算出，不额外花配额：
//   1. 独立性     —— 所在仓库星数越低，越说明这个 Skill 是靠自己站住的，不是搭便车。
//   2. 专注度     —— 同一仓库在本次结果里贡献了多少条。一个仓库刷出几十条通常是
//                    批量生成或整包翻译的文档堆，不是有人认真写了几十个 Skill。
//   3. 描述具体度 —— 好的 SKILL.md 描述会写清**什么时候该用它**（触发条件、场景、
//                    反例），而不是一句「帮你做 X」。这是最能分辨用心与否的单一信号。
//   4. 新鲜度     —— 长期没动的多半已经烂掉。
//
// 这些是**启发式，不是判决**。脚本负责把候选排到你眼前，读 SKILL.md 仍然要你自己做。
//
// 用法：
//   node scripts/treasure.mjs "keyword" [--pages 5] [--lang zh] [--max-stars 2000] [--top 15] [--json]

import { searchAll } from './search.mjs';
import { readFileSync } from 'node:fs';
// `--help` 是成功，不是用法错误。放在最前面：本文件在任何参数解析之前
// 就会开工（起服务 / 读文件 / 校验必填），走到那里再判就已经晚了。
// 帮助文案直接取本文件头部注释，不另写一份——两份必然漂移。
if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
  const src = readFileSync(new URL(import.meta.url).pathname, 'utf8');
  const block = src.match(/\/\*\*([\s\S]*?)\*\//)
    ? src.match(/\/\*\*([\s\S]*?)\*\//)[1].split('\n').map((l) => l.replace(/^\s*\* ?/, ''))
    : src.split('\n').slice(1).filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, ''));
  console.log(block.join('\n').trim());
  process.exit(0);
}

const argv = process.argv.slice(2);
const q = argv.find((a) => !a.startsWith('--'));
const flags = {};
for (let i = 0; i < argv.length; i += 1) {
  if (!argv[i].startsWith('--')) continue;
  const n = argv[i + 1];
  if (n && !n.startsWith('--')) { flags[argv[i].slice(2)] = n; i += 1; } else flags[argv[i].slice(2)] = true;
}
if (!q) { process.stderr.write('用法：node scripts/treasure.mjs "keyword" [--pages N] [--lang xx] [--max-stars N] [--top N] [--json]\n'); process.exit(1); }

const maxStars = Number(flags['max-stars'] || 5000);
const top = Number(flags.top || 15);

// 描述里出现这些，说明作者写清了「什么时候用」——SKILL.md 的描述字段本来就是给
// 模型做路由判断用的，写得具体的人通常整个 Skill 都写得具体。
const SPECIFIC = /\buse (this )?when\b|\btrigger\b|\bfor example\b|\bdo not use\b|\bnot for\b|什么时候|使用场景|触发|适用于|不适用/i;

function score(s, repoCount) {
  const desc = (s.description || '').replace(/\s+/g, ' ').trim();
  const ageDays = s.updatedAt ? (Date.now() / 1000 - s.updatedAt) / 86400 : 9999;
  const parts = {
    // 星数越低越加分，但 0 星不额外奖励——0 星也可能是刚推上去还没人看过的空壳。
    independence: Math.max(0, 30 - Math.log10((s.stars || 0) + 10) * 6),
    focus: repoCount === 1 ? 25 : Math.max(0, 25 - (repoCount - 1) * 5),
    specificity: (SPECIFIC.test(desc) ? 20 : 0) + Math.min(15, Math.floor(desc.length / 40)),
    freshness: ageDays < 90 ? 15 : ageDays < 365 ? 8 : 0,
  };
  return { total: Math.round(Object.values(parts).reduce((a, b) => a + b, 0)), parts };
}

try {
  const r = await searchAll(q, { pages: Number(flags.pages || 5), limit: 100, language: flags.lang });

  const byRepo = new Map();
  for (const s of r.skills) {
    const repo = (s.githubUrl || '').split('/tree/')[0];
    byRepo.set(repo, (byRepo.get(repo) || 0) + 1);
  }

  // 同名同作者跨多语言 = 整包机翻的文档堆，只留一条，否则一个仓库能刷满整页。
  const seen = new Set();
  const ranked = r.skills
    .filter((s) => {
      const k = `${s.author}/${s.name}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    })
    .filter((s) => (s.stars ?? 0) <= maxStars)
    .map((s) => ({ ...s, repoCount: byRepo.get((s.githubUrl || '').split('/tree/')[0]) || 1 }))
    .map((s) => ({ ...s, ...score(s, s.repoCount) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, top);

  if (flags.json) { process.stdout.write(JSON.stringify({ query: q, scanned: r.skills.length, ranked }, null, 1) + '\n'); }
  else {
    process.stdout.write(`扫了 ${r.skills.length} 条，去重并滤掉 >${maxStars}★ 后取前 ${ranked.length}\n\n`);
    for (const s of ranked) {
      const age = s.updatedAt ? new Date(s.updatedAt * 1000).toISOString().slice(0, 10) : '?';
      process.stdout.write(`[${String(s.total).padStart(2)}] ${s.author}/${s.name}  ${s.stars}★  ${age}  [${s.contentLanguage}]  该仓库贡献 ${s.repoCount} 条\n`);
      process.stdout.write(`     ${(s.description || '').replace(/\s+/g, ' ').slice(0, 160)}\n`);
      process.stdout.write(`     ${s.githubUrl}\n\n`);
    }
    process.stdout.write('这是启发式排序，不是判决——真正决定要不要用，仍然得打开 SKILL.md 读一遍。\n');
    process.stdout.write(`今日剩余配额 ${r.quota?.dailyRemaining ?? '?'}/${r.quota?.dailyLimit ?? '?'}${r.anonymous ? '（匿名）' : ''}\n`);
  }
} catch (e) { process.stderr.write(`${e.message}\n`); process.exit(1); }
