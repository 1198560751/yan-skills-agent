# 能力清单：rankup 到底能干什么

**这份文件的用途只有一个**：用户只说了一句模糊的人话（「我想让我的站流量涨一点」
「今天弄下 SEO」「帮我看看这个词能不能做」），你需要在**不猜**的前提下知道
——rankup 有哪些能力、每个能力的入口在哪、判读依据在哪个文件。

它是**清单**，不是路由。从人话反查入口请先看 `SKILL.md` 顶部的 `<intent-routing>`；
本文件是那张路由表背后的全量底账，用于「路由表里没有的意图」和「盘点覆盖度」。

三条阅读约定：

1. **入口列写的是真实存在的路径**，相对仓库根。跑之前不用再确认它在不在。
2. **脚本只采集，判读归你。** 三波重构之后，本 Skill 的脚本里没有打分器、没有阈值门、
   没有 verdict；它们产出的是原始数值 + manifest（每源 `{status,count,error}`）+ 失败现场。
   「这个词能不能做」「这站是不是真赚钱」「这项算不算过闸」全部由你对着判读文档下。
3. **采集失败 ≠ 结论为零。** 配额 429、CAPTCHA、卡加载、改版都会产出 0 条。
   看到空结果先读 manifest 与证据目录，再决定是重试还是如实标「未测」。

---

## 一、流程控制与项目记忆（判「现在该做什么」）

| 能力 | 一句话能干什么 | 入口 | 典型触发说法 |
|---|---|---|---|
| 环节闸门判据 | 12 个环节各一张表：检查项 / 客观通过条件 / 证据落点 / 复查口径 | [`references/checklists.md`](checklists.md) | 「这个环节能不能过」「本轮还差什么」 |
| 生命周期步骤 | 阶段 0–10（含 7.5）每阶段的输入、必做动作、步骤 check、完成门禁，共 92 步 | [`references/lifecycle.md`](lifecycle.md) | 「到哪一步了」「下一步做什么」 |
| 项目记忆结构 | `.rankup/` 该有哪些文件、各自的时效契约与提升路径 | [`references/project-memory.md`](project-memory.md) | 「给这个项目建个档」「rankup init」 |
| 项目体检（文件层） | 缺失文件、超期记录、脚本体检、**生命周期检查点**（哪些工具还没用过） | `rankup/scripts/review.mjs` | 「rankup review」「这站还差什么没做」 |
| 会话信号挖掘 | 把本项目的 Claude Code / Codex 会话浓缩成人话与结论，供提取经验 | `rankup/scripts/sessions.mjs` | review 第二步；「以前聊过的结论没沉淀」 |
| 跨项目资产登记 | 扫描各项目 `.rankup/` 重建可复用脚本索引 | `rankup/scripts/registry.mjs` | 「别的项目有没有现成的」 |
| 版本检查与自更新 | 比对远端清单、必要时更新本 Skill | `rankup/scripts/check-version.mjs` | 每次激活 |
| Skill 自体门禁 | 项目中立性、凭据泄露、必需引用与内容片段的机械断言 | `rankup/scripts/validate-rankup.mjs` | 改完 Skill 必跑 |
| 规则晋升与淘汰 | 一条经验该留项目侧还是回流 Skill、怎么废弃 | [`references/evolution.md`](evolution.md) | 「这条经验要不要写进 Skill」 |

## 二、需求挖掘与选题（判「做什么方向」）

执行顺序固定：**[`research-checklist.md`](research-checklist.md)（9 节清单逐项打勾）→
[`demand-sources.md`](demand-sources.md)（源 → 脚本路由表）→
[`experiences/demand-discovery.md`](experiences/demand-discovery.md)（裁定集）**。
先读路由表，不要逐个翻脚本。

`rankup/scripts/demand/` 共 23 个可执行脚本 + 1 个公共库（`_lib.mjs`，不可单独运行），
全部零依赖、统一支持 `--json` / `--out`，失败把 `{url,status,body}` 落证据目录。

