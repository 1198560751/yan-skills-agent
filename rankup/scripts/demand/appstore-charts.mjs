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
 *   - **旧版这条路的边界（2026-08-23 实测）**：
 *     · 深度上限 100。旧版 limit=100 回 99 条，limit=200 回的还是那 99 条，
 *       limit>=250 直接 HTTP 400（body 是 gzip 二进制，别指望读到人话）。
 *       新版 v2 limit=100 可用、150/200 一律 500。**两条路都拿不到 Top 200。**
 *     · 没有任何弃用告示：Apple 自己的品类树接口
 *       `MZStoreServices.woa/ws/genres?id=36&cc=<cc>` 至今仍在为每个 genre
 *       下发 `rssUrls`（全部是 itunes.apple.com/<cc>/rss/... 这套旧版 URL），
 *       说明旧版 RSS 仍是 Apple 现行对外接口，不是残留。用 `--list-genres` 看。
 *     · genre id 枚举：同一个接口。App Store 根节点 id=36，一级品类 27 个，
 *       只有 Games(6014) 有 18 个二级子类（7001 Action / 7002 Adventure ...）。
 *     · 还有一条 `MZStoreServices.woa/ws/charts?cc=<cc>&g=<genre>&name=AppsByRevenue`，
 *       实测可用但**只回 resultIds 数组、不带任何字段**，且同样卡在 100 条，
 *       还要再走一次 Lookup 才有名字 —— 相比旧版 RSS 没有增益，脚本没有采用。
 *   - 无官方文档、无正式配额；批量跑多国家时脚本自动 sleep，别把并发拉满。
 *   - country 用两位小写 ISO 码（us / gb / de / jp / cn ...）。
 */

import { parseArgs, getJson, emit, die, sleep, initEvidence, recordSource } from './_lib.mjs';

const HELP = `
appstore-charts.mjs — Apple App Store 榜单（付费/免费/畅销，多国家）

用法:
  node appstore-charts.mjs [选项]

选项:
  --chart <c>      top-paid | top-free | top-grossing
                   | top-paid-ipad | top-free-ipad | top-grossing-ipad | top-free-mac
                   | new | new-free | new-paid（后三个是「最近上架」，忽略 --limit）
                   （默认 top-paid；只有前两个能走新版 v2 API）
  --country <c>    两位国家码，逗号分隔可多国（默认 us）
  --limit <n>      每个榜单取多少（默认 50）
                   **上限就是 100**：新版 v2 传 150/200 直接 500；
                   旧版传 200 仍只回 99 条，传 250 起直接 HTTP 400
  --genre <id>     品类 id（会自动切到旧版 RSS）。常用：
                   6007 Productivity / 6002 Utilities / 6000 Business /
                   6017 Education / 6015 Finance / 6012 Lifestyle / 6008 Photo&Video
  --api <a>        v2 | legacy（默认自动选）
  --list-genres    不取榜单，改为列出该国家全部 genre id（走 Apple 自己的品类树接口），
                   这是枚举 --genre 可用值的唯一权威做法
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
  // 2026-08-23 实测同样可用的旧版 feed（新版 v2 一个都没有）：
  'top-paid-ipad': 'toppaidipadapplications',
  'top-free-ipad': 'topfreeipadapplications',
  'top-grossing-ipad': 'topgrossingipadapplications',
  'top-free-mac': 'topfreemacapps',
  // new* 三个是「最近上架」，**忽略 limit**，固定回 ~100 条
  'new': 'newapplications',
  'new-free': 'newfreeapplications',
  'new-paid': 'newpaidapplications',
};

/** Apple 自己的品类树接口：id=36 是 App Store 根节点，返回全部 genre id + 每个 genre
 *  当前**有效**的 rssUrls / chartUrls 清单（这就是「genre id 怎么枚举」的官方答案）。 */
const GENRES_WS = 'https://itunes.apple.com/WebObjects/MZStoreServices.woa/ws/genres';

async function listGenres(country) {
  const d = await getJson(`${GENRES_WS}?id=36&cc=${country}`);
  const root = d['36'] ?? {};
  const rows = [];
  const walk = (node, depth, parent) => {
    for (const [id, g] of Object.entries(node.subgenres ?? {})) {
      rows.push({
        country,
        genreId: id,
        name: g.name,
        depth,
        parent,
        url: g.url ?? '',
        feeds: Object.keys(g.rssUrls ?? {}),
      });
      walk(g, depth + 1, g.name);
    }
  };
  walk(root, 1, root.name ?? 'App Store');
  return rows;
}

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
  // new* 三个 feed 忽略 URL 里的 limit，固定回 ~100 条，这里补一刀本地截断
  return (d.feed?.entry ?? []).slice(0, limit).map((e, i) => ({
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
  initEvidence('appstore-charts', { dir: args['evidence-dir'] ?? null });

  if (args['list-genres']) {
    const country = String(args.country ?? 'us').split(',')[0].trim().toLowerCase();
    const rows = await listGenres(country);
    emit(rows, args, [
      { key: 'genreId', label: 'id', max: 7 },
      { key: 'name', label: '品类', max: 30 },
      { key: 'parent', label: '父级', max: 20 },
      { key: 'depth', label: '层', max: 3 },
    ]);
    return;
  }

  const chart = String(args.chart ?? 'top-paid');
  if (!LEGACY_FEED[chart]) die(`--chart 只能是 ${Object.keys(LEGACY_FEED).join(' / ')}`);
  const countries = String(args.country ?? 'us').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const limit = Number(args.limit ?? 50);
  const genre = args.genre ? String(args.genre) : '';

  // 新版 v2 只有 top-free / top-paid 两个榜、且不支持 genre；其余一律走旧版
  const V2_CHARTS = new Set(['top-free', 'top-paid']);
  let api = args.api ? String(args.api) : (V2_CHARTS.has(chart) && !genre ? 'v2' : 'legacy');
  if (api === 'v2' && !V2_CHARTS.has(chart)) {
    die(`新版 RSS 只有 ${[...V2_CHARTS].join(' / ')}，--chart ${chart} 请用 --api legacy（脚本默认已自动切）`);
  }

  const rows = [];
  for (const c of countries) {
    try {
      const batch = api === 'legacy' ? await legacyChart(c, chart, limit, genre) : await v2Chart(c, chart, limit);
      // 逐国家/榜单记状态：失败国家的原始响应已由 _lib.getJson 落证据目录。
      recordSource({ source: `${c}/${chart}`, status: 'ok', rawCount: batch.length });
      rows.push(...batch);
    } catch (e) {
      recordSource({ source: `${c}/${chart}`, status: 'fetch_failed', rawCount: 0, error: String(e.message) });
      console.error(`${c}/${chart} 取数失败：${e.message}`);
    }
    if (countries.length > 1) await sleep(800);
  }
  if (!rows.length) die('一条都没取到——是采集失败不是「榜单为空」。检查 --country 是不是有效的两位国家码，或稍后重试（Apple 边缘偶发 504）；原始响应见证据目录。');

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
