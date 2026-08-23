#!/usr/bin/env node
/**
 * 用途：拉 Apple App Store 榜单。**付费榜 = 已被验证的付费意愿**：能在付费榜上待着的
 *   App，说明这件事用户愿意直接掏钱。畅销榜（含内购）反映的是留存与变现能力。
 *   把付费榜里的品类翻译成「网页版 / 在线工具版」，往往就是一个能做 SEO 的工具站选题。
 *   同一榜单跨国家对比，还能看出哪个市场对某类需求更饥渴。
 *
 * 示例命令：
 *   node scripts/demand/appstore-charts.mjs --chart top-paid --country us --limit 50
 *   node scripts/demand/appstore-charts.mjs --chart top-grossing --country us --limit 25
 *   node scripts/demand/appstore-charts.mjs --chart top-paid --country us,gb,de,jp --limit 20 --json
 *   node scripts/demand/appstore-charts.mjs --chart top-paid --genre 6007 --limit 30   # 6007=Productivity
 *   node scripts/demand/appstore-charts.mjs --chart top-paid --country us --lookup --out apps.json
 *
 * 依赖：无 token、无登录态。纯公开 HTTP JSON。
 * 已验证日期：2026-08-23
 *
 * 已知坑：
 *   - Apple 有**两套** RSS：
 *     a) 新版 marketing tools：rss.marketingtools.apple.com/api/v2/{country}/apps/{chart}/{limit}/apps.json
 *        只支持 top-free 和 top-paid，**没有 top-grossing**（请求 top-grossing 直接 404），
 *        也不支持按 genre 过滤（多加一段 genre id 会 404）。
 *        limit 实测 10/25/50/100 可用，200 会 500。
 *     b) 旧版 iTunes RSS：itunes.apple.com/{country}/rss/{feed}/limit={n}/[genre={id}/]json
 *        支持 topfreeapplications / toppaidapplications / **topgrossingapplications**，
 *        且支持 genre 过滤。必须跟随 302 重定向（curl 要 -L），否则拿到空响应。
 *     本脚本自动选：top-grossing 或指定了 --genre 时走旧版，其余走新版；--api 可强制。
 *   - 新版偶发 504（Apple 边缘节点抽风），脚本内置重试。
 *   - 榜单**不含下载量、收入、价格**。价格/评分要额外走 iTunes Lookup API
 *     （https://itunes.apple.com/lookup?id=...&country=xx），用 --lookup 开启，
 *     Lookup 有软限流（约 20 次/分），脚本按 100 个 id 一批批量查并串行 sleep。
 *   - 无官方文档、无正式配额；批量跑多国家时脚本自动 sleep，别把并发拉满。
 *   - country 用两位小写 ISO 码（us / gb / de / jp / cn ...）。
 */

import { parseArgs, getJson, emit, die, sleep } from './_lib.mjs';

const HELP = `
appstore-charts.mjs — Apple App Store 榜单（付费/免费/畅销，多国家）

用法:
  node appstore-charts.mjs [选项]

选项:
  --chart <c>      top-paid | top-free | top-grossing（默认 top-paid）
  --country <c>    两位国家码，逗号分隔可多国（默认 us）
  --limit <n>      每个榜单取多少（默认 50；新版 API 支持 10/25/50/100）
  --genre <id>     品类 id（会自动切到旧版 RSS）。常用：
                   6007 Productivity / 6002 Utilities / 6000 Business /
                   6017 Education / 6015 Finance / 6012 Lifestyle / 6008 Photo&Video
  --api <a>        v2 | legacy（默认自动选）
  --lookup         额外查价格/评分/品类/更新时间（走 iTunes Lookup API）
  --json / --out <f>
  --help

产出字段:
  rank, country, chart, appId, name, artist, url, releaseDate, genres,
  --lookup 追加: price, currency, rating, ratingCount, primaryGenre, updated, contentAdvisory
`.trim();

const LEGACY_FEED = {
  'top-paid': 'toppaidapplications',
  'top-free': 'topfreeapplications',
  'top-grossing': 'topgrossingapplications',
};

async function v2Chart(country, chart, limit) {
  const url = `https://rss.marketingtools.apple.com/api/v2/${country}/apps/${chart}/${limit}/apps.json`;
  const d = await getJson(url);
  return (d.feed?.results ?? []).map((r, i) => ({
    rank: i + 1,
    country,
    chart,
    appId: String(r.id),
    name: r.name,
    artist: r.artistName,
    url: r.url,
    releaseDate: r.releaseDate ?? '',
    genres: (r.genres ?? []).map((g) => g.name ?? g).filter(Boolean),
  }));
}

