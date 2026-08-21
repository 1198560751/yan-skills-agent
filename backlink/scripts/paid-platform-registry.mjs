#!/usr/bin/env node
// 维护一份**跨项目累积**的「谁在被人拿来买外链」登记表。
//
// 【为什么值得单独攒这张表】
// 一次调研只能看到几十个域名的反链，样本太小，判断不了「这个平台是常用的还是偶发的」。
// 但同一张表被不同项目、不同批次反复喂养之后，`sitesHit`（被多少个观察到的站用过）
// 就变成了一个有分量的信号：**经常出现在别人反链里的平台，才是真的在被使用的平台。**
// 这张表的价值随时间增长，因此它必须留在 Skill 里跨项目共用，而不是留在某个项目里。
//
// 【判据：同日爆发】
// 自动挂上去的噪声（域名报告页、短链、通投）是一次一条、日期散开的；
// 只有人主动去提交、或对方站点批量生成，才会在一天里冒出十几条。
// 所以「同一个来源域，同一天贡献 >= N 个 URL」就是主动投放的形状。
//
// 【最容易读错的一条：爆发条数 != 投放次数】
// 一次收录常常渲染成「每个界面语言一个页面」，还可能横跨同一运营方的多个域名。
// 所以「单日 148 条」往往是**投了 1 次 x 站点有一堆 locale**，不是投了很多次。
// 推论有两面：判断花了多少钱要按**投放次数**，不是按链接条数；
// 而挑渠道时**带 i18n 的平台会把一次成功放大几十倍**，同等条件下优先。
//
// 【这张表不等于购买清单】
// 记录 != 推荐。`tier` 必须如实标注，其中 `spam-net` 是**黑名单**：
// 那类域名（名字里直接带 seo/ranking/boost/fiverr 的批量站群）出现在自己的反链里
// 是被无关方通投，不是成绩，更不该去买。买不买始终是站主的决定，
// 本脚本只负责把证据摆清楚。
//
// 用法：
//   # 把某个项目的抓取产物并进登记表（可反复跑，按域名合并、不覆盖历史）
//   node scripts/paid-platform-registry.mjs merge \
//     --dirs /path/to/project/.rankup/data/semrush-backlinks \
//     --exclude-subject your-own-site.com \   # 排除自己，否则自家域名会被当成一个「平台」
//     [--min-burst 3]
//
//   # 看表
//   node scripts/paid-platform-registry.mjs list [--min-sites 2]

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = join(HERE, '..', 'data', 'paid-platforms.json');

const flags = {};
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list';
for (let i = 0; i < argv.length; i += 1) {
  const t = argv[i]; if (!t.startsWith('--')) continue;
  const n = argv[i + 1];
  if (n && !n.startsWith('--')) { flags[t.slice(2)] = n; i += 1; } else flags[t.slice(2)] = true;
}

const load = async () => {
  try { return JSON.parse(await readFile(REGISTRY, 'utf8')); }
  catch { return { updatedAt: null, note: '被观察到用于投放的平台登记表；sitesHit 越高越说明它真的在被使用', platforms: {} }; }
};

// Semrush 行的 hrefs 形如 [semrush来源报告, 真实来源URL, semrush目标报告, 真实目标URL]。
// 取第一个既不是 semrush 也不含目标域的。**不要**从标题列正则捞 URL，那列是标题文本。
const sourceUrl = (row, target) =>
  (row.hrefs || []).find((h) => !/semrush\.com/i.test(h) && !h.includes(target)) || null;