| 能力 | 一句话能干什么 | 入口 | 典型触发说法 |
|---|---|---|---|
| Stripe 引荐榜 | 谁在往 Stripe 收银台送人 = 谁已经在收钱，含 31 个月历史 | `scripts/demand/stripe-referring.mjs` | 「反查谁在赚钱」 |
| 长尾支付网关反查 | Creem / Lemon Squeezy / Paddle / Gumroad 等网关的引荐站 | `scripts/demand/payment-referrers.mjs` | 「不用 Stripe 的那些人呢」 |
| 收入/流量榜单聚合 | traffic.cv、TrustMRR、AI 工具榜、新品发现站统一取数 | `scripts/demand/boards.mjs` | 「有哪些站在涨」「谁的 MRR 高」 |
| App 付费榜 | Apple 榜单（付费榜 = 已验证的付费意愿），可 `--list-genres` | `scripts/demand/appstore-charts.mjs` | 「用户愿意为什么掏钱」 |
| Google Play 榜单 | 名次 + 涨跌 + 安装估算，分国家分品类 | `scripts/demand/gplay-charts.mjs` | 「安卓侧量在哪」 |
| 广告主反查 | 谁在持续买流量（持续投放 = ROI > 1） | `scripts/demand/ads-transparency.mjs` | 「谁在花钱买这个词」 |
| 差评矿 | 从「掏了钱之后的反馈」里挖没被满足的需求 | `scripts/demand/reviews-mine.mjs` | 「竞品被骂什么」 |
| 外包需求 | 有人在为这件事付外包费 = 需求已被验证 | `scripts/demand/freelance-demand.mjs` | 「有没有人付钱做这个」 |
| 用户原话 | Reddit 许愿句式（"I wish there was…"），可直接当标题用 | `scripts/demand/reddit-wishes.mjs` | 「用户自己怎么说的」 |
| HN 信号 | Show HN 新品、Ask HN 痛点、方向讨论热度 | `scripts/demand/hn-signals.mjs` | 「最近技术圈在聊什么」 |
| GitHub 升温方向 | trending 的「今天/本周新增 star」——唯一公开的增速信号 | `scripts/demand/github-trending.mjs` | 「哪些方向在起来」 |
| 已沉淀的 skill 反查 | 别人写成 SKILL.md / prompt 的需求 = 高频且值得自动化 | `scripts/demand/github-skill-search.mjs` | 「大家都在反复做什么」 |
| Chrome 扩展缺口 | 分类/搜索页的用户数 + 评分 + 评分人数，找供给缺口 | `scripts/demand/chrome-ext-gap.mjs` | 「插件市场有什么空位」 |
| Chrome 扩展趋势 | 一周/一月涨最快、新增、已下架 | `scripts/demand/chrome-stats.mjs` | 「哪个扩展在爆」 |
| 游戏新词 | 新游戏 = 新词 = 发布当天几乎零竞争页面 | `scripts/demand/game-newtitles.mjs` | 「有什么新游戏能做站」 |
| 游戏平台监控 | 批量跑 sitemap-diff，多语种平台新内页汇成候选报告 | `scripts/demand/game-platform-monitor.mjs` | 「每天盯一遍游戏平台」 |
| 竞品 sitemap 增量 | 竞品新布的 URL = 它自己花钱调研出来的结论 | `scripts/demand/sitemap-diff.mjs` | 「竞品最近在押哪些词」 |
| 站群反查 | 给一个域名，找出同一主体运营的其它站 | `scripts/demand/site-network.mjs` | 「他还做了哪些站」 |
| 域名画像 | 注册日期 / 月访问 / 流量结构 / 核心搜索词（只采不判） | `scripts/demand/aitdk-lookup.mjs` | 「这站是新站吗、量哪来的」 |
| 收入站案例复核 | 薄编排：串起 AITDK/Similarweb/Semrush/sitemap/KD，产出各源对照与倍差事实 | `scripts/demand/revenue-site-audit.mjs` | 「帖子说这站月入 X，真的假的」 |
| SERP 取数 | serper.dev 拿 Google 第一页 organic + relatedSearches + PAA | `scripts/demand/serp-query.mjs` | 「这个词首页排的是什么」 |
| 词根扩展 | 给词根并扩成可投喂数据平台的候选串（挖词的起手式） | `scripts/demand/word-roots.mjs` | 「我只有一个词根」 |
| CPC 折算 | 把关键词表里的 CPC 变成参与决策的信号（纯计算，不联网） | `scripts/demand/keyword-value.mjs` | 「这批词值多少钱」 |

