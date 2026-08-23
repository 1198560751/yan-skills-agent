#!/usr/bin/env node
/**
 * 用途：从 Google Play 商店页面抓 App 清单（含评分），看安卓侧哪些品类在被大量消费。
 *   和 appstore-charts.mjs 配合用：Apple 付费榜看「愿意掏钱」，Play 看「量在哪」。
 *   还能用 --search 搜某个关键词下已有哪些 App，反推这个需求的竞争密度。
 *
 * ⚠️ 先读这段再决定用不用：
 *   Google Play **没有任何公开 API**（Play Developer API 只能管自己的 App，看不了榜单）。
 *   本脚本是 HTML 解析，属于取数优先级里的「次选」。实测结论（2026-08-23）：
 *     ✅ 能拿到：appId、App 名、评分、图标、商店链接、页面上的出现顺序
 *     ❌ 拿不到：真实榜单名次、下载量、收入、榜单类型（免费榜/畅销榜分不开）
 *     ❌ https://play.google.com/store/apps/collection/topselling_free 这类老榜单 URL
 *        虽然回 200，但正文里**一条 App 链接都没有**（内容全靠前端 RPC 后填），解析不出东西。
 *   所以：**「Google Play 榜单」这件事按公开 HTTP 是取不到的**。能取到的是
 *   「首页/品类页/搜索结果页上出现的 App 及其评分」，顺序只是版面顺序，不是排行榜名次。
 *   要真榜单名次，替代方案见文末。
 *
 * 示例命令：
 *   node scripts/demand/gplay-charts.mjs --category APPLICATION --country US --limit 30
 *   node scripts/demand/gplay-charts.mjs --category PRODUCTIVITY --country JP --lang ja
 *   node scripts/demand/gplay-charts.mjs --search "invoice generator" --limit 25 --json
 *   node scripts/demand/gplay-charts.mjs --search "habit tracker" --out gplay.jsonl
 *
 * 依赖：无 token、无登录态。需要一个浏览器 UA（脚本已内置），默认 UA 会拿到简化页面。
 * 已验证日期：2026-08-23
 *
 * 已知坑：
 *   - class 名（Si6A0c / TjRVLb 之类）Google 随时会改。脚本用「a[href=details?id=] 到 </a>
 *     之间的纯文本」这种结构化方式解析，比钉死 class 稳，但仍然可能一夜失效。
 *     解析不出结果时脚本会明确报错而不是返回空数组。
 *   - 同一个 App 在一页里会出现多次（不同 cluster），脚本按 appId 去重，保留首次出现位置。
 *   - `position` 字段是**页面出现顺序，不是排行榜名次**，不要当 rank 用。
 *   - 品类页只回一屏（约 100~150 个 App），再往下要滚动触发 RPC，纯 HTTP 拿不到。
 *   - 评分是 4.2 这种一位小数；没评分的新 App 该字段为 null。
 *   - --country / --lang 只影响榜单地区化，Google 也会看出口 IP，跨区结果未必准。
 *
 * 要真名次怎么办（2026-08-23 复测后的结论）：
 *   ✅ **用 `--ranking`**：AppBrain 的公开榜单页，每页 100 名，带名次涨跌 +
 *      安装量区间 + 近 30 天安装量估算，分国家分品类，纯 HTTP 无登录。
 *      代价：第三方估算（名次是抓来的，安装量是推算的）；连续请求约 7 次后 429。
 *   ❌ Google 侧全部走不通，逐条实测过，别再试：
 *      · `/store/apps/top`（桌面 UA）302 到 `/store/apps`；换 Android UA 回 1.8MB，
 *        但里面 55 个包名是首页推荐位，不是榜单。
 *      · `/store/apps/collection/topselling_free` 回 200/926KB，正文 0 条 `details?id=`。
 *      · 品类页里那个带「Top free / Top grossing / Top paid」三个 tab 的
 *        `apps_mini_top_charts` cluster，在初始 HTML 的 AF_initDataCallback 里
 *        **只有一个 630 字节的空壳 + 一个 base64 token**，没有任何 App。
 *        用 OpenCLI 开真浏览器、按 ads-transparency.mjs 那套注入 XHR/fetch 钩子后
 *        点这三个 tab、滚到可视区，**既不触发任何 batchexecute，DOM 也始终是空的**
 *        （`section` 里 0 条 App 链接）。这个 cluster 在桌面 web 上就是死的。
 *      · 同一套钩子在做站内 SPA 跳转（换品类）时**能**截到
 *        `rpcids=w3QCWb` / `w37aie`，但那是品类页正文的分页 RPC，不是榜单。
 *   1) Apple 那侧用 appstore-charts.mjs（有官方 RSS，名次可信），把品类结论迁移过来推断；
 *   2) 第三方榜单站（Sensor Tower / data.ai / AppBrain 等）多数要账号，走 OpenCLI 登录态；
 *   3) 单个 App 的详情（安装量区间、更新日志、评论）可以走 --detail <appId>，
 *      详情页 HTML 里有安装量区间字符串，见下。
 */

import { parseArgs, getText, emit, die, sleep } from './_lib.mjs';

