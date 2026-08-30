# Keyword Research（关键词研究）板块索引

host: sim.3ue.co，全 hash 路由。14 条路由已于 2026-08-30 双证人判决（种子词 image editor /
站点 canva.com），判决书见 `backlink/SKILL.md` 的 `<similarweb-round3-capabilities>` 块；
本地全文 `backlink/evidence/ground-truth/similarweb-round3-VERDICTS.md`（gitignore）。

## URL 模板三定律（进任何子页之前先记住）

1. **关键词上下文走 `?keyword=<URL编码词>` query 参数**；路径段 `/keyword/organic/search/`
   是固定字面量——把词改进路径段会被**静默重定向**到 `ai-brand-visibility/home`（hijack，exit 3）。
2. **站点路由冷深链必须带 `&key=<域>`**，否则落「输入查询以查看此报告」空态；
   落地后面板把 key 展开成 `pageFilter=[{"url":…}]`。
3. 面板会静默改写国家段（999→840）与时长段——**模板以落地 href 为准**。

## 已判决路由（关键词上下文，`?keyword=`）

| 路由 | hash 模板尾段 | 形状 | readyBranch | PAGE.md |
|---|---|---|---|---|
| 首页 | `organicsearch/websiteanalysis/home` | 搜索框+最近浏览+列表卡 | null（机器盲，exit 2） | ✅ `home/PAGE.md` |
| 概况 | `…/overview_2?keyword=<词>` | 指标卡+SERP环+趋势 | chart（21s） | ✅ `keyword-overview/PAGE.md` |
| SERP 市场参与者 | `…/keywordAnalysis_2?keyword=<词>` | 面积图+170 域 DIV 榜 | chart | ✅ `serp-players/PAGE.md` |
| 网页 | `…/trafficAnalysis_2?keyword=<词>` | tab+趋势+URL 榜 | chart | ✅ `keyword-pages/PAGE.md` |
| 搜索广告（关键词） | `…/ads?keyword=<词>` | **真 table** | table（120 格） | ✅ `keyword-ads/PAGE.md` |
| SERP 快照 | `…/serpsnapshot?keyword=<词>` | DOM 列表（无表无图） | null（机器盲） | ✅ `serp-snapshot/PAGE.md` |
| 关键词生成器 | `findkeywords/keyword-generator-tool/…?keyword=<词>` | 4 tab DIV 榜 | null（机器盲） | ✅ `keyword-generator/PAGE.md` |

## 已判决路由（站点上下文，`&key=<域>`）

| 路由 | hash 模板尾段 | 形状 | readyBranch | PAGE.md |
|---|---|---|---|---|
| SEO 概览 | `pageAnalysis/seo-overview/<域>/…&key=<域>` | 概要卡+venn | table（40 格） | ✅ `seo-overview/PAGE.md` |
| 网站关键词 | `pageAnalysis/website-keyword-v2/<域>/…&key=<域>` | **真 table** 13 列 | table（1,597 格） | ✅ `site-keywords/PAGE.md` |
| 关键词集群 | `websiteanalysis/topics/<域>/…&key=<域>` | **真 table** | table（120 格） | ✅ `keyword-clusters/PAGE.md` |
| 着陆页 | `pageAnalysis/landing-pages-v2/<域>/…&key=<域>` | URL 榜（DIV）+趋势 | chart | ✅ `landing-pages/PAGE.md` |
| 搜索竞争对手 | `websiteanalysis/website-competitors/<域>/…&key=<域>` | 散点+1,500 域榜 | chart | ✅ `search-competitors/PAGE.md` |
| 排名分配 | `pageAnalysis/ranking-distribution-v2/<域>/840/…&key=<域>` | 摘要条+DIV 榜 | null（机器盲） | ✅ `ranking-distribution/PAGE.md` |
| 网站搜索广告 | `pageAnalysis/website_ads/false/…&key=<域>` | **真 table** | table（180 格） | ✅ `website-ads/PAGE.md` |

## 板块级要点

- **5 条机器盲路由**（home / serp-snapshot / keyword-generator / ranking-distribution，
  加 referrals 板块的 outgoing）：cells=0 且 svgText=0，采集 exit 2。**exit 2 ≠ 空**，
  数据在 deepText 与像素里俱全——判读靠 deepText grep + AI 读图。
- 关键词列表页 monitorkeywords 只录了入口未采（列表管理页，只读价值低且怕误触「创建列表」）。
- 生成器的 Amazon/YouTube 词库：UI 下拉里存在，但冷深链 `searchEngine=amazon` 落错误页，
  合成事件点不开 portal 下拉——**未验证成功 ≠ 不存在**，下轮用真 CDP 点击或 UI 切换后抄 URL。