判读依据集中在 [`demand-sources.md`](demand-sources.md)：**十**（候选验证链路）、
**十·五**（能排上去 ≠ 能赚钱）、**九·六**（自扩词表必漏一半）、**②·六·四**（模型流量何时高估）。

## 三、选词、趋势与竞争度（判「这个词能不能做」）

| 能力 | 一句话能干什么 | 入口 | 典型触发说法 |
|---|---|---|---|
| 关键词难度 + top9 盘面 | KD、首页/内页构成、最弱竞争者、链接预算 | `scripts/seo-webcafe.mjs kd` | 「这个词难不难做」 |
| SERP 排名归因 | 某个词的排名盘面归因 | `scripts/seo-webcafe.mjs serp` | 「为什么是他排第一」 |
| 本地零配额计算 | `kgr` / `string`（TDK 长度）/ `money`（收入目标拆解）/ `email`，支持 `--batch`，**只出数值不出评级** | `scripts/seo-webcafe.mjs kgr\|string\|money\|email` | 「算下 KGR」「TDK 超长没」 |
| 需求翻译 / 需求挖掘机 / 起名核域名 | `translateSearch`（字段 `query`）· `mineSearch`（字段 `keyword`）· `domainIntent`→`domainName`→`domainCheck` | `scripts/seo-webcafe.mjs` 对应子命令 | 「帮我想个站名」「这词换成英文怎么搜」 |
| Google Trends | 热度对比、地区分布、相关飙升词、每日热搜；默认走浏览器路由，零 venv | `scripts/gt.py`（取数层 `scripts/gt-browser.mjs`） | 「XX 和 YY 哪个更火」「今天在搜什么」 |
| 搜索量 / KD / CPC（Semrush） | 分国家量与 KD，**外加全球合计 `globalVolume`**；同国家最多 100 词 `--bulk --db <cc>` | `backlink/scripts/semrush-keyword.mjs` | 「这词一个月多少量」 |
| 判读：做不做 | 词龄、窗口、低 KD ≠ 能做、非英语版本值不值 | [`experiences/webcafe-topics.md`](experiences/webcafe-topics.md) 一 ~ 二 | 「KD 才 12，能做吗」 |
| 判读：趋势怎么读 | 窗口选择、毛刺与加速度、空曲线 ≠ 没需求 | [`references/trends.md`](trends.md) | 「这曲线是不是在涨」 |

## 四、竞品与数据面板（判「别人是怎么跑起来的」）

| 能力 | 一句话能干什么 | 入口 | 典型触发说法 |
|---|---|---|---|
| 面板能力目录 | Semrush 10 大工具箱 102 页、Similarweb 23 个模块的实测测绘 + 「没摸到的地方」 | [`references/provider-capabilities.md`](provider-capabilities.md)，`scripts/rankup-cli.mjs catalog` | 「Semrush 能不能查 X」「该用哪个」 |
| 面板取证与续跑 | `capture` 抓一个报告；`audit` 按 manifest 逐页保存原图/HTML/DOM/AX/解析/网络结构 + 哈希回执 | `scripts/rankup-cli.mjs capture\|audit` | 「把这些页面全抓一遍」 |
| 脚本覆盖缺口 | 能力 × 脚本覆盖矩阵、Top 10 优先级、10 个已知短板的兜/不兜判决 | [`references/provider-script-gaps.md`](provider-script-gaps.md) | 「要不要给这个报表写脚本」 |
| 站点流量画像 | 总访问量、渠道构成、相似站、地理分布 | `backlink/scripts/similarweb-query.mjs` | 「这站多大、流量哪来的」 |
| 批量流量筛选 | 几百个域名逐个追加写盘，可续跑 | `backlink/scripts/similarweb-batch.mjs` | 「这批域名筛一遍」 |
| 域名自然流量与外链 | AS、自然流量、引荐域数、关键词数（**只有分国家，没有全球合计**） | `backlink/scripts/semrush-overview.mjs` | 「他自然流量多少」 |
| 四张无导出报表 | 自然排名、主要页面、反链概览、关键词报表 | `backlink/scripts/semrush-report.mjs` | 「他排了哪些词」 |
| 建站指纹 | 一次 `curl` + grep 看竞品用什么建站、挂了哪些分析/广告/支付 | [`references/seo-box.md`](seo-box.md) 三 | 「他靠什么赚钱」 |