const firstSeen = (row) => {
  if (row.firstSeen) return row.firstSeen;
  const m = String(row.firstSeenRaw || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : null;
};

// 只按域名形态给一个**初判**。真实定价必须人去看 pricing 页再填 `price`，
// 脚本不猜价格——猜出来的价格会被当成事实引用。
const SPAM_NET = /(^|[.-])(seopxl|fiverr-seo|seo-growth|ranking-boost|authority-engine|backlink|link-?building)/i;

if (cmd === 'merge') {
  const dirs = String(flags.dirs || '').split(',').filter(Boolean);
  const subject = String(flags['exclude-subject'] || '').trim();
  const minBurst = Number(flags['min-burst'] || 3);
  if (!dirs.length) { process.stderr.write('--dirs 必填\n'); process.exit(1); }

  const reg = await load();
  let filesRead = 0, rowsRead = 0, rowsParsed = 0;

  for (const dir of dirs) {
    let names = [];
    try { names = await readdir(dir); } catch { continue; }
    for (const name of names.filter((n) => n.endsWith('.json') && !/manifest|channels|FAILED/.test(n))) {
      const doc = JSON.parse(await readFile(join(dir, name), 'utf8'));
      if (doc.status && doc.status !== 'ok') continue;
      const target = doc.domain || name.replace(/\.json$/, '');
      // 绝不把委托方自己的站写进这张跨项目共用的表。
      if (subject && target.includes(subject)) continue;
      filesRead += 1;

      const buckets = new Map(); // "host YYYY-MM-DD" -> Set(url)
      for (const row of doc.rows || []) {
        rowsRead += 1;
        const src = sourceUrl(row, target);
        const day = firstSeen(row);
        if (!src || !day) continue;
        let host; try { host = new URL(src).hostname.replace(/^www\./, ''); } catch { continue; }
        rowsParsed += 1;
        const k = `${host} ${day}`;
        if (!buckets.has(k)) buckets.set(k, new Set());
        buckets.get(k).add(src);
      }

      for (const [k, urls] of buckets) {
        if (urls.size < minBurst) continue;
        const [host, day] = k.split(' ');
        const e = reg.platforms[host] ||= {
          tier: SPAM_NET.test(host) ? 'spam-net' : 'unverified',
          price: null, priceCheckedAt: null, notes: null,
          observedSites: [], placements: [], totalUrls: 0,
        };
        if (!e.observedSites.includes(target)) e.observedSites.push(target);
        // 每个「站 + 日期」只记一次投放，这样 placements 数才接近**投放次数**而非链接条数。
        const pid = `${target}@${day}`;
        if (!e.placements.includes(pid)) { e.placements.push(pid); e.totalUrls += urls.size; }
      }
    }
  }

  // 形态断言：认出的行少于八成就报错。字段名对不上时每行都被静默跳过，
  // 结果是「一个平台都没发现」——那和真实的负面结论长得一模一样，而后者有分量。
  if (rowsRead > 0 && rowsParsed / rowsRead < 0.8) {
    process.stderr.write(`字段形态不匹配：${rowsRead} 行只认出 ${rowsParsed} 行，登记表未更新。\n`);
    process.exit(1);
  }

  reg.updatedAt = new Date().toISOString();
  await mkdir(dirname(REGISTRY), { recursive: true });
  await writeFile(REGISTRY, JSON.stringify(reg, null, 1) + '\n');
  process.stdout.write(JSON.stringify({
    filesRead, rowsRead, rowsParsed, platforms: Object.keys(reg.platforms).length, registry: REGISTRY,
  }, null, 2) + '\n');
} else {
  const reg = await load();
  const minSites = Number(flags['min-sites'] || 1);
  const rows = Object.entries(reg.platforms)
    .map(([host, e]) => ({ host, ...e, sitesHit: e.observedSites.length }))
    .filter((r) => r.sitesHit >= minSites)
    .sort((a, b) => b.sitesHit - a.sitesHit || b.totalUrls - a.totalUrls);
  process.stdout.write(`登记表更新于 ${reg.updatedAt || '(空)'}，共 ${Object.keys(reg.platforms).length} 个平台\n\n`);
  for (const r of rows) {
    process.stdout.write(
      `${String(r.sitesHit).padStart(2)} 站 / ${String(r.placements.length).padStart(3)} 次投放 / ${String(r.totalUrls).padStart(4)} 链  `
      + `[${r.tier}${r.price ? ' ' + r.price : ''}]  ${r.host}\n`
      + `      ← ${r.observedSites.join(', ')}\n`);
  }
}
