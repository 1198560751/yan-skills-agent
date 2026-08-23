# 需求挖掘数据源：源 → 脚本路由表

用户说「**找几个关键词**」「**挖点需求**」「**最近有什么能做的**」「**找个新方向/新词的工具站**」时，
本文件是入口。它只回答一件事：**要这个信号，跑哪条命令。**

- 「往哪儿看、怎么判断这个需求值不值得做」在
  [`experiences/demand-discovery.md`](experiences/demand-discovery.md)——那是裁定集。
- 「拿到候选之后怎么验证词」在 [`seo-webcafe.md`](seo-webcafe.md) 与 [`trends.md`](trends.md)。

全部脚本在 `<rankup-skill-dir>/scripts/demand/`。Node 22、零第三方依赖、
统一支持 `--help` / `--json` / `--out <file>`。**所有条目的取数路径都在 2026-08-23 逐个发过真请求验证**，
不是照文档抄的。

---

## 一、先决定：你现在缺的是哪一类信号

| 你想知道 | 去第几节 |
|---|---|
| 谁已经收到钱了 | [二](#二谁已经收到钱了) |
| 谁在用哪个支付网关（长尾反查） | [二·五](#二五长尾支付网关反查) |
| 谁在花钱买流量 | [三](#三谁在花钱买流量) |
| 谁做了但没做好（差评） | [四](#四谁做了但没做好差评矿) |
| 谁在为这件事付外包费 | [五](#五谁在为这件事付外包费) |
| 正在冒出来的新产品 | [六](#六正在冒出来的新产品) |
| 持续涌现新词的平台 | [七](#七持续涌现新词的平台) |
| 用户的原话（许愿与吐槽） | [八](#八用户的原话) |
| 竞品正在往哪儿下注 | [九](#九竞品正在往哪儿下注) |
| 我连方向都没有，只有一个词根 | [九·五](#九五从词根出发) |
| 拿到候选之后怎么验证 | [十](#十候选验证链路) |

**一条通则**：任何一节拿到的候选，最终都要汇成一份**域名清单**或**关键词清单**，
再走第十节验证。别在没验证之前就开工。

```bash
# 多个榜单合流成去重域名清单的标准姿势
node scripts/demand/boards.mjs traffic-cv --json \
  | jq -r '.[].domain' | sort -u > /tmp/candidates.txt
```

---

## 二、谁已经收到钱了

**最硬的信号。钱已经流过去了，不需要你再猜需求成不成立。**

| 源 | 拿什么 | 取数方式 | 需登录 | 脚本 |
|---|---|---|---|---|
| Stripe 引荐流量榜 | 域名、送往 Stripe 的月引荐量、名次、份额、环比、是否新进榜，**31 个月历史** | 公开 GET ×3，**不计配额** | 否 | `scripts/demand/stripe-referring.mjs`（含派生指标）；原始端点在 `scripts/seo-webcafe.mjs referring` / `referringMonth --m YYYYMM` / `referringSite --domain` |
| traffic.cv 流量榜/收入榜 | 名次、域名、月访问量与环比、Stripe 结账量、**域名注册时间**、TopKeywords | 纯 HTTP（解析 Next.js RSC flight） | 否 | `scripts/demand/boards.mjs traffic-cv` |
| TrustMRR | MRR、30 天营收、总营收、增速、每访客收入（Stripe 实连） | 纯 HTTP，首页一次带回 5 个榜各 100 条 | 否 | `scripts/demand/boards.mjs trustmrr` |
| Apple App Store 榜单 | 名次、App 名、开发者；`--lookup` 补价格/评分/评分数/品类 | 公开 RSS JSON | 否 | `scripts/demand/appstore-charts.mjs` |
| Google Play | 包名、App 名、评分、安装量区间 | 公开 HTML（脆） | 否 | `scripts/demand/gplay-charts.mjs` |

### 派生指标：到达付费页比例

```
到达付费页比例 = 支付页引荐流量 ÷ 网站总访问量
月营收估算   ≈ 月访问量 × 到达付费页比例 × 支付成功率 × 客单价
```

`stripe-referring.mjs --enrich` 已内建这两个计算（支付成功率与客单价作为参数）。

**【实测】一个必须知道的代数事实：月营收公式里的总访问量会自己约掉。**

```
月访问 × (Stripe引荐 ÷ 月访问) × 支付率 × 客单价  ≡  Stripe引荐 × 支付率 × 客单价
```

所以**补总访问量不会让营收估算更准一分**。总访问量真正的价值是让你算出
**到达付费页比例这个独立的诊断指标**——它衡量的是流量质量，不是收入：

| 实测样本 | 到达付费页比例 | 读法 |
|---|---|---|
| 某头部 AI 视频站 | 8.60% | 流量筛得准，进来的人就是要买的人 |
| 某巨头支付品牌自身 | 0.27% | 靠体量硬砸，转化极低 |

**边界必须一起记**：能进引荐榜的站本身是优等生，它的比例不是行业平均值；估算一律取保守值。

### 已验证的坑

| 坑 | 实测 |
|---|---|
| **Apple 新版 RSS 没有畅销榜** | `top-grossing` 直接 404，也不支持 genre 段；`limit=200` 返回 HTTP 500。要 grossing/分类得走旧版 `itunes.apple.com/rss`，且**必须跟随 302** |
| **Google Play 拿不到真榜单** | 老榜单 URL 回 200/925KB，正文里一条 `details?id=` 都没有，全靠前端 RPC。品类页/搜索页能解析，但 `position` 只是**版面顺序不是名次**，脚本已标注，别当名次用 |
| **Toolify 的「收入榜」不给收入** | 真实 URL 是 `/Best-AI-Tools-revenue`，实为「检测到支付平台的 AI 工具」按月访问量排序。有价值的字段是它标出的支付平台 |
| **TrustMRR 榜单里 `website` 恒为 null** | 域名要再打 `/startup/<slug>` 才有，故 `--resolve-domains` 默认关 |

---

## 二·五、长尾支付网关反查

**不要只盯最大的那家网关。** 专精小微商户的网关，用户多是个人开发者或极小团队——
**规模小意味着可复刻**。反查它们的引荐来源，等于拿到一份「我明天就能做一个」的清单。

已覆盖 11 个网关（含国内无执照场景常用的两家）。两条路互补：

| 路径 | 拿什么 | 取数方式 | 需登录 | 命令 |
|---|---|---|---|---|
| SERP 指纹反查 | 引用某网关结账域名/徽标的候选站 + 证据 URL | 走 seo.web.cafe 的 Google 通道，**1 次配额/查询** | 否 | `scripts/demand/payment-referrers.mjs serp <网关>` |
| Similarweb 引荐流量 | 给某网关送流量的**域名清单** | 面板 + OpenCLI 驱动已登录 Chrome，有配额 | **是**（面板登录态） | `scripts/demand/payment-referrers.mjs similarweb <网关>` |

实测规模：Similarweb 一条查询就能列出某中型网关 90 个引荐域名、另一家 29 个。

### 已验证的坑

- **Similarweb 的份额没能可靠配对**（域名数与百分比数不等，如 29 个域名对 37 个百分比）。
  脚本在数量不等时**直接放弃配对并打出说明**——错位的份额比没有份额更危险。
- Brave 搜索通道对这类指纹查询基本无效；`opencli google` 报 `Navigation rejected`。
  能用的只有 seo.web.cafe 的 Google 通道那一条。

---

## 三、谁在花钱买流量

**持续投放 = ROI > 1。** 这是仅次于「已经收到钱」的硬信号，而且它还告诉你对方的落地页长什么样。

| 源 | 拿什么 | 取数方式 | 需登录 | 脚本 |
|---|---|---|---|---|
| Google 广告透明度中心 | 广告主、在投广告数区间、相关网域、素材、落地域名、**首末投放日 + 已跑天数** | 内部 JSON RPC，**纯 curl 可打，无 token 无 cookie** | 否 | `scripts/demand/ads-transparency.mjs advertisers <词>` / `creatives --domain <域名>` |

**核心列是 `daysRunning`**：一条素材跑了一千多天，意味着这条广告的 ROI 被验证了一千多天。
拿到落地域名后回到第十节验证它的词。

已知边界：单次上限 100 条；**翻页 token 不可复用**。

> 国内投放侧（内容平台的素材库、短视频投放平台）没有可自动化的公开入口，属人工动作。

---

## 四、谁做了但没做好（差评矿）

**差评是唯一由用户掏钱之后给出的反馈**，可信度远高于任何免费调研。
功能列表告诉你他们做了什么，差评告诉你他们做了但没做好的——后者才是机会。

| 源 | 拿什么 | 取数方式 | 需登录 | 脚本 |
|---|---|---|---|---|
| Apple App Store 评论 | 星级/标题/正文全文/日期/版本 | 公开 RSS JSON（每页 50、最多 10 页） | 否 | `scripts/demand/reviews-mine.mjs --source appstore` |
| Google Play 评论 | 星级/正文/日期/点赞数，**服务端可按星级筛** | 公开 batchexecute RPC | 否 | `scripts/demand/reviews-mine.mjs --source gplay` |
| Trustpilot | TrustScore、星级分布、1-2 星评论全文 | 页面 `__NEXT_DATA__` | 否，但**必须真实浏览器**（curl 被 WAF 403） | `scripts/demand/reviews-mine.mjs --source trustpilot` |
| G2 | 10 分制均分、结构化评论、公司规模/职位 | 页面 ld+json | 否，但**必须真实浏览器**（首屏挑战要等 30–60 秒） | `scripts/demand/reviews-mine.mjs --source g2` |
| Capterra | 均分、评论的 **Pros/Cons 分段** | ld+json + DOM 卡片 | 否，但**必须真实浏览器** | `scripts/demand/reviews-mine.mjs --source capterra` |
| Chrome Web Store | 扩展**用户数 + 精确评分 + 评分人数 + 分类**，以及最近 10 条评论原文/星级 | 公开 HTML 内联 JSON（`AF_initDataCallback`），**不用 token 不用浏览器** | 否 | `scripts/demand/chrome-ext-gap.mjs` |
| chrome-stats.com | 趋势榜、新增榜、**已下架榜**（`/chrome/obsolete`） | OpenCLI 真浏览器（CF 挡纯 HTTP），免费仅第 1 页 25 条 | 否，但要真浏览器 | `scripts/demand/chrome-stats.mjs` |

### 扩展商店的「已验证市场 + 差执行」筛选

```bash
# 用户数 100 万以上、评分 4.1 以下，并拉出 3 星及以下的差评原文
node scripts/demand/chrome-ext-gap.mjs \
  --category productivity/workflow --min-users 1000000 --max-rating 4.1 \
  --reviews 6 --max-stars 3
```

这条命令直接落地经验层 4.4 节那个筛选形状：**用户量大 + 评分低 = Validated Market + Bad Execution**。

### 差评里的高价值关键句（当过滤词用）

```
Doesn't work with…   Please add…      Too expensive     Slow
Stopped working      No longer works  Privacy           Need bulk…
Wish it could…       I love this extension, but…   ← 最值钱的一句
```

### 产品下线 = 强时效刚需

`chrome-stats.mjs --list obsolete` 给已下架扩展。**折扣要记住**：默认不按用户数排序，
前排全是几十用户的小扩展，且只有 25 条——**大产品下架不保证当天捞得到**，
要覆盖得自己维护一份关注 ID 名单定期探活。

### 已验证的坑

- **Chrome Web Store 深翻页做不到**：分类页 32 条 / 搜索页 10 条 / 评论页 10 条就到顶。
  扩样本靠多跑分类和搜索词，不是靠翻页。
- Trustpilot / G2 / Capterra 三家 **curl 一律 403 但都不需要登录**——
  这是「必须真实浏览器」和「必须登录态」两件事的分界线，别混为一谈。
- Capterra 的星级过滤**没有 URL 参数**，只能点按钮。

---

## 五、谁在为这件事付外包费

**需求具体到能标价，是最不容易自欺的一类证据。**

| 源 | 拿什么 | 取数方式 | 需登录 | 脚本 |
|---|---|---|---|---|
| Freelancer.com | 项目标题/描述/**预算区间/币种/竞标数/平均报价**/技能标签 | **公开 REST API，无 token**（本类最好用） | 否 | `scripts/demand/freelance-demand.mjs --source freelancer` |
| Fiverr | 服务标题/起步价/评分/评价数（成交量代理） | DOM `[data-gig-id]` | 否，但**必须真实浏览器** | `--source fiverr` |
| Upwork | 职位标题/计价方式/预算/描述 | DOM `[data-test=JobTile]` | 否，但**必须真实浏览器** | `--source upwork` |
| 闲鱼 | 商品标题/价格/**「N 人想要」**（供需比） | DOM `a[href*=item?id=]` | **是，必须登录态** | `--source xianyu` |
| 淘宝 | —— | 未实测；反爬更重、强制登录 + 滑块 | 是 | 无，建议用闲鱼替代 |

**闲鱼有一个必须知道的失败形态**：未登录时搜索**恒返回「没有找到」并静默降级成「猜你喜欢」**——
页面看起来完全正常，但你拿到的是推荐流不是搜索结果。这正是「沙箱浏览器拿到看似正常
但内容不同的结果」那条规则的实例。

判据：**「想要」数多、商品数少 = 供不应求**；有人卖 + 有成交 = 有人真掏钱。
服务类需求（「XX 代做 5 元一张」）直接对应工具站机会。

---

## 六、正在冒出来的新产品

**中等强度信号：曝光 ≠ 留存。** 这一节拿到的域名必须过第十节验证才算数。

| 源 | 拿什么 | 取数方式 | 需登录 | 脚本 |
|---|---|---|---|---|
| Product Hunt 每日榜 | 名次、票数、评论数、上线日期、**产品真实外链域名** | OpenCLI 真实 Chrome 读 Apollo 缓存；GraphQL v2 需 token；Atom feed 兜底 | 否，但**必须能过 CF 的真实浏览器** | `scripts/demand/boards.mjs producthunt` |
| Toolify `/new` + 榜单 | 工具名、官网、月访问量、分类、**支付平台** | OpenCLI 真实 Chrome 读 `window.__NUXT__` | 否，但要真实浏览器 | `scripts/demand/boards.mjs toolify` |
| Hacker News | Show HN 新产品、Ask HN 痛点原话、分数/评论数/评论全文 | 公开 JSON API（Algolia） | 否 | `scripts/demand/hn-signals.mjs` |
| GitHub Trending | **期内新增 star（升温速度）**、仓库/简介/语言；`--issues` 挖产品化机会 | 公开 HTML（`/trending`） | 否 | `scripts/demand/github-trending.mjs` |
| GitHub Search | 累计 star、创建/push 时间、topics、open issue 正文 | 公开 JSON API | 否（给 token 配额高 80 倍） | `scripts/demand/github-trending.mjs --source search` |
| GitHub SKILL.md 反查 | 别人沉淀的 skill 名 + description（= 反复出现的真实需求） | JSON API，**code search 必须 token**；无 token 退到 repo search | code search 需 token | `scripts/demand/github-skill-search.mjs` |
| There's An AI For That | —— | **取不到** | —— | `boards.mjs taaft`（明确报错，不编数据） |

### 关键字段：Product Hunt 的产品真实外链

最高分回答那条流水线（PH → 解析真实网站 → 查域名年龄/流量结构 → 筛非品牌词）
成立的前提就是这一个字段。**PH 的 `/r/p/<id>` 跳转纯 HTTP 也是 403，只能让浏览器跟跳转读 `location.href`**：

```bash
node scripts/demand/boards.mjs producthunt --date 2026-08-22 --resolve-urls --json
```

### 已验证的坑

| 坑 | 实测 |
|---|---|
| **现成的 `opencli producthunt` adapter 是坏的** | `hot` 报 `No network capture within 5s`；`today` 只回 1 条且无名次无票数。用本节的脚本，不要用它 |
| **PH Atom feed 不能替代榜单** | `/feed` 返回 200 但**无名次无票数**，默认按分类混排、日期跨周 |
| **TAAFT 环境级不可达** | apex 域 TLS 握手被切断；www 全路径 CF 质询 403；真实 Chrome 直连 `ERR_CONNECTION_CLOSED`。**浏览器救不回来** |
| **GitHub code search 限流 10 次/分** | 且 `sort=indexed` 已废弃并被**静默忽略**——你以为按时间排了，其实没有 |
| **HN 不要用 Firebase API** | 它只回 id 数组，不能按关键词/时间过滤，捞最近 N 天要几百次请求。用 Algolia |
| **Toolify `/new` 没有提交日期字段** | 想按「最近新增」筛只能靠列表顺序 |

---

## 七、持续涌现新词的平台

**新游戏 = 新词 = 新需求，且没有老站霸占。** 新手拿第一次正反馈最快的一条线。

| 源 | 拿什么 | 取数方式 | 需登录 | 脚本 |
|---|---|---|---|---|
| Steam 商店 | 新上架/即将发布的游戏名、appid、发售日、价格、genres | 公开 JSON（`store/search/results?infinite=1` + `appdetails`） | 否 | `scripts/demand/game-newtitles.mjs --source steam` |
| SteamDB | 即将发售游戏的 **Follows 关注人数 + 7 日增量**（= 发售前需求强度，Steam 官方没有）、价格、发售日 | OpenCLI 真浏览器（CF 挡纯 HTTP） | 否，但要真浏览器 | `--source steamdb` |
| itch.io | 独立游戏名、URL、作者、价格、简介（**无下载量无评分**） | 公开 `?format=json` | 否 | `--source itch` |
| Poki | web 小游戏名、URL、板块（**仅此三项，播放量不公开**） | 公开 HTML（按 `data-tile-*` 解析） | 否 | `--source poki` |
| IGDB | 跨平台新作名、首发日、total_rating、genres、platforms | 官方 API（Twitch OAuth） | 需 `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | `--source igdb` |

### 已验证的坑（两条会让人白跑一轮）

- **`api.steampowered.com/ISteamApps/GetAppList/v2/` 已经下线**：返回
  `Method 'GetAppList' not found in interface 'ISteamApps'`，v1/v0002/带不带尾斜杠四种写法全一样。
  替代的 `IStoreService/GetAppList/v1/` **需要 Steam Web API key**。
  免 key 还能用的是 `/api/featuredcategories`（new_releases + top_sellers + coming_soon 一次全拿）。
- **`appdetails` 的多 ID 查询已关闭**：`appids=440,570` 直接 400，body 是字面量 `null`。
  只有 `filters=price_overview` 还支持多 ID。
- **Poki 的 class 名是构建哈希**，没有 `__NEXT_DATA__`，只能靠 `data-tile-*` 属性定位——
  改版就会坏，坏了修脚本。

> 这条线的通则：**换一个行业就换一批「持续上新」的平台**。
> 拿到一个好源之后，直接问 AI「推荐几个类似 X 的站」比自己想关键词去搜高效得多。

---

## 八、用户的原话

**用户自己写下来的需求，就是你的页面标题。**

| 源 | 拿什么 | 取数方式 | 需登录 | 脚本 |
|---|---|---|---|---|
| Reddit 许愿句式 | 标题（可直接当选题）、正文、子版、作者、时间 | RSS（零配置但限流狠）/ OAuth（CI 推荐）/ pullpush（兜底） | 否（CI 建议配 OAuth app） | `scripts/demand/reddit-wishes.mjs` |
| Hacker News 评论 | Ask HN 下的整棵评论树 | 公开 JSON API | 否 | `scripts/demand/hn-signals.mjs --comments` |
| Google SERP（许愿句式限站搜） | organic 前十 + relatedSearches + peopleAlsoAsk | serper.dev API | 需 `SERPER_API_KEY` | `scripts/demand/serp-query.mjs` |

### 句式模板

```
"is there a tool that"      "I wish there was"      "does anyone know a"
"how do people make"        "alternative to"        "too expensive"
```

后两个是**迁移类**——这类用户需求已经明确，只是在换供应商，转化最快。

### 已验证的坑

**Reddit 的 `.json` 端点已彻底失效**：任何 UA 一律 403 并返回 189KB HTML。
现在能用的三条路依次是——RSS（**必须带浏览器 UA**，自定义 UA 一律 429，且限流极紧）、
OAuth（要自建 script app，CI 首选）、pullpush 第三方镜像（能出数但连着两次就 429）。
脚本已做三路自动降级。

> 中文内容平台（内容社区的搜索下拉与笔记数、短视频的播放量与评论）没有稳定的免登录入口，
> 属人工探测动作。判据在 [`experiences/demand-discovery.md`](experiences/demand-discovery.md) 第五节。

---

## 九、竞品正在往哪儿下注

| 源 | 拿什么 | 取数方式 | 需登录 | 脚本 |
|---|---|---|---|---|
| 竞品 sitemap 增量 | 全量 `<loc>` + lastmod，与上次快照 diff 出**新增/消失/更新**，并出 slug 词频 | 纯 HTTP（robots.txt → sitemap → 递归 index → gzip） | 否 | `scripts/demand/sitemap-diff.mjs` |
| Columbus AI 外链榜 | 目录站域名、被多少 AI 工具站引用、DR、dofollow、月访问量 | 纯 HTTP | 否 | `scripts/demand/boards.mjs columbus` |

**sitemap 增量是这一节的主力**：竞品新布的长尾词页面，是它花钱花时间调研出来的结论，
你只需要读。默认快照写在 `.rankup/demand/sitemap-snapshots/`（相对当前项目，不写死绝对路径）。

```bash
node scripts/demand/sitemap-diff.mjs <域名> --slug-words
# → 「对比 <时间>：新增 24 / 消失 0（当前共 1724 条）」+ slug 词频
```

**Columbus 那张榜不是需求源，是外链落地清单**——它排的是「被多少 AI 工具站引用」，
用在 backlink 环节而不是选题环节。

---

## 九·五、从词根出发

前面九节都是「先有站/先有信号，再有词」。这一节是反方向：**先有词根，扩成候选串，再去撞盘面。**

| 源 | 拿什么 | 取数方式 | 需登录 | 脚本 |
|---|---|---|---|---|
| 工具类词根库（51 条） | 词根 + 中文释义 + 常见搭配 + 8 个扩展模板 | 已固化成本地 JSON | 否 | `scripts/demand/word-roots.mjs` + `data/word-roots.json` |

```bash
node scripts/demand/word-roots.mjs list                       # 全部词根
node scripts/demand/word-roots.mjs seeds                      # 只要词根本身，喂给面板查询
node scripts/demand/word-roots.mjs expand converter \
  --seeds pdf,image --target word                             # 按 8 个模板扩展
```

扩展模板覆盖 `x-root` / `root-x` / `online` / `free` / `ai` / `a-to-b` / `best` / `bare` 八种形态。

### 两条必须一起记的约束

1. **扩展出来的是候选串，不是关键词。** 它们没有搜索量也没有难度——
   把「我扩出了 300 个词」当成「我找到了 300 个词」是这条路上最常见的自欺。
   脚本刻意在输出末尾打了这句提醒。**下一步必须过第十节。**
2. **词根库全是英文，这是整个社群共同的盲区。** 中国人搜「JSON 编辑器」不搜
   「JSON editor」。**词根 × 语言**的乘法会让量倍增——这正是只有 agent 跑得动的部分，
   也是目前最没被人挖的一片矿。

> 更大的扩展词根表（社群流传的百条版）实测**取不到**：非公开分享链接，
> 登录后表格是 canvas + WebSocket 渲染，试遍 export / meta / data 端点与全局对象都无解析路径。
> 需要时人工在表格里「下载为 CSV」，落进项目侧而不是 Skill。

---

## 十、候选验证链路

前九节产出的是**候选**，不是结论。候选必须走完这条链路才能开工。

```
候选域名 / 候选词
   ↓ ⓪ 这个站什么来历：注册日期 / 站龄 / 月访问 / DR / 环比 / 核心搜索词
   scripts/demand/aitdk-lookup.mjs <域名>           # 支持 --file 批量、jsonl 续跑、四个阈值筛选
   ↓ ① 词有没有量、难不难做
   scripts/seo-webcafe.mjs kd --keyword <词>        # 零配置，含 top9 盘面
   ↓ ② 盘面上都有谁、我能不能做得更好
   scripts/demand/serp-query.mjs <词>               # 域名命中 + 首页/内页构成
   ↓ ③ 这个站到底多大、流量从哪来
   backlink/scripts/similarweb-query.mjs            # 总访问量、渠道构成、相似站
   backlink/scripts/semrush-overview.mjs            # 自然流量、引荐域、关键词库
   ↓ ④ 这个方向在涨还是在跌
   scripts/gt.py                                    # Google Trends
```

### ⓪ 这一步的供应商选择

流传的做法是用某个域名数据面板的插件查这四个字段。**实测那个站已经没有域名查询功能了**
（只剩 AI 文案生成器，猜的端点全 404），它背后的官方 API 需要付费令牌。
所以脚本给了两个 provider：

| provider | 拿什么 | 代价 |
|---|---|---|
| `--provider webcafe`（默认） | 注册日期 / 站龄 / 月访问 / DR / 环比 / 核心搜索词 / 月度曲线 | 免费，但吃站点共享每日配额（游客 10 / 登录 100 / VIP 500）。**流量结构字段常为 null** |
| `--provider tabapi` | 月访问 / 流量来源 / 地区 / 核心词 / WHOIS / RDAP / 反链 | 需付费令牌 `TABAPI_KEY`，按 credit 计费 |

**流量结构（搜索占比 / 直接访问占比）拿不到时，退到 Similarweb 的渠道构成补这两格**——
它们正是下面那张阈值表里最关键的两行。

**两个口径必须标明**：Similarweb 给**总访问量**，Semrush 给**自然搜索流量估算**，
同一个站差三倍以上是常态。写结论时不标口径等于没写。

### 常用的筛选阈值（全部可调，不是定律）

来自经验层最高分回答的那套，用于「新站能不能拿到非品牌词流量」这个判断：

| 条件 | 阈值 | 筛掉什么 |
|---|---|---|
| 域名注册时间 | 1 年以内 | 只留新站——老站拿到流量说明不了赛道友好 |
| 月访问量 | > 3,000 | 确认真的拿到了流量 |
| 搜索流量占比 | > 20% | 确认不是发布日的一波曝光 |
| 直接访问占比 | > 20% | 有二次访问，说明确实解决了问题 |

**命中率实测：约每 300 个新品筛出 1 个。** 这个数字决定了这条链路必须自动化跑，
手工筛不划算。

做「精品工具页 + 关键词域名」时换一套：**KD 很低、搜索量不用高、有点 CPC 就行**。
不同目标不同阈值——见经验层第二节。

---

## 十一、令牌与登录态

需要凭据的源，键名统一放 `<rankup-skill-dir>/.env`（`KEY=value` 每行一个，已被 gitignore
排除并由 `scripts/validate-rankup.mjs` 断言不被 git 追踪）。读取顺序一律**环境变量优先，
再退到 `.env`**。

| 键名 | 谁用 | 没有会怎样 |
|---|---|---|
| `GITHUB_TOKEN` / `GH_TOKEN` | `github-trending`（search/issues）、`github-skill-search` | trending 照跑；search 降到 10 次/分；**code search 直接不可用**，脚本提示改 `--mode repo` |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | `reddit-wishes` | 自动降级 RSS，能跑但慢且没有 score |
| `SERPER_API_KEY` | `serp-query` | 报错并指路；保底改用 `seo-webcafe.mjs serp` |
| `PRODUCTHUNT_TOKEN` | `boards.mjs producthunt` | 自动降级到浏览器路径（浏览器路径本来就更全） |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | `game-newtitles --source igdb` | 清晰报错；其余 game 源不受影响 |
| `TABAPI_KEY` | `aitdk-lookup --provider tabapi` | 默认 provider 是免费的 webcafe，不配也能跑 |

**需要登录态**（不是需要令牌）的只有两处：闲鱼、以及 `payment-referrers.mjs similarweb`
所依赖的数据面板。其余「必须真实浏览器」的源
（Trustpilot / G2 / Capterra / Fiverr / Upwork / PH / Toolify / SteamDB / chrome-stats）
都**不需要登录**，只是要绕过反爬质询。

### 浏览器纪律

凡是走 OpenCLI 的脚本，都必须遵守 `opencli` Skill 的会话法律：
一个会话一个标签页、会话名用描述性字面常量（**Bash tool 里绝不用 `$$`**）、
默认 `--window background`、用完 `close`、**sub agent 绝不跑 `cleanup`**。
本目录的脚本已在 `finally` 里自动 close。

---

## 十二、维护契约

- **每个源的取数路径都会坏。** 站点改版、反爬升级、API 下线都是正常损耗。
  坏了**修脚本**，不要绕过去手工点一遍——手工的结果不可比，且下次还得再摸一遍。
- 修完更新脚本头部注释的**已验证日期**，并把失败原因写进去，下次少走一遍。
- **「空」不等于「坏」**：平台会在反爬启发式下主动降级结果，也会用 200 + 空 body 代替 404。
  换个查询词、在普通标签页里肉眼看一下，能复现再进修复流程。
- 新增源时，先按第一节判断它属于哪一类信号，再决定放进哪一节——
  **按「回答什么问题」分类，不按站点类型分类**。