**两家「流量」口径不同是常态**，对不上先按地理范围 / 面板页面 / 口径定义三步对齐，
见 `SKILL.md` 的「先查能力表，再决定开不开浏览器」一节。

## 五、建站与基础设施

| 能力 | 一句话能干什么 | 入口 | 典型触发说法 |
|---|---|---|---|
| 默认建站栈 | TanStack Start Monorepo 脚手架 + Cloudflare-first 资源选型 | `SKILL.md`「默认建站栈」+ [`references/cloudflare-stack.md`](cloudflare-stack.md) | 「新建个站」「搭个工具站」 |
| 脚手架四个坑 | 每一条都实际踩过的初始化陷阱 | [`references/lifecycle.md`](lifecycle.md) 阶段 3 | 「init 报错了」 |
| 域名接入 Cloudflare | zone onboarding 并读回 NS 对（Wrangler 没有 zone 命令）；`status` 只读、`create` 建 | `scripts/cf-zone-setup.mjs` | 「把域名挂到 CF」 |
| 支付 / 邮件 / 第三方接入 | 接入方式与边界 | [`references/integrations.md`](integrations.md) | 「接个 Stripe」 |
| 多语言架构 | URL 结构、`<html lang>`、hreflang、繁简分治；**禁止按 IP 自动跳转语言** | [`experiences/webcafe-experiences.md`](experiences/webcafe-experiences.md) 三·五 + [`seo-growth.md`](seo-growth.md) | 「要不要上多语言」 |

## 六、上线前闸门、测量与品牌资产

| 能力 | 一句话能干什么 | 入口 | 典型触发说法 |
|---|---|---|---|
| 上线前闸门七行 | 阶段 7.5 的七条硬性判据 | [`references/checklists.md`](checklists.md) 阶段 7.5 | 「能不能上线了」 |
| 全站 SEO 审计 | 全页 TDK/canonical/robots/lang/h1/OGP/结构化数据/alt/hreflang + 关键词密度（1/2/3-gram，日文 `Intl.Segmenter`）；`--sitemap` 全站、`--fix-report` 出修正清单 | `scripts/seo-audit.mjs` | 「TDK 都对吗」「标题写好没」 |
| 性能双读数 | 一次同时拿实验室（Lighthouse）与现场（CrUX）；闸门 6 要的就是两套 | `scripts/pagespeed.mjs`（需 `PAGESPEED_API_KEY`） | 「站慢不慢」「Core Web Vitals」 |
| 托管方分析 | 开通 Cloudflare Web Analytics 并读回 beacon；应排在 GSC/GA 之前 | `scripts/cf-analytics-setup.mjs` | 「先接个统计」 |
| 行为分析 | 在 Microsoft Clarity 建项目拿 project ID（会话录制 / 热图） | `scripts/clarity-setup.mjs` | 「想看用户怎么点的」 |
| Ahrefs 项目接入 | 建项目、经 GSC 验证所有权、启用 Web Analytics 取回 `data-key` | `scripts/ahrefs-setup.mjs` | 「接下 Ahrefs」 |
| 分析平台判读 | 各平台读数差异与验证方式 | [`references/analytics-platforms.md`](analytics-platforms.md) | 「两个统计对不上」 |
| 接入清单看板 | 已上线站点至少覆盖的 15 类平台与各自验证方式 | `SKILL.md`「接入清单跟踪」→ 项目 `.rankup/integrations.md` | 「还有哪些没接」 |
| 产品发布平台 | Product Hunt 等发布排期与画廊图上传（**不要点上传按钮**） | [`references/product-launch.md`](product-launch.md) | 「发个 PH」 |

