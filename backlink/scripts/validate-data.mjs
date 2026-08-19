#!/usr/bin/env node
// 数据层的机械门禁。**每个 PR 都必须跑通这个**，CI 也跑它。
//
// 【为什么校验器比清单本身更重要】
// 这个 Skill 的价值主张是「这里的每一条都被真的验证过」。
// 一旦有人凭印象写进来一条「XX 站可以发、dofollow」，而没人能分辨它是观察还是猜测，
// 整张表就退化成又一份网上到处都是的复制粘贴清单——**那时它的价值不是变小，是归零**。
// 所以规则是：**宁可拒绝一条真的记录，也不放进一条没有证据的记录。**
//
// 校验分两层：
//   1. 结构：字段、枚举、日期格式、id 唯一且不复用；
//   2. 语义：证据与断言必须自洽——这一层才是真正在挡人。
//
// 用法：
//   node scripts/validate-data.mjs            # 校验全部
//   node scripts/validate-data.mjs --quiet    # 只在失败时输出

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');
const quiet = process.argv.includes('--quiet');

const errors = [];
const warns = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warns.push(`${where}: ${msg}`);

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const daysAgo = (s) => Math.floor((Date.now() - Date.parse(s)) / 86_400_000);

// —— free-channels ————————————————————————————————————————————————
const free = JSON.parse(await readFile(join(DATA, 'free-channels.json'), 'utf8'));
const KIND = new Set(['publish-platform', 'guestbook-engine', 'domain-report', 'comment-form', 'forum', 'wiki', 'paste', 'profile', 'directory']);
const STATUS = new Set(['live', 'changed', 'dead', 'rejected', 'unverified']);
const CAPTCHA = new Set(['none', 'passive', 'interactive', 'unknown']);
const METHOD = new Set(['browser-dom', 'anonymous-http', 'both']);
const seen = new Set();

for (const c of free.channels) {
  const at = `free-channels[${c.id || '?'}]`;
  if (!c.id || !/^[a-z0-9][a-z0-9-]*$/.test(c.id)) err(at, 'id 缺失或不是小写短横线 slug');
  if (seen.has(c.id)) err(at, 'id 重复。**死掉的记录要保留并标 status: dead，绝不回收 id 给别的渠道**——回收会让历史证据指向错误的对象');
  seen.add(c.id);
  if (!KIND.has(c.kind)) err(at, `kind 非法：${c.kind}`);
  if (!STATUS.has(c.status)) err(at, `status 非法：${c.status}`);
  if (!CAPTCHA.has(c.captcha)) err(at, `captcha 非法：${c.captcha}`);
  if (!isDate(c.lastVerifiedAt)) err(at, 'lastVerifiedAt 必须是 YYYY-MM-DD');
  if (!c.evidence || !METHOD.has(c.evidence.method)) err(at, 'evidence.method 必须是 browser-dom / anonymous-http / both');
  if (!c.evidence?.what || c.evidence.what.length < 10) err(at, 'evidence.what 太短：写清楚**看到了什么**，不是「测过了」');

  // —— 语义层：证据要撑得住断言 ————————————————————————————
  // 「没有 rel」= dofollow，是这张表里最有价值也最容易被凭空写上去的一条。
  if (Array.isArray(c.relObserved) && c.relObserved.some((r) => r === '')) {
    if (c.evidence?.method === 'anonymous-http' && c.browserRequired) {
      err(at, '声称观察到 dofollow（空 rel），但证据只来自匿名 HTTP 而该渠道又标了 browserRequired —— 两者不能同时成立');
    }
  }
  // 「没有锚点」「渠道已死」这类**否定结论**，纯 HTTP 撑不住：
  // 大量站点是客户端渲染，或对脚本请求直接回 403。
  if ((c.anchorRendered === false || c.status === 'dead') && c.evidence?.method === 'anonymous-http') {
    err(at, '否定结论（anchorRendered=false 或 status=dead）只有匿名 HTTP 证据。纯 HTTP 只能用来确认「存在什么」，不能确认「不存在」——必须有 browser-dom 证据');
  }
  if (c.status === 'rejected' && !c.rejectReason) err(at, 'status=rejected 必须写 rejectReason');
  if (c.captcha === 'interactive' && c.status === 'live') {
    err(at, 'captcha=interactive 不能标 live —— 需要人点选/解题的挑战一律记为拒绝，本 Skill 不绕验证码');
  }
  if (c.scope === 'engine' && c.indexable === true) {
    err(at, 'scope=engine 不得断言整体 indexable=true —— 引擎决定怎么发，宿主/板主决定 robots，必须逐个探测，用 "per-host"');
  }
  if (/noindex/i.test(String(c.robotsObserved || '')) && c.indexable === true) {
    err(at, 'robotsObserved 含 noindex 却标 indexable=true');
  }
  if (c.status === 'live' && isDate(c.lastVerifiedAt) && daysAgo(c.lastVerifiedAt) > 180) {
    warn(at, `标为 live 但已 ${daysAgo(c.lastVerifiedAt)} 天未复验。这一类渠道消失得比改版还快——复验或改成 unverified`);
  }
}