const HELP = `
gplay-charts.mjs — Google Play 商店页 App 清单（HTML 解析，非真榜单）

用法:
  node gplay-charts.mjs [--category <C> | --search <q> | --detail <appId>] [选项]

选项:
  --category <c>   品类页，如 APPLICATION / PRODUCTIVITY / BUSINESS / TOOLS / FINANCE
                   / EDUCATION / PHOTOGRAPHY / GAME（默认 APPLICATION）
  --search <q>     改为搜索结果页（看某个需求下已有多少竞品）
  --detail <id>    改为抓单个 App 详情（安装量区间/评分/评论数/更新时间）
  --country <c>    两位国家码（默认 US）
  --lang <l>       界面语言（默认 en）
  --limit <n>      最多返回多少（默认 50）
  --min-rating <r> 只保留评分 >= r
  --ranking <c>    **改为拉真排行榜名次**（走 AppBrain 的公开榜单页，非 Google 官方）
                   c = top_free | top_paid | top_grossing | top_new_free | top_new_paid
  --rank-category  --ranking 的品类，小写，如 all / productivity / game / tools
                   （默认 all）
  --json / --out <f>
  --help

产出字段:
  position(页面出现顺序，非名次), appId, name, rating, url, iconUrl
  --detail 追加: installs, ratingCount, updated, developer, description
`.trim();

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 把一段 HTML 拆成「标签之间的文本片段」数组（Play 的卡片文本都在标签之间） */
const strip = (s) => s.replace(/<[^>]+>/g, '\u0001')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
  .split('\u0001').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** 从任意 Play 列表页 HTML 里抠出 App 卡片 */