## 七、收录、索引与站长平台

| 能力 | 一句话能干什么 | 入口 | 典型触发说法 |
|---|---|---|---|
| 索引主动推送 | 把 URL 推给 IndexNow（Bing/Yandex/Seznam/Naver 共用；Google 不参与）；默认从线上 sitemap 取 | `scripts/indexnow-submit.mjs` | 「新页面怎么快点被收」 |
| sitemap 读/提交 | GSC 与 Bing Webmaster 的 `status` / `submit`，驱动已登录浏览器 | `scripts/webmaster-sitemap.mjs` | 「提交下 sitemap」 |
| 批量移除 URL | GSC「暂时移除网址」批量提交（GSC 没有公开移除 API） | `scripts/gsc-remove-urls.mjs` | 「把废弃页面从谷歌撤下来」 |
| 韩国市场 | Naver Search Advisor 注册、取验证 meta、提交 sitemap（CAPTCHA 需用户点一下） | `scripts/naver-setup.mjs` | 「做韩国市场」 |
| 平台全景 | Bing / GSC / Naver / Yandex / IndexNow 的接入顺序与「挂进发布流程」 | [`references/search-platforms.md`](search-platforms.md) | 「站长工具都要接哪些」 |
| 判读：不收录怎么排查 | 排名起不来、被 K 站、GSC 报索引异常、新站波动 | [`experiences/webcafe-experiences.md`](experiences/webcafe-experiences.md) 十七 ~ 十九 | 「一直不收录」 |

## 八、站点体检、性能与第二台爬虫

| 能力 | 一句话能干什么 | 入口 | 典型触发说法 |
|---|---|---|---|
| 页面体检（第三方） | seo.web.cafe 的页面体检、外链估价、网站估值、域名前世、AdSense 过审预检 | `scripts/seo-webcafe.mjs audit\|backlink\|worth\|history\|adsense` | 「帮我看看这个页面」 |
| 自有站爬虫报告 | 读 Ahrefs Site Audit 已有抓取结果：`projects` 看健康分，`report <id> <报告>` 取 20 个分类报告之一 | `scripts/ahrefs-site-audit.mjs` | 「全站有多少内链失效」 |
| 重定向链 | 裸域/www 几跳、旧 URL 是 301 还是 302（302/307 不传权重） | `curl -sIL`，判据 [`experiences/webcafe-topics.md`](experiences/webcafe-topics.md) 五 | 「跳转对不对」 |
| 判据与分级表 | seo-audit 的 error/warning 阈值、Ahrefs 档位实测、第三方工具接不接的对账 | [`references/seo-box.md`](seo-box.md) | 「这条 warning 要紧吗」 |
| 站点打不开类排障 | CF Pages 无效路径返回首页、图片慢、绑域名跳两次 | [`experiences/webcafe-experiences.md`](experiences/webcafe-experiences.md) 二十四 | 「站打不开」 |

## 九、AI 搜索与 Agent 就绪度

| 能力 | 一句话能干什么 | 入口 | 典型触发说法 |
|---|---|---|---|
| 2026 AI 搜索范式 | AI Overviews / AI Mode / Preferred Sources / Discover 独立算法 / Information Gain；引用优先于排名 | [`references/seo-growth.md`](seo-growth.md) 三-B | 「怎么被 AI 引用」「AEO 怎么做」 |
| Agent 就绪度评分 | `scan` 评分+待修项、`diff` 与上次对比、`history`；`--save` 存 `.rankup/agentic/` | `scripts/is-agentic.mjs` | 「llms.txt 要不要写」「对 AI 友好吗」 |
| 全网基线分母 | Cloudflare Radar 的全网 AI Agent Readiness 聚合通过率（**不是站点扫描器**） | `scripts/cf-agent-baseline.mjs` | 「我这个分数算高吗」 |