// —— index-submission ————————————————————————————————————————
// **这张表里没有一条外链。** 它记的是「把 URL 交给谁去收录」，
// 和 free-channels 是两类东西，混进去会直接毁掉那张表的语义
// （那边每条都要回答 anchorRendered / relObserved，这边这两个字段根本不存在）。
// 它之所以属于本 Skill：verify 阶段的 `indexed` 一直没说清是**谁的** index，
// 而不在 IndexNow 成员里的引擎，我们那套自动推送一条都没送到。
const idx = JSON.parse(await readFile(join(DATA, 'index-submission.json'), 'utf8'));
const idxSeen = new Set();
for (const e of idx.engines || []) {
  const at = `index-submission[${e.id || '?'}]`;
  if (!e.id || !/^[a-z0-9][a-z0-9-]*$/.test(e.id)) err(at, 'id 缺失或不是小写短横线 slug');
  if (idxSeen.has(e.id)) err(at, 'id 重复');
  idxSeen.add(e.id);
  if (!STATUS.has(e.status)) err(at, `status 非法：${e.status}`);
  if (!CAPTCHA.has(e.captcha)) err(at, `captcha 非法：${e.captcha}`);
  if (typeof e.independentIndex !== 'boolean') err(at, 'independentIndex 必填');
  if (typeof e.indexNowMember !== 'boolean') err(at, 'indexNowMember 必填');
  if (typeof e.batch !== 'boolean') err(at, 'batch 必填');
  if (!isDate(e.lastVerifiedAt)) err(at, 'lastVerifiedAt 必须是 YYYY-MM-DD');
  if (!e.evidence || !METHOD.has(e.evidence.method)) err(at, 'evidence.method 必须是 browser-dom / anonymous-http / both');
  if (!e.evidence?.what || e.evidence.what.length < 10) err(at, 'evidence.what 太短：写清楚确认文案说了什么、以及有几条是逐条复读过的');

  // —— 语义层 ————————————————————————————————————————————
  // 手工提交的**唯一**理由是「自动推送送不到」。两个都为真的记录是在凭空造工作量。
  if (e.indexNowMember === true && e.independentIndex === false) {
    err(at, 'indexNowMember=true 且 independentIndex=false —— 这种引擎既被自动推送覆盖、又没有自己的索引，手工提交毫无意义，不该收进这张表');
  }
  // GEO 论据最容易退化成传闻（「某某助手用的是它」）。只收运营方自己publish的说法 + 出处。
  if (e.aiGrounding && (e.aiGrounding.claimed !== true || !/^https?:\/\//.test(e.aiGrounding.source || ''))) {
    err(at, 'aiGrounding 必须带 claimed=true 和一个 http(s) 出处 —— 这一格是 GEO 论据，没有出处就是传闻');
  }
  if (e.captcha === 'interactive' && e.status === 'live') {
    err(at, 'captcha=interactive 不能标 live —— 需要人解题的挑战一律记为拒绝，本 Skill 不绕验证码');
  }
  if (e.status === 'rejected' && !e.rejectReason) err(at, 'status=rejected 必须写 rejectReason');
  if (e.batch === false && !e.howToSubmit) {
    warn(at, 'batch=false 却没写 howToSubmit —— 逐条提交的成本随页数线性增长，动手前必须能算出这个数');
  }
  if (e.status === 'live' && isDate(e.lastVerifiedAt) && daysAgo(e.lastVerifiedAt) > 180) {
    warn(at, `标为 live 但已 ${daysAgo(e.lastVerifiedAt)} 天未复验`);
  }
}

// —— paid-platforms ————————————————————————————————————————————
const paid = JSON.parse(await readFile(join(DATA, 'paid-platforms.json'), 'utf8'));
const TIER = new Set(['paid-listing', 'link-package', 'free-with-account', 'spam-net', 'not-a-platform', 'unverified']);
for (const [host, p] of Object.entries(paid.platforms || {})) {
  const at = `paid-platforms[${host}]`;
  if (!TIER.has(p.tier)) err(at, `tier 非法：${p.tier}`);
  // 价格是会被当成事实引用的东西，所以必须能说出「什么时候看的」。
  if (p.price && !isDate(p.priceCheckedAt || '')) err(at, '写了 price 就必须写 priceCheckedAt（YYYY-MM-DD）：价格会被直接引用，没有日期的价格是误导');
  if (p.tier !== 'unverified' && p.tier !== 'spam-net' && !p.notes) warn(at, '已分档但没写 notes，别人无法复核你凭什么这么分');
  if (!Array.isArray(p.observedSites) || !p.observedSites.length) err(at, 'observedSites 为空 —— 这张表的全部意义就是「被谁用过」，没有观察对象的条目不该存在');
}

if (!quiet || errors.length) {
  process.stdout.write(`free-channels: ${free.channels.length} 条（live ${free.channels.filter((c) => c.status === 'live').length}）\n`);
  process.stdout.write(`paid-platforms: ${Object.keys(paid.platforms || {}).length} 条\n`);
  process.stdout.write(`index-submission: ${(idx.engines || []).length} 条（收录提交口，**不是外链**）\n`);
  for (const w of warns) process.stdout.write(`  ⚠ ${w}\n`);
}
if (errors.length) {
  process.stderr.write(`\n校验失败，${errors.length} 个问题：\n`);
  for (const e of errors) process.stderr.write(`  ✗ ${e}\n`);
  process.exit(1);
}
if (!quiet) process.stdout.write(`\n✓ 校验通过${warns.length ? `（${warns.length} 条警告）` : ''}\n`);