async function legacyChart(country, chart, limit, genre) {
  const feed = LEGACY_FEED[chart];
  const g = genre ? `genre=${genre}/` : '';
  const url = `https://itunes.apple.com/${country}/rss/${feed}/limit=${limit}/${g}json`;
  const d = await getJson(url);
  return (d.feed?.entry ?? []).map((e, i) => ({
    rank: i + 1,
    country,
    chart,
    appId: e.id?.attributes?.['im:id'] ?? '',
    name: e['im:name']?.label ?? '',
    artist: e['im:artist']?.label ?? '',
    url: e.id?.label ?? '',
    releaseDate: e['im:releaseDate']?.attributes?.label ?? '',
    genres: e.category?.attributes?.label ? [e.category.attributes.label] : [],
    price: e['im:price']?.attributes?.amount ?? undefined,
    currency: e['im:price']?.attributes?.currency ?? undefined,
  }));
}

async function lookup(rows) {
  const byCountry = new Map();
  for (const r of rows) {
    if (!r.appId) continue;
    if (!byCountry.has(r.country)) byCountry.set(r.country, new Set());
    byCountry.get(r.country).add(r.appId);
  }
  const info = new Map();
  for (const [country, idset] of byCountry) {
    const ids = [...idset];
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const u = `https://itunes.apple.com/lookup?id=${batch.join(',')}&country=${country}&entity=software`;
      try {
        const d = await getJson(u);
        for (const a of d.results ?? []) {
          info.set(`${country}:${a.trackId}`, {
            price: a.price,
            currency: a.currency,
            rating: a.averageUserRating,
            ratingCount: a.userRatingCount,
            primaryGenre: a.primaryGenreName,
            updated: a.currentVersionReleaseDate,
            contentAdvisory: a.contentAdvisoryRating,
            sellerUrl: a.sellerUrl ?? '',
          });
        }
      } catch (e) { console.error(`lookup 失败（${country}）：${e.message}`); }
      await sleep(1500);
    }
  }
  for (const r of rows) Object.assign(r, info.get(`${r.country}:${r.appId}`) ?? {});
}

async function main() {
  const args = parseArgs();
  if (args.help || args.h) { console.log(HELP); return; }

  const chart = String(args.chart ?? 'top-paid');
  if (!LEGACY_FEED[chart]) die(`--chart 只能是 ${Object.keys(LEGACY_FEED).join(' / ')}`);
  const countries = String(args.country ?? 'us').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const limit = Number(args.limit ?? 50);
  const genre = args.genre ? String(args.genre) : '';

  let api = args.api ? String(args.api) : (chart === 'top-grossing' || genre ? 'legacy' : 'v2');
  if (api === 'v2' && chart === 'top-grossing') die('新版 RSS 没有 top-grossing，请用 --api legacy（脚本默认已自动切）');

  const rows = [];
  for (const c of countries) {
    try {
      rows.push(...(api === 'legacy' ? await legacyChart(c, chart, limit, genre) : await v2Chart(c, chart, limit)));
    } catch (e) {
      console.error(`${c}/${chart} 取数失败：${e.message}`);
    }
    if (countries.length > 1) await sleep(800);
  }
  if (!rows.length) die('一条都没取到 —— 检查 --country 是不是有效的两位国家码，或稍后重试（Apple 边缘偶发 504）');

  if (args.lookup) await lookup(rows);

  emit(rows, args, args.lookup
    ? [
      { key: 'rank', label: '#', max: 4 },
      { key: 'country', label: '国', max: 3 },
      { key: 'name', label: 'App', max: 34 },
      { key: 'price', label: '价', max: 6 },
      { key: 'rating', label: '评分', max: 5 },
      { key: 'ratingCount', label: '评分数', max: 9 },
      { key: 'primaryGenre', label: '品类', max: 16 },
      { key: 'artist', label: '开发者', max: 26 },
    ]
    : [
      { key: 'rank', label: '#', max: 4 },
      { key: 'country', label: '国', max: 3 },
      { key: 'name', label: 'App', max: 40 },
      { key: 'artist', label: '开发者', max: 32 },
      { key: 'url', label: 'URL', max: 54 },
    ]);
}

main().catch((e) => die(e.message));