## 十、外链（专项 Skill：backlink）

rankup 只负责路由，深入操作时 `/backlink`；未安装：
`npx skills add yan-labs/yan-skills --skill backlink -g -y`。

| 能力 | 一句话能干什么 | 入口 | 是否必须加载 backlink |
|---|---|---|---|
| 机会发现与竞品反链 | 队列化发现 + 评论者反查 | `backlink/scripts/discovery-queue.mjs`、`harvest-commenters.mjs` | 是（读 `discovery-loop.md`） |
| 投放台账 | `stats` 覆盖率、`remaining` 还差多少、证据阶梯 submitted/public/indexed | `backlink/scripts/ledger.mjs` | 是 |
| 受控填表与提交 | 探入口 → 安全填表 → 提交闸门 | `backlink/scripts/inspect-page.mjs`、`safe-fill.mjs`、`release-submit-guard.mjs` | 是（`submission-lanes.md` + `safety-policy.md`） |
| 批量 campaign | 100+ 行的选靶与目录提交 | `backlink/scripts/targets-select.mjs`、`submit-directory.mjs` | 是（`batch-campaign.md`） |
| 质量与毒性判读 | 无专用脚本，靠评分卡 | `backlink/references/link-quality-rubric.md` | 是 |
| 付费平台登记 | 竞品在哪买的链接、投放平台估价 | `backlink/scripts/paid-platform-registry.mjs` | 读 `paid-platforms.md` |
| 登录态后台抓表格 | 虚拟滚动、节流、静默丢行的完整陷阱清单 | `backlink/scripts/harvest.browser.js` + `harvest-collect.sh` + `harvest-merge.mjs` | 是（`harvest.md`） |
| 判读：外链怎么发 | 买链花多少钱、KD → 引荐域数量对照、导航站过滤、发多快算太快 | [`experiences/webcafe-topics.md`](experiences/webcafe-topics.md) 五 + [`experiences/webcafe-experiences.md`](experiences/webcafe-experiences.md) 二十 | — |

## 十一、社群与经验（判「别人踩过什么坑」）

| 能力 | 一句话能干什么 | 入口 | 典型触发说法 |
|---|---|---|---|
| 论坛全站取数 | new.web.cafe：`get <任意站内 URL>` 万能入口、悬赏问答（含 `collect` 征集榜）、经验 91 条 / 帖子 722 条 / 教程 40 个、站内搜索 | `scripts/webcafe-forum.mjs` | 「论坛里搜一下」 |
| 微信群归档搜索 | 14 个群的原文，**就是哥飞.ai 的知识库**，零 AI 额度 | `scripts/webcafe-forum.mjs chat-search "词"` | 「群里怎么说的」 |
| 问 SEO Agent | 有 `SEO_WEBCAFE_COOKIE` 走 `seo-webcafe.mjs chat`（纯 HTTP）；只有登录态浏览器走 `gefei-ask.mjs` | 两条互补路径，选法见 [`seo-webcafe.md`](seo-webcafe.md) | 「问下哥飞」 |
| 取数注意 | **匿名不报错**：返回 200 但把正文抹成空串、票数归零 | [`references/webcafe-forum.md`](webcafe-forum.md) 第一节 | 拿到空正文时 |
| 裁定集：挖需求阶段 | 还没定方向时的判断口径 | [`experiences/demand-discovery.md`](experiences/demand-discovery.md) | 「方向怎么选」 |
| 裁定集：0→1 | 优先级、「1」的定义、虚荣指标、止损线、新站上线执行清单 | [`experiences/zero-to-one.md`](experiences/zero-to-one.md) | 「先做哪个」「什么时候放弃」 |
| 裁定集：转化 | 访客不注册、注册不付费、定价怎么定；**动页面前先查上游流量意图** | [`experiences/conversion.md`](experiences/conversion.md) | 「没人付费」 |
| 裁定集：技术 SEO / 站群 / 索引 | 老站救不救、多站自我重复、品牌名不显示、页面下限 | [`experiences/webcafe-experiences.md`](experiences/webcafe-experiences.md) | 「这站还有救吗」 |
| 裁定集：群友复盘 | 带数字与失败根因的单点实践 | [`experiences/webcafe-topics.md`](experiences/webcafe-topics.md) | 「有人做过这个吗」 |
| 收录规则 | 往经验库加东西的三层归属与证据等级 | [`experiences/INDEX.md`](experiences/INDEX.md) | 「这条经验放哪」 |