function parseCards(html, limit, minRating) {
  const re = /<a[^>]+href="\/store\/apps\/details\?id=([A-Za-z0-9._]+)"[\s\S]{0,4000}?<\/a>/g;
  const seen = new Map();
  let m;
  while ((m = re.exec(html)) !== null) {
    const appId = m[1];
    if (seen.has(appId)) continue;
    const chunk = m[0];
    const icon = (chunk.match(/<img[^>]+src="(https:\/\/play-lh[^"]+)"/) || [])[1] ?? '';
    const texts = strip(chunk);
    // 卡片纯文本形如 ["Snapchat", "4.2", "star"]；名字是第一段非数字文本
    const name = texts.find((t) => !/^[\d.]+$/.test(t) && t.toLowerCase() !== 'star') ?? '';
    const ratingTxt = texts.find((t) => /^\d\.\d$/.test(t));
    const rating = ratingTxt ? Number(ratingTxt) : null;
    if (!name) continue;
    if (minRating != null && (rating == null || rating < minRating)) continue;
    seen.set(appId, {
      position: seen.size + 1,
      appId,
      name,
      rating,
      url: `https://play.google.com/store/apps/details?id=${appId}`,
      iconUrl: icon,
    });
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

function parseDetail(html, appId) {
  const texts = strip(html);
  const installs = texts.find((t) => /^[\d.,]+[KMB]?\+?$/.test(t) && /\+/.test(t)) ?? '';
  const ratingM = html.match(/aria-label="Rated ([\d.]+) stars out of five stars"/);
  const titleM = html.match(/itemprop="name"[^>]*>([^<]+)</) || html.match(/property="og:title" content="([^"]*)"/);
  const devM = html.match(/href="\/store\/apps\/dev(?:eloper)?\?id=[^"]*"[^>]*>([\s\S]{0,200}?)<\/a>/);
  const descM = html.match(/property="og:description" content="([^"]*)"/) || html.match(/<meta name="description" content="([^"]*)"/);
  return [{
    appId,
    url: `https://play.google.com/store/apps/details?id=${appId}`,
    name: titleM ? titleM[1].replace(/\s*[-–]\s*Apps on Google Play\s*$/i, '').trim() : '',
    rating: ratingM ? Number(ratingM[1]) : null,
    installs,
    developer: devM ? strip(devM[1])[0] ?? '' : '',
    description: descM ? descM[1].replace(/\s+/g, ' ').slice(0, 400) : '',
  }];
}

/* ---------- --ranking：AppBrain 的 Google Play 排行榜（真名次） ----------
 * Google 自己不给榜单名次（见文件头），但 AppBrain 每天抓一份并按名次公开成静态 HTML。
 * URL 语法：/stats/google-play-rankings/<chart>/<category>/<countryLower>
 * 2026-08-23 实测：每页固定 100 名，带名次、名次涨跌、包名、开发者、
 * 安装量区间、近 30 天安装量估算。**这是第三方估算，不是 Google 官方数字**，
 * 名次可信度高（就是抓 Play 榜单），安装量是模型推算，只能当数量级看。
 */
const RANK_CHARTS = ['top_free', 'top_paid', 'top_grossing', 'top_new_free', 'top_new_paid'];

function parseRanking(html, limit) {
  const ent = (x) => String(x)
    .replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x3D;/g, '=');
  const txt = (x) => ent(x.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  const out = [];
  for (const r of html.split('<tr>').slice(1)) {
    const rank = (r.match(/ranking-rank"[^>]*>\s*(\d+)/) || [])[1];
    if (!rank) continue;
    const link = r.match(/ranking-app-cell"[\s\S]*?<a href="\/app\/[^/"]+\/([^"/]+)"[^>]*>([^<]*)</);
    if (!link) continue;
    // 列顺序（2026-08-23）：rank | 涨跌 | icon | App+by开发者 | [品类] | 评分 | 安装量 | 近30天
    // **品类列只在 --rank-category=all 的总榜上出现**，分品类页少一列，
    // 所以一律从**末尾**倒着数，不要按下标正着数。
    const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => txt(m[1]));
    const at = (i) => cells[cells.length - i] ?? '';
    const tail = [cells.length >= 8 ? at(4) : '', at(3), at(2), at(1)];
    out.push({
      rank: Number(rank),
      change: (r.match(/ranking-(up|down|equal|new)/) || [])[1] ?? '',
      appId: link[1],
      name: ent(link[2]).trim(),
      developer: txt((r.match(/ranking-app-cell-creator[\s\S]*?<a href="\/dev\/[^"]*"[^>]*>([^<]*)</) || [])[1] ?? ''),
      category: tail[0] ?? '',
      rating: tail[1] ?? '',
      installs: tail[2] ?? '',
      recentInstalls: tail[3] ?? '',
      url: `https://play.google.com/store/apps/details?id=${link[1]}`,
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function main() {
  const args = parseArgs();
  if (args.help || args.h) { console.log(HELP); return; }

  const country = String(args.country ?? 'US').toUpperCase();
  const lang = String(args.lang ?? 'en');
  const limit = Number(args.limit ?? 50);
  const minRating = args['min-rating'] != null ? Number(args['min-rating']) : null;
  const opts = { ua: BROWSER_UA, headers: { accept: 'text/html' }, timeout: 40000 };

  let rows, cols;
  if (args.ranking) {
    const chart = String(args.ranking === true ? 'top_free' : args.ranking);
    if (!RANK_CHARTS.includes(chart)) die(`--ranking 只能是 ${RANK_CHARTS.join(' / ')}`);
    const cat = String(args['rank-category'] ?? 'all').toLowerCase();
    const url = `https://www.appbrain.com/stats/google-play-rankings/${chart}/${cat}/${country.toLowerCase()}`;
    const html = await getText(url, opts);
    rows = parseRanking(html, limit).map((r) => ({ ...r, chart, rankCategory: cat, country }));
    if (!rows.length) {
      die([
        `从 ${url} 一条名次都没解析出来。`,
        '常见原因：(a) 连着请求太快被限流 —— 实测约 7 次连续请求后开始回 HTTP 429，',
        '    等几十秒再跑，或用 --sleep 拉开；',
        '(b) --rank-category 名字不对（用 all / productivity / game / tools ... 小写）；',
        '(c) AppBrain 改了表格结构（本脚本是 HTML 解析）。',
      ].join('\n'));
    }
    cols = [
      { key: 'rank', label: '名次', max: 5 },
      { key: 'change', label: '涨跌', max: 5 },
      { key: 'name', label: 'App', max: 34 },
      { key: 'rating', label: '评分', max: 4 },
      { key: 'installs', label: '总安装', max: 8 },
      { key: 'recentInstalls', label: '近30天', max: 8 },
      { key: 'appId', label: '包名', max: 34 },
    ];
  } else if (args.detail) {
    const id = String(args.detail);
    const html = await getText(
      `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=${lang}&gl=${country}`, opts);
    rows = parseDetail(html, id);
    cols = [
      { key: 'name', label: 'App', max: 34 },
      { key: 'installs', label: '安装量', max: 12 },
      { key: 'rating', label: '评分', max: 5 },
      { key: 'developer', label: '开发者', max: 26 },
      { key: 'description', label: '描述', max: 70 },
    ];
  } else {
    const url = args.search
      ? `https://play.google.com/store/search?q=${encodeURIComponent(String(args.search))}&c=apps&hl=${lang}&gl=${country}`
      : `https://play.google.com/store/apps/category/${encodeURIComponent(String(args.category ?? 'APPLICATION'))}?hl=${lang}&gl=${country}`;
    const html = await getText(url, opts);
    rows = parseCards(html, limit, minRating);
    if (!rows.length) {
      die([
        `从 ${url} 一条 App 都没解析出来。`,
        '两种可能：(a) Google 又改了页面结构（本脚本是 HTML 解析，会失效）；',
        '(b) 这个 URL 的内容是前端 RPC 后填的，静态 HTML 里本来就没有 App',
        '（老的 /store/apps/collection/topselling_* 榜单 URL 就属于这种，回 200 但正文没数据）。',
        '退路：改用 --search，或走 appstore-charts.mjs 从 Apple 侧看同一品类。',
      ].join('\n'));
    }
    cols = [
      { key: 'position', label: '位', max: 4 },
      { key: 'rating', label: '评分', max: 5 },
      { key: 'name', label: 'App', max: 44 },
      { key: 'appId', label: '包名', max: 40 },
    ];
    await sleep(0);
  }

  emit(rows, args, cols);
}

main().catch((e) => die(e.message));