## 十二、小游戏专项（子 Skill：game-opportunity）

| 能力 | 一句话能干什么 | 入口 | 典型触发说法 |
|---|---|---|---|
| 每日全流程 | `collect`（discover + radar）→ `demand` → `evaluate`，产出当日候选与日报 | `node game-opportunity/scripts/game-opportunity.mjs daily` | 「运行小游戏监测」 |
| 分步入口 | `discover` / `radar` / `dedupe` / `plan` / `demand` / `evaluate` / `render` | 同上，换子命令 | 「只跑一下发现」 |
| 证据验收 | `collect-checklist` / `decision-checklist` 各 10 项硬验收（查证据在不在，不查判决对不对） | 同上 | 「今天这轮算完了吗」 |
| 判读指引 | 双轨闸门分值表、KD × 新站动作表、深查 6 名额规则——**全部是 AI 判读参考，脚本不执行** | `game-opportunity/SKILL.md` | 「这个游戏值不值得做」 |
| 建站阶段规则 | 游戏站的页面形态、iframe、变现 | [`references/game-sites.md`](game-sites.md) | 「游戏站怎么搭」 |

## 十三、浏览器与取数底座

| 能力 | 一句话能干什么 | 入口 | 典型触发说法 |
|---|---|---|---|
| 数据获取优先级 | 现有脚本 → HTTP API → 用户浏览器 + 脚本 → 手动 OpenCLI；**跳级的唯一理由是上一级不存在** | `SKILL.md`「数据获取的强制优先级」 | 任何取数开工前 |
| 会话纪律 | 一会话一标签页、不要硬编码会话名、Bash 里禁用 `$$`、Semrush/Similarweb 不传 `--session` | `opencli` Skill `references/session-laws.md` | 「标签页被抢了」 |
| 落盘 SOP | 本地接收端优先，端口不能写死；退路才是下载目录 | `opencli` Skill `references/data-extraction.md` | 「数据落哪」 |
| 网页版 AI 工具驱动 | 只有聊天网页形态、且**确认没有 HTTP API** 的工具 | `scripts/chatbot-drive.browser.js` | 罕用；先确认无 API |
| 令牌存放 | 跨项目工具账号令牌只有一份，放 Skill 根 `.env`；项目 `secrets.md` 只记名称不记值 | `SKILL.md`「令牌统一放 Skill 根目录的 `.env`」 | 「token 放哪」 |

---

## 覆盖度自检

盘点时间 2026-08-30，对照磁盘实际文件：

- `rankup/scripts/` 顶层可执行脚本 **21 个**（另含 `lib-scene.mjs` 等库文件与 `gt-browser.mjs` 取数层，不单独作为能力入口）；
- `rankup/scripts/demand/` **23 个可执行 + 1 个公共库**；
- `rankup/references/` **20 个 md**（含 `experiences/` 6 个）；
- 生命周期 **11 个阶段**（0–10，含 7.5）× 闸门表；
- 兄弟 / 子 Skill：`backlink`（必要时加载）、`game-opportunity`（游戏专项）、`opencli`（浏览器底座）。

新增能力时**同时改三处**：本文件、`SKILL.md` 的 `<intent-routing>`（若产生新意图簇）、
以及 `SKILL.md` 的 frontmatter `description`（若用户会用新说法触发）。
只改脚本不改这三处，等于这个能力对用户不存在。
