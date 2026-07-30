---
name: rankup
description: 数据驱动的网站 SEO 优化工作流 + 经验沉淀库(活技能,每次使用后自更新)。当用户提到 SEO 优化、排名、GSC、搜索流量、关键词优化、标题优化、CTR、收录/索引、多语言 SEO、外链、"流量掉了"、"排名怎么样"、rankup 时使用;在新项目里用 "rankup init" 触发全面接入排查(性能/SEO/排名/SERP/关键词一次摸底并生成行动计划)。也在完成任何一轮 SEO 改动后触发:把本轮验证过的经验写回本文件。
---

# rankup — SEO 优化工作流与经验库

> **活技能**:这不是静态文档。每次用它做完一轮优化,必须执行底部的【自更新协议】把新经验写回来。凭数据说话,不凭直觉。

## 一、数据通道地图(2026-07 实测)

| 通道 | 用法 | 坑 |
|---|---|---|
| **GSC(真实点击,最高优先)** | claude-in-chrome 扩展操作用户真实 Chrome:`list_connected_browsers` 非空 → `select_browser` → `tabs_create` → 导航 performance 报告;每页行数调 100 逐维度读 | 扩展需在 Chrome 侧边栏用同账号登录后才配对;`find` 的 ref 点击自定义下拉可能不生效,改坐标点击 |
| **Google Suggest(真实输入,免费无限)** | `curl --retry 3 --retry-all-errors -x http://127.0.0.1:7890 "https://suggestqueries.google.com/complete/search?client=firefox&oe=utf-8&ie=utf-8&hl=<hl>&gl=<gl>&q=<enc>"` | **oe/ie=utf-8 必带**,否则非拉丁文字结果丢失;`[512]` subtype = 高量词;空结果本身就是"无需求"的裁决 |
| **哥飞 KD(难度+SERP 盘面)** | `GET https://seo.web.cafe/kd/api/v1/kd?keyword=&gl=` Bearer token;或 MCP kd-gefei | 仅英文词;100 次/天共享;**seo.web.cafe 走直连,挂代理反而 SSL 抖**;token 在 seo.web.cafe/kd 页脚生成,重置即作废旧 token(2026-07-17 轮换过一次;当前有效 token 存 ~/.claude.json mcpServers.kd-gefei,勿写进任何仓库文件) |
| **哥飞 On-Page 体检** | `POST https://seo.web.cafe/audit/api/analyze` body `{url,keyword}`,header `X-AUDIT-Token`(token 内嵌在 /audit/ 页 meta,403 时重抓页面刷新) | 对阿拉伯文词数统计是假阳性(漏计),阿语页"内容过少"警告忽略 |
| **哥飞其余工具(MINE/TRANSLATE/WHY/VALUE)** | 走 OAuth session,无法无头自动化;VALUE 是纯前端计算器 | Bearer token 只对 KD 有效 |
| **PSI API(干净 lab 性能数据)** | `curl -x http://127.0.0.1:7890 "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=<enc>&strategy=mobile&category=performance"` | 匿名共享配额有每日上限,耗尽当天只能本地 lighthouse median-of-N 顶替;本地 lab 先跑一次"修复前"做同环境基线,绝对值不可跨环境比 |
| **死路(勿再试)** | Ahrefs MCP(套餐无 API;2026-07-18 复验:全接口含 gsc-*/management-* 均 "Insufficient plan")、Semrush MCP(units=0)、agent-browser 连真实 Chrome(Chrome 136+ 禁 CDP)、Google Trends(共享代理 IP 常年 429) | |
| 网络 | 本机 shell 直连部分外网 TLS 间歇重置(curl exit 35):Google 系/github/npm registry/ui.shadcn.com 走 7890 代理(node 系 CLI 另加 `NODE_USE_ENV_PROXY=1` 才吃 env,undici EHPA),git push 带 `HTTPS_PROXY`,所有 curl 带 `--retry-all-errors`;**api.cloudflare.com 反着来:必须直连**(2026-07-18 实证代理下 wrangler 全部 fetch failed,直连一次成)——wrangler deploy 不带代理+重试 | zsh 内联 for 循环易 parse error,写成 .sh 脚本跑;管道尾接 tail 会吞退出码,成功判定用输出 grep;刚部署完 workers.dev 可能瞬态回 CF 1042,几十秒自愈勿误判 |

## 二、项目知识目录(两层架构)

本 skill 服务多个项目。**通用经验留在本文件;项目专属知识放在各项目仓库根目录的 `.rankup/` 下**,由本 skill 负责沉淀、读取、更新:

```
<project>/.rankup/
  INDEX.md      # 目录索引:一行一个文件 + 一句话说明(每次增删文件同步更新)
  baseline.md   # GSC/流量基线快照(带日期),每轮优化前后各记一笔
  keywords.md   # 词库:集群、意图判定、KD、已承接位置(title/H1/FAQ)
  decisions.md  # 已裁决事项(做/不做/原因),防止重复调研
  audit.md      # 技术体检结果(init 产出,后续轮次更新)
  plan.md       # 行动计划:接下来要做的事,P0-P2 排序,每项带预期影响与完成判定
  <topic>.md    # 按需扩展:市场调研、竞品、外链等
```

**规则**:
- **激活本 skill 时第一件事**:读项目 `.rankup/INDEX.md` 恢复上下文;目录不存在则在首轮优化时创建。
- 该目录随仓库进 git —— **严禁放 token、密钥、账号等敏感信息**(那些放用户级 memory)。
- 判断归属:换个项目还成立 → 写本文件【经验库】;只对这个站成立 → 写项目 `.rankup/`。

## 三、init — 新项目接入(`rankup init`)

在一个还没有 `.rankup/` 的项目里执行,一次摸底 → 落档 → 出计划,之后任何会话都能立即开工。参考 autopilot 思路:拆成带完成判定的阶段,无人值守跑到底,只在"花钱/建站级"决策上停下来问用户。

**Phase 1 — 并行情报收集(用 /agent-mode 派 3-4 个英文 brief 的后台 agent,只读不改)**:
- **站点画像**:框架/语言版本/sitemap/robots/canonical/hreflang/结构化数据/域龄(repo + 线上抓取)
- **技术与性能体检**:哥飞 AUDIT API + Lighthouse(如可用)+ 手工核对经验库里的已知雷区(canonical-redirect 一致性、favicon/og 资产 404、robots 非标准指令、soft-404、Bot Fight Mode、hydration mismatch)
- **排名与 SERP**:GSC 有则全量读(查询/国家/页面),无则 `site:` + 核心词 KD 盘面(前十占位者、dedicated、体验分)
- **关键词宇宙**:Suggest 多语言/多国扫描(含空结果裁决);开放性问题(竞品打法、市场讨论、外链机会)交给 /deep-research 或 /agent-reach
- 各 agent 的 brief 必须自包含:数据通道地图、额度预算、"analysis only" 约束照抄本文件

**Phase 2 — 汇总落档**:合并报告 → 写 `.rankup/` 全套(INDEX/baseline/keywords/decisions/audit)→ 用 /writing-plans 的规范产出 `plan.md`(P0-P2,每项 = 动作 + 预期影响 + 完成判定)。

**Phase 3 — 汇报与开工**:给用户一页决策摘要(修什么/建什么/不做什么/要用户做什么,如 token、DNS、账号授权);用户点头的项直接按 plan.md 顺序执行,执行轮次回到【工作流】。

**技能编排表(不单打独斗,按需组合)**:
| 场景 | 用谁 |
|---|---|
| 多路并行调查/批量实施 | /agent-mode(英文 brief 省 token,后台并行) |
| 开放性研究:竞品、算法更新、市场 | /deep-research |
| 社媒/论坛真实讨论、外链与分发渠道 | /agent-reach |
| init 结果 → 分阶段可执行计划 | /writing-plans |
| 遇到能力缺口(schema、外链提交、CRO…) | /find-skills 先找现成的,没有再手搓 |
| 宽泛指令自动拆解、无人值守跑完 | 参考 /autopilot:阶段化 + 完成判定 + 不中途请示 |

## 三-A、机会池选型与冷启动(“鱼多人少”框架)

> **定位**:本节来自 Fiona 的出海经验分享,用于发现和筛选候选机会,不是已经被本站数据验证的结论。文章里的“四个月月入万刀”等个人结果没有可复核证据,不得写进项目基线或当作成功率依据。候选方向必须通过本 skill 的 GSC/Suggest/SERP/真实交易数据门禁后,才能进入 `.rankup/decisions.md` 和 `plan.md`。

### 1. 先选池子,再谈技术

新项目、新产品线或新词族在写代码前,先填一张【机会池卡】并回答四个问题:

1. **鱼(Demand):需求是否真实?** 至少找两条彼此独立的信号,其中至少一条是直接信号。直接信号优先级:GSC 已有曝光/点击或意外词簇 > Suggest 稳定联想与明确意图 > 持续而非一次性的搜索广告 > 可核验的付款、订阅、评论或榜单收入。讨论热度、单个爆款、竞品自述、有人发外链都只是弱信号。
2. **人(Competition):新手是否有可挤的位置?** 查最终目标词形的 SERP,记录前十标题专门经营比例、最弱占位者 DR、体验分、引用域和页面质量;再看领先站点的内容新增速度、外链增长和产品/定价成熟度。**有人买高价外链只证明有人投入,不证明项目盈利,更不等于我们也该买。**
3. **切口(Wedge):为什么轮得到我们?** 至少指出一个可验证缺口:内容型修饰词、衍生需求、语言/地区时间差、网页与 App 的渠道错配、结果格式差异、流程更短、体验更强或细分用户未被服务。只说“市场很大”“AI 很火”不算切口。
4. **钱(Monetization):具体赚谁的什么钱?** 四类里至少命中一类并能在页面上证明:省时间;帮业务赚钱/省人力;提供娱乐或情绪价值;把复杂流程包装成简单服务。写不出付款人、付费时刻和替代方案时,先不做。

**GO 门槛**:`D+C+W+M` 四项都有证据,且能定义一个低成本验证版本;缺任一项只能标 `RESEARCH`,不能因为技术能做就开工。

### 2. 跟踪高手留下的时间线,不抄结果页

- **外链时间线**:看早期先出现在哪些社区、目录、发布页和内容页,重点是冷启动顺序、目标页与后续结果;最终公开页必须核对 URL、重定向和 `rel`,不能把目录宣传或当前总外链数当历史证据。
- **新增内容**:通过 sitemap、lastmod、站内新页面、博客/工具发布日期持续记录竞品最近押注的词簇。竞品动作只生成候选假设,仍要回到 Suggest、SERP 和真实交易信号验证。
- **真实交互**:实际走完落地页 → 输入 → 生成/结果 → 注册 → 价格 → 支付前一步,拆标题、入口、示例、信任信号、等待反馈和付费点。学习其决策与漏斗,不要只让 AI 复制视觉样式。
- **通过鱼找人**:从新词前排、持续盈利产品和高质量分发位反查反复出现的域名/操盘者,建立观察清单;研究其可见动作,不把个人光环或社群宣传当证据。

### 3. 新手默认先“截流”,能造势的人再造势

- **截流**:承接已经存在、意图明确的搜索需求。用户已经知道要什么时,页面负责更快给出可用结果和顺畅付费路径;这是新站拿首批真实反馈的默认策略。
- **造势**:市场尚无搜索词时,依赖社媒、内容、红人和持续叙事创造需求。只有已有分发能力、内容产能和更长验证预算时才选。
- **热点不要只追第一层词**:沿“事件/模型 → 具体用途 → 衍生任务 → 地区/小语种 → 结果格式”展开候选词,逐层验需求与竞争。小语种晚爆发只是待验证假设,不能凭时间差直接建站。
- **模型词/平台词加风险门禁**:核对商标、冒充官方、模型/API 授权、内容安全、供应商价格与下线风险;能截到流量不代表能长期经营。

### 4. MVP 的目标是拿证据,不是批量制造薄站

- 页面、功能和后台流程可以从最小版本开始;人工处理只在交付真实、时效可控且不欺骗用户时使用。先定义页面唯一要验证的需求和付款理由。
- 从第一天记录 `landing → input → generation success → result action → signup → pricing → checkout` 漏斗。精准流量的价值要用激活、完成、留存或付款证明,不能把访问量和停留时长本身当成功。
- 赠送积分用于让目标用户完成足够次数的真实试用;进度动画、示例和明确状态用于降低等待焦虑。**不要为了“增加停留”故意放慢生成**,速度、成功率和感知等待要分别测。
- 每个版本只改少量变量,记录“保留什么、删掉什么、下一站复用什么”。复用基础设施可以,复制薄内容、相同页面和未经验证的词矩阵不可以。

### 5. 用连续小实验提高胜率,不用“大数定理”安慰盲目铺站

项目成功概率不独立、也不会长期固定;同一错误选词复制十次仍是十次同源失败。正确做法是为每个候选池设置:

- 固定的时间/现金/外链预算上限;
- 最小样本和观察窗口;
- `GO / ITERATE / KILL` 判据;
- 失败后必须更新的假设与下一轮唯一改进。

只有上一轮产生了可迁移学习,增加样本量才有意义。“多上站”应理解为**更快完成多个有止损的小实验**,不是同时养一批没有需求证据的站。

### 6.【机会池卡】模板

```md
候选池/最终目标词形:
需求证据(D): [直接信号] + [独立交叉信号]
竞争盘面(C): 前十专页比 / 最弱 DR / 体验分 / 引用域 / 投入速度
可切入缺口(W):
付款人和价值(M): 谁在何时为什么付费;替代方案是什么
高手时间线: 早期外链 / 最近新增页 / 关键漏斗
流量策略: 截流或造势;首个精准渠道
MVP 与漏斗事件:
预算上限 / 观察窗口 / 最小样本:
GO / ITERATE / KILL 判据:
结论: GO | RESEARCH | SKIP
```

## 四、工作流(每轮优化按此走)

0. **读项目 `.rankup/`**(见二),没有就先走 init(见三)。新项目、新产品线或新词族先填【机会池卡】并通过 `D+C+W+M` 门禁;已运行站点的存量优化直接从 GSC 真实数据开始。
1. **先拉真实数据再动手**:GSC 查询词(点击+曝光+CTR)→ 按语义聚类 → 国家分布交叉(哪个市场曝光大 CTR 低 = 收割空间)。没有 GSC 就用 Suggest 摸需求形态。
2. **意图核验后再选词**:对候选主词查 KD 的 `details[]`(前十是谁、dedicated?、DR、体验分)。**SERP 被电商/实体货占据的词 = 意图不匹配,放 H1 蹭不进 title**。
3. **落地映射**:title ≤60 字符、主词只出现一次 + Suggest 验证过的修饰词;description 110–160 字符、动词开头、写差异化(free/秒出/免注册);H1 承接第二词组;FAQ 逐条承接长尾(一条 FAQ = 一个查询意图);多语言不是翻译而是本地化(音译、方言词、当地搜索习惯)。
4. **验证闭环**:构建后脚本核对全语言 title/desc 长度与关键词落位 → commit → push → 轮询线上生效 → IndexNow ping(key 文件在站根)→ 记录 GSC 基线,1–2 周后回看 CTR/排名变化。
5. **收尾必做**:执行【自更新协议】。

## 五、经验库(验证过的判断,带日期)

- **[2026-07-17] 查 GSC 意外集群**:你可能已经在为没写过的词排名(bettercallsaul.store 的 "logo generator" 集群 199 点击/月、全站第一,页面上一个 logo 都没有)。GSC 查询表是最便宜的机会挖掘器,每轮必看。
- **[2026-07-17] 多语言音译 > 官方名**:阿语用户搜剧名音译 بيتر كول سول(376 曝光)远多于人名 سول غودمان(109);还用方言词 كرت(名片)、فاضيه(空白)。本地化要进 Suggest 验证当地拼写/方言,别只翻译。
- **[2026-07-17] 意图不匹配的词别硬刚**:"saul goodman business card" KD 48 且 SERP 全是 Amazon/Etsy 实体卡 —— 工具站蹭 H1 即可,title 主槽给意图匹配的 template/generator。
- **[2026-07-17→19 修订] 语言版 go/no-go 要 Suggest+SERP 两票**:Suggest 空结果 = 需求不存在(结论级,如印尼语 Saul 卡片为零→不建 id 版);但 Suggest 满格只证需求存在,**不证可赢**——birthstonemeaning 实证:ko/ja 탄생석/誕生石 Suggest 全满格,SERP 却被 Naver 等本土平台垄断(渠道错配,谷歌站吃不到)→ 不做。裁决顺序:Suggest 验需求 → SERP 盘面验可赢性 → 两票通过才开语言版。
- **[2026-07-17] 虚构结构化数据是 P0**:JSON-LD 里编造的 aggregateRating(4.8/1250,无评分功能)违反 Google 政策,盈利站点有人工处罚风险,发现即删。
- **[2026-07-17] 标题堆砌导致 Google 改写**:同一短语在 title 出现两次 → SERP 标题被改写(Ahrefs "Page and SERP titles do not match")。主词一次 + 差异化修饰词。
- **[2026-07-17] 体验分是排名天花板**:哥飞 KD 直接给 SERP 占位者打体验分(停留/跳出);文案做满后,守位靠产品(停留 33s vs 竞品 4-6min = 脆弱占位者)。
- **[2026-07-17] 第二产品线验证法**:同机制跨 IP 扩展前先用 Suggest 验证(American Psycho 名片 = generator/maker/template/font 全 [512] → GO;Breaking Bad 无名片意图 → SKIP,同宇宙≠同需求)。
- **[2026-07-17] meta description 110–160 字符**是 Ahrefs 警告阈值;CJK/阿语按字符数同样适用。
- **[2026-07-17] title/desc 长度按"解码后码点"量,别量构建产物**:Astro 把属性里的 `"` 转 `&#34;`(5 码点)、`&`→`&amp;` —— 一条含 `"Better Call Saul!"` 的 desc 在 raw HTML 比 Google 实际计数长 8+ 码点,天真 grep 会误判超长/把 CJK 误判达标。核查脚本先 decode `&#\d+;`/`&#x..;`/`&quot;`/`&amp;` 再套 110–160。CJK 偏低端就达标(~112-118,首页实证 115),拉丁/阿/印 ~145-158。
- **[2026-07-17] canonical 指向会重定向的 URL 形态 = 白写**:站点服务端把尾斜杠 307 到无斜杠,而 canonical/内链/sitemap 全是带斜杠形态 → 每次点击多一跳、canonical 可能被 Google 忽略。修法:选定一种形态,用一个共享的 normalize 函数守住 href/canonical/hreflang/sitemap 四处(crystalhealing.guide 实证)。
- **[2026-07-17] 仓库结构迁移后必查静态资产**:monorepo 化把 public/ 留在旧根目录,vite 只认 app 内 public/ → favicon/og-image/全部插图 404 静默上线数日。迁移后必跑:线上首页控制台错误 + curl favicon/og-image。
- **[2026-07-17] robots.txt 里放非标准指令会被判 invalid**:`LLMs-Txt:` 让 Lighthouse robots-txt 审计直接 0 分(SEO 分被拉低)。非标准内容一律放注释。
- **[2026-07-17] Cloudflare Bot Fight Mode 是三重 SEO 税**:挑战脚本占主线程 ~2.5s(TBT 爆表)、自带 deprecated API 警告(拉低 Best Practices)、还会 403 掉 Bing IndexNow 的 key 验证抓取。且程序化关不掉:wrangler OAuth 无 bot_management scope(读都 403),只能 dashboard 或专建 API token(Zone→Bot Management→Edit)。**关的时候是两个开关**:Bot Fight Mode 和「JS 检测」(JS Detections)相互独立,只关 BFM 注入照旧——验证标准是 curl 首页 grep challenge-platform 归零(实证:关 BFM 后 12 分钟注入仍在,关 JS 检测后秒消)。Bing IndexNow 对 key 验证失败有 ~24h 缓存,挑战撤掉后要延时重推。
- **[2026-07-17] 线上 React #418 = SSR/客户端文本不一致,时间类内容是头号嫌犯**:Worker 在 UTC 渲染日期/月相,UTC+8 用户每天早上 0-8 点全量触发 mismatch。时间衍生的装饰性文案用 suppressHydrationWarning(React 官方许可的用途);功能性内容改为 mounted 后渲染。
- **[2026-07-17] soft-404 检查法**:对"该 404 的 URL"(未发布内容/删除页)curl 状态码,200+页面写着 404 = soft-404。SSR 框架修法是 loader 里 throw notFound(),别在组件层兜底了事。
- **[2026-07-17] WCAG 对比度修复的三分法**:装饰性字形加 aria-hidden(直接退出审计)>给信息性小字专设深色 token(如 ember→ember-ink 4.5:1)>全局加深整个色阶(最后手段,会压扁文字层级)。mounted-gated 的客户端页面记得把 h1 放进 skeleton,否则 SSR 无标题。
- **[2026-07-17] hreflang 按"页面所属 section"成簇,不复用全站首页模板**:多语言站的子页 section(如 /<lang>/logo-maker/)其 hreflang 必须列**本 section 的 N 个语言兄弟 + x-default**,而不是首页那套。演进两阶段:①只有单语言版时(en-only 子页)——布局默认输出全站 hreflang 会指向一堆 404,安全解 = 关掉 hreflang 只留自引用 canonical;②补齐全部语言后——给布局加一个 `alternatePathSuffix` 之类的 prop,把 section 路径拼到每个 locale 根(`站/​<lang>/` + `logo-maker/`),首页传空即不变、子页传后缀即成本 section 簇。构建后脚本必须扫全 dist 的 hreflang 逐个 resolve 到已构建文件(0 个 404)。顺手给无画布/无支付的子页加脚本开关省掉无用 JS(实证 ~70KB);且该开关一旦关掉运行时 JS 包,客户端 i18n 也不加载(见下条)。
- **[2026-07-17] 后台 agent 被进程重启杀死时,工作区可能有未提交半成品**:恢复第一步 `git status` 验货(build+验收产物质量),质量过关就主线程接手收尾,别盲目重派浪费一轮。
- **[2026-07-17] 审计爬虫必须跟随同语言重定向**,否则尾斜杠 307 会把 BFS 掐死在种子页(第一版只爬到 69/284 页,结论全错)。多语言站爬虫按"页面语言 vs 链接目标语言"报违规,一轮就能揪出全部串语言链接(实证 450 处)。
- **[2026-07-17] 体验层做"预设=参数集",别建平行状态**:模板画廊/一键随机在既有可序列化表单状态上 applyDefaults(合并到默认值),复用 reset 流程;缺的样式维度(颜色等)补成一等参数、渲染处用原字面值兜底 → 默认渲染逐字节不变、付费导出路径不受影响。随机化只覆盖 curated 调色板/字体/阴影且只作用于"当前卡"(不碰文案/坐标),永远出可用卡。缩略图用 CSS mock(零资产、不拖首屏),别渲染多个 canvas。停留时长是体验分/排名天花板时,这是最低风险的加分项。
- **[2026-07-17] Canvas/HTML 文本继承页面 dir,RTL 语言页里固定英文内容会被 bidi 重排**:阿语页画布把 "IN LEGAL TROUBLE?" 渲成 "?IN LEGAL TROUBLE"、电话/数字错位;HTML 缩略图英文脚本同理("Better Call Saul!"→"!Better Call Saul")。固定拉丁内容:画布设 `ctx.direction="ltr"`、HTML 片段加 `direction:ltr`。页内预览画布在 RTL DOM 内会中招,detached 导出画布默认 ltr 常不受影响 —— 预览与导出要分别验证。**[实证升级]** `ctx.direction="ltr"` 设在绘制函数顶部时:①对 LTR 页是 no-op;②仍能正确整形阿语名(阿语字形是 strong-RTL,单跑内部照样右到左),所以同一张卡"阿语名 + 英文 logo"混排两边都对;③若导出走 renderExportCanvas 把同一个模块级 ctx 换成临时画布再调同一绘制函数,这一行同时覆盖预览与导出(无头浏览器 2× 导出实测通过)。
- **[2026-07-17] Canvas 文本不会触发 web 字体下载**:DOM 文本会拉取 @font-face,但只在画布用到的字体(如仅 canvas 用的 Cairo)可能一直用 fallback 渲染。换预设/换字体后要 `document.fonts.load('bold 54px "X"').then(重绘)` 强制加载再重绘,才能保证预览和导出 PNG 都用真字体(导出是同步 toDataURL,字体没就位就把 fallback 烤进 PNG)。按需加载:小语种字体只在该 locale 的页 `<link>`(如 Cairo 仅 /ar/),别全站背包袱。
- **[2026-07-17] 多语言站常有两套文案真源(SSR 数据文件 + 客户端 i18n 包)**:SSR 从数据文件(如 translations.ts)渲染初始 HTML,客户端再用运行时语言包(如 lang-ar.js)覆盖 data-i18n 元素。只改 SSR 源不改运行时包 → 水合后文案被还原。改任一语言文案先 grep 确认有没有第二层覆盖,两边同步;运行时包若只含子集,缺失键会保留 SSR 文案(可利用,新增键可只落 SSR)。**[补 2026-07-17]** 若某页 opt-out 运行时 JS 包(无画布/无支付子页,如 /<lang>/logo-maker/),客户端 i18n 根本不加载 → 该页只剩 SSR 真源,整页文案单放 SSR 数据文件即可、无双源同步负担;而仍跑 JS 的页(首页)要给子页加的新入口/CTA 文案,走 SSR-only 键最省(客户端 applyTranslations 对运行时包里缺的键 `return` 跳过、保留 SSR),别再往每个运行时包塞一份。**[补 2026-07-18]** 双真源站的运行时包可能不止覆盖文案——若包里有 applyMetaFromPack 之类逻辑,**加载后会重写 title/desc/canonical 整个 head**,Googlebot 索引的是包接管后的渲染层:一切 SEO/密度断言必须加一层"无输入渲染后 DOM"检查(headless 加载+settle 后再断言),只测 SSR 产物会漏掉包层回写;head 改动必须双源同步否则线上 SERP 用的是包里的旧 meta。

- **[2026-07-17] 跨工具 carry 状态要按"目的地的字面量约定"归一化,颜色要防背景撞色**:两个 canvas 工具各自的 `<select>` 值约定不同(A 端多词字体带 CSS 引号 `'"Dancing Script"'`,B 端裸名)——直接透传时引号值匹配不到 B 端 option,恰好最重要的字体静默丢失;carry 前剥引号即全表映射。颜色只带"用户主动选的非默认值":A 端默认色若等于 B 端背景色(金字→金底),无脑带过去=内容隐形。兜底靠机制而非白名单:`select.value=未知值` 是 no-op、`hidden input` 收任意串,所以目的地 option 空间自然过滤非法值,前向兼容(bettercallsaul logo→card 实测:quoted→unquoted、#E63946 落位渲染、reset 全复原)。
- **[2026-07-17] 全局下拉里放小语种字体用"选择时注入"零成本**:`<option>` 全 locale 可见,但 Google Fonts `<link>` 在 change 事件里按 family 注入(link id 去重 + onload 后 FontFaceSet load→重绘),没选的用户一字节不下载,LTR 性能零回退;**localStorage restore 后要补一次同样的检查**——跨页/跨 locale 的 carry 会把字体值带到不预载它的页面,漏了这步恢复的卡就一直用 fallback 渲染(实测:选择注入 link、默认渲染逐字节不变、restore 场景兜住)。
- **[2026-07-18] LCP 图被 loading="lazy" 拖死是首号性能反模式**:lazy 让预载扫描器直接跳过 + Chrome 按 Low priority 取图 → Load Delay 占 LCP 48%(crystalhealing.guide 实证 6.3s→3.4s)。修法三件套:img 加 `loading="eager" fetchPriority="high"`(共享图组件开 opt-in priority prop,默认仍 lazy)+ 路由 head 加 `<link rel="preload" as="image" fetchpriority="high">`(React 19 会把它 hoist 到 stylesheet 之前)。验证不看分数看机制:LH JSON `network-requests` 里图的 priority 翻成 High、请求起点与 CSS 并行、`lcp-lazy-loaded` 审计过。修完若 LCP≈FCP,说明图已退出瓶颈,别再折腾图。**[补 2026-07-17]** 同站首页修完记得扫其余模板页——详情页 plate 同样 lazy/Low(load delay 55%),同配方复制即可;动态路由的 preload 用 `params.slug` 拼 href。TanStack Start 会把 head link 输出两份(SSR head + router payload),浏览器对同 URL preload 去重,无害勿追。部署后首个 curl 可能撞上未失效的边缘 POP 旧字节(`max-age=0, must-revalidate` 下一跳即回源)——用 etag/content-length 比对 + retry 再下结论,别误判部署失败。
- **[2026-07-18] 水彩/软渐变插图 WebP 重压缩近乎免费**:同 PSNR(~41.9dB)下 700px q78 只有 800px q72 的 55% 体积(28KB vs 50KB);按"最大 CSS 渲染尺寸×1.5~2"定目标宽,cwebp -m 6 重编码,肉眼无差(用 Read 工具双图对照确认再换)。photo 类纹理图不适用此倍率,需单独目检。**[批量实证 2026-07-17]** 57 张插图一次过(−54%,PSNR 36.4–42.3dB):连金属簇晶/葡萄状细密纹理(pyrite/chrysocolla,PSNR 最低段)在 ≤460px 渲染下也无可见差——"需单独目检"实际只适用于真实照片,风格化插图整批只抽最差 PSNR 3 张 + 旗舰页 1 张目检即可。批量脚本:备份原图到 scratchpad + `-print_psnr` 记录逐张 TSV,按 PSNR 升序挑目检对象。
- **[2026-07-18] "流量突然归零"三步定性法**:①GSC 人工处置措施+安全问题(双绿=非惩罚,断崖惩罚极少且必有通知);②曝光是否与点击同步归零——排名掉了曝光仍会记录,曝光同步归零=搜索需求本身消失(需求侧),不是排名问题;③查询表形态——若近乎 100% 是"品牌+子词"导航词(sbti 생각러 式),流量本质是站外病毒传播的回搜,退潮≠SEO 事故,处方是通用词布局+再传播,不是修站(sbti.support 实证:876 点击 88% 韩国、150 查询全品牌词、4月峰值 120/天→6月贴地,双绿)。
- **[2026-07-18] GSC 效果报告读表用 get_page_text 而非截图翻页**:把"每页行数"调大后 get_page_text 一次返回整张查询/国家表(150 行全量),比逐屏截图快一个量级;表格数据在 SPA DOM 里是纯文本,直接可解析。
- **[2026-07-18] Suggest 联想词出现"品牌+品类"组合 = 品牌已渗透该语言市场**:mbti parody→"sbti mbti parody"、搞笑人格測試→"sbti 搞笑人格測試"(繁简双出)——这类词是零成本必承接词,也是跨语言传播回声的免费探测器(比社媒监听便宜)。
- **[2026-07-18] 程序化组合页矩阵的 GSC 病理形态与处方**:27×26 配对页×4语言=2808 页,病理=890 页"已抓取-尚未编入索引"+已索引数被 Google 主动回收(峰值 2400→1858);处方分级:先撤 sitemap(保守可逆,页面保留 index,follow 承接长尾),4-6 周未消化再升级 noindex。hub 页留在 sitemap(该需求集群真实存在时,如 "sbti 궁합" 392 曝光)。**[终态实证 2026-07-18]** 用户授权大刀阔斧后直接跳到 noindex,follow 终态(4,742 页含二级游戏配对矩阵+分享落地页+答题进行页),站点从 5,222 页收敛到 ~480 索引目标;分享落地页(/result/*)与内容页(/type/*)同质=索引稀释,share landing 一律 noindex(社交访问不受影响)。
- **[2026-07-18] Cloudflare Email Obfuscation 是全站死链制造机**:页面有明文邮箱时 CF 边缘把它替换成 `/cdn-cgi/l/email-protection#<hex>` 链接,不执行 JS 的审计爬虫(Ahrefs)把它当 404 内链 → 全站每页报一条死链(实证 3,488 页)。修法:邮箱拆 span+JS 拼装(或 `<!--email_off-->` 注释/关 Scrape Shield)。**本地构建产物永远扫不出来**(注入发生在边缘),线上 curl grep email-protection 才是验证。且审计报告必须先对照"爬取日期 vs 最近部署日期"——旧爬照旧版,可能报的问题已经修完了。
- **[2026-07-18] 类型/产品改名后旧名可能是 GSC 品牌词**:SBTI 的 CTRL 从 "조종자" 改名 "완벽 장악러" 后,GSC 显示用户仍搜旧名(150 clicks,第二大品牌词)。清理 prose 里的旧名残留会误伤流量;正解=改名页保留一句 legacy bridge("한때 '조종자'로 불렸던"),0-1 click 的旧名不做。改名决策前必查 GSC 查询表。
- **[2026-07-18] 图片批量压缩工具链升级**:pngquant(256色)+oxipng 对插画类 PNG 比 ImageMagick 量化质量好一个档(实证 results png -80% 无可见劣化);OG 用途的 png 压不到 100KB 时保留原质量(爬虫单次抓取,不是页面权重);全幅 hero(fill 渲染)的图不可按"渲染宽×2"缩尺寸,只能重编码——**压缩 agent 的 brief 里"已验证的渲染尺寸"也要让 agent 复核**(实证 brief 里两处"事实"是错的,agent 复核后避免了 upscale 模糊)。
- **[2026-07-18] @astrojs/sitemap 只会输出 index+chunk 双文件**(无单文件选项),协议合法、Google 认;但小站建议 postbuild 扁平化成单一 /sitemap.xml(脚本:复制 chunk → 删除 index+chunk → robots.txt 同步 → 旧 URL 加 301)。**Cloudflare Pages 的 _redirects 只在路径不命中静态文件时生效** —— 不删旧文件,重定向永远不触发。手工维护的静态 sitemap 副本是事故源(本站 5 月版本后来被当垃圾清掉导致 404 两个月),要么生成要么重定向,别手写。
- **[2026-07-18] 词密度被 UI 控件文案稀释的根治法 = 交互门控注入**:密度工具读 raw HTML,但 Googlebot WRS 渲染 JS 却**从不交互**——DOMContentLoaded 注入只骗得过工具骗不过 Google,唯一可靠的逐出 = 首次真实交互(pointerdown/pointermove/keydown/touchstart/wheel 五事件 once+passive)才从 SSR 内嵌 JSON blob(与 SSR 同一 t() 调用生成=单真源,blob 属 script 内容不计入可见文本)注入空 span(data-i18n-lazy,并摘掉 data-i18n 防运行时包提前水合);`:empty::before` 占位防 CLS,px/°/% 后缀走 data-unit。bettercallsaul 实证:64 label+16 单位转换后 raw top15 的 position(1.88%)/px(1.78%)/size/shadow 全部出榜、主题词回正;无头零输入 3s 后全空、单击后 en/ar 双语全正确、面板高度 Δ0。配套教训:①计数断言要**数据驱动**,规格里硬编码的 27/28 这类数字连两个独立 checker 都数错(Prettier 折行的 `>--</span>px` 漏计);②代码注释声称的"build 断言"必须真实落进 build 管线并验证会咬人(故意注坏一个值看 exit 1),phantom guard 比没有更危险。
- **[2026-07-18] CF Pages 构建成功的无 dashboard 验证**:`npx wrangler pages deployment list --project-name=<name>` 出现新 commit 的 Production 行即构建成功(失败构建不产生部署行,老部署继续服务=站点健康不能证明新构建没挂);未装 GitHub 集成的 repo `commits/<sha>/status` 恒 pending 不可依赖。改动只含 build 脚本/注释时线上字节不变,这是唯一的客观信号。

- **[2026-07-17] Stripe 本地币展示的决策树**(Stripe-hosted Checkout):要让访客按所在国看本地币,首选 **Adaptive Pricing**(后台一个开关、零代码、Stripe 维护汇率+四舍五入+解锁本地支付方式、官方推荐 complexity 1/5)——但它是**账户级设置**(要用户去 Dashboard 开,代理只能出指令不擅动)。代码侧能自己实现的替代 = 按国发 inline `price_data`(自担汇率、需硬编码金额)。**致命坑:IDR 在 Stripe 是 2 位小数币种**(不在 zero-decimal 名单 BIF/CLP/JPY/KRW/VND…),金额=最小单位×100(Rp 30.000 = `unit_amount:3_000_000`);别凭记忆猜,用 test-mode 会话建单开 hosted 页看渲染("IDR 30,000.00"证实)。**发货/积分逻辑只要 keyed off session `metadata`(不读金额)就天然币种无关**——presentment 换币不碰它;换任何多币种方案前先核这条成立(bettercallsaul 实证:credit 走 metadata.credits,ID→IDR / 无国→USD 两路 e2e 均对,USD 请求逐字节不变)。
- **[2026-07-19] Stripe 资源 ID 上线前必须证明 test/live 模式一致**:`price_`/`prod_`/`we_` 的字符串形态不携带模式信息,用本地 test key 创建的对象写进 live runtime 后只会在真实 Checkout 暴露 `resource_missing`(Stripe 会提示同 ID 存在于 test mode)。门禁必须绑定目标环境:用部署环境对应 key retrieve 资源并断言 `livemode`、金额、币种、`recurring.interval`;写入 Pages/Workers secret 后要新部署让 binding 生效,最后从生产 API 新建 hosted Checkout 并核对月费/周期,不能把“Dashboard 创建成功”当“生产可用”。
- **[2026-07-19] 退役旧 Stripe Checkout 不能按价格或 metadata 形状批量 expire**:共享账户里的无命名空间历史会话必须同时核验站点 return host、client/device identity、完整且无后续分页的单 line item、quantity、session/item/price currency 与金额、商品名和 recurring `interval=month + interval_count=1`;dry-run 只给聚合 count+digest,每次确认最多处理字典序一个候选,网络不确定后重新 dry-run。bettercallsaul 实证先拦下 `line_items.has_more`、双月 cadence 和多候选 partial-failure 三类误杀风险,再逐笔处理 21 条 legacy open。
- **[2026-07-17] Web Share 文件分享(把成品图甩进 WhatsApp)**:`navigator.share({files:[File]})`(Web Share L2)需 `navigator.canShare({files})` 门控 + secure context(https/localhost)+ **用户手势**内调用。File 必须**同步**构建——`canvas.toDataURL()`→手搓 base64→`new File(...)`,**别用异步 `canvas.toBlob`**(回调跑到时手势已丢,iOS Safari 抛 NotAllowedError)。降级 `https://wa.me/?text=<encodeURIComponent(文案+页URL)>`(全平台可用,含桌面)。**分享带水印导出**(水印=站 URL)= 免费分发,每次分享都在打广告,且不白送干净 HD。headless 浏览器 `navigator.canShare`/`share` 常 undefined → 自动落 wa.me,可据此验降级链路;真机 OS 分享面板+WhatsApp 交接无法无头 e2e(如实说明验了什么)。
- **[2026-07-17] Cloudflare Pages Functions 取访客国**:用 `request.headers.get("CF-IPCountry")` 优先、`request.cf?.country` 兜底。理由:两者生产都由 CF 边缘设且相等、header 不可被客户端伪造(CF 会覆写入站 CF-*);但 **`wrangler pages dev` 本地 `request.cf.country` 是 mock 值会短路盖过你发的 header**,header 优先才能本地发 `-H "CF-IPCountry: ID"` 把地区分支测通,且不损生产正确性。
- **[2026-07-18] Google SERP 缩略图需要页内真实 `<img>`,canvas-only 站点 og:image 只是彩票**:bettercallsaul 7 语种共用同一 og:image、页面 0 个 img,结果只有 1 个语种出缩略图。修复全家桶=页内可见 img(懒加载可,Googlebot 处理 lazy)+ og 尺寸声明改真值(造假会被忽略)+ og:image:alt + JSON-LD image + image-sitemap 条目。**双格式策略**:og/twitter 用 PNG(WhatsApp/FB 预览爬虫对 webp 不稳,站内有 WhatsApp 分享流时尤其别赌),页内/JSON-LD/sitemap 用 WebP(同图 175KB→56KB)。SERP 生效要等重抓(机制层当天可线上断言,效果 1-2 周回看)。
- **[2026-07-18] CF Pages _headers 合并语义实测**:所有命中规则 MERGE(非最专一优先),同名 header 值串联成矛盾垃圾(`no-store,...,immutable` 浏览器按 no-store 解);修法=更专一块里 `! Cache-Control` 先摘再设。实测生效范围:根级扩展 glob(/*.png 等)、depth-1 文件夹 glob(/_astro/x.css)、/sitemap*.xml 均正常;**但 /assets/*(文件在二级子目录 /assets/js/x.js)的 detach 生效、set 永不落地**——新旧两版规则一致,最终落 Pages 静态默认 `public, max-age=14400, must-revalidate`(对无哈希资产这默认反而合理,可接受)。原因未明(字节已排除),**验收只能 curl 实测且认 cf-cache-status:MISS**(HIT 是旧部署边缘残留,加 `?cb=` 绕缓存键取源站真值)。连带教训:合并 bug 修好前 no-store 假死掩盖了"无哈希直连 JS 配 1yr immutable"的雷——修缓存头时必须重估每类资产年限(直连 payments.js 短缓存,哈希 /_astro/* 才配 immutable);同 URL 换图字节被 immutable 挡住,换封面要改文件名。
- **[2026-07-18] @astrojs/sitemap 的 urlset 自带 xmlns:image/video/news 命名空间**:postbuild 注入 `<image:image>` 前先查重(重复 xmlns 属性=XML 硬错误,ET.parse 直接炸),且要插在 `<url>` 块**末尾**(XSD 的扩展元素槽在 sequence 尾部,插 `<loc>` 后面严格校验器会拒)。
- **[2026-07-18] 浏览器预览面板三个坑**:①scrollY≠0 时 screenshot 输出纯背景色帧——绕法=把目标元素临时 `position:fixed` 钉到视口顶再截,拍完还原;②整个 tab 合成器可能坏死(任何位置都截不出内容)→ tabs_create 换新 tab;③面板里原生 `loading=lazy` 可能不触发(节流),`img.decode()` 可强制加载做诊断——都是面板 quirk,真浏览器/Googlebot 不受影响,别据此改产品代码。

- **[2026-07-18] 次级关键词用 H2 锚定在现有页,不必新建页**:KD <25、月搜 <300 的长尾关键词,在已有排名页里加一个 H2 section(3 段正文 + CTA)即可锚定,省去新页的索引等待和权重稀释。条件:母页已有一定权威 + 新词意图与母页高度重合。实证:bettercallsaul "logo font"(KD 19.4/160 月搜)加到 font generator 页,不建独立页;H2 精确匹配目标短语,正文自然出现 2 次,密度安全。
- **[2026-07-18] 部分语言版 hreflang 必须过滤到实际存在的 locale 子集**:多语言站某页只做了 3/7 语言时,布局默认输出全部 7 个 hreflang → 4 个指向 301 重定向或 404,Google 会降权或忽略整组 hreflang。修法:布局加 `alternateLangs` prop,页面级声明自己存在于哪些 locale,hreflang 输出只包含这些 + x-default。构建后脚本扫全 dist 的 hreflang 每个 href 必须 resolve 到已构建文件。
- **[2026-07-18] 交互式 UI 的 i18n 完整性是 SEO 审计盲区**:下拉菜单选项标签、badge 文案、modal 按钮——这些"功能性 UI"常被 i18n 遗漏(开发时用母语测通就提交)。后果:非母语页面的 Core Web Vitals 不受影响但 UX 信号(跳出/停留)劣化,且 Googlebot 渲染后能看到混语言内容。修法:数据接口里为每个 UI 字符串建类型字段(包括 option label),CSS 值(hex/font-weight)保持跨 locale 常量;构建脚本断言每个 locale 的翻译键数 === 接口字段数。
- **[2026-07-18] 关键词密度超标的降密手法:自然变体替换而非删内容**:密度 >3% 时,把精确短语的部分出现替换为语义等价的自然变体("Better Call Saul font" → "the font" / "this lettering" / "Saul-style text" / "the show's signature lettering")。目标:精确短语在 title/H1/首段各一次 + FAQ 问句,其余全用变体;降密后仍保持话题相关性,不砍内容量。
- **[2026-07-19] 静态代码审计的"定罪"必须构建产物/运行时复核后才能开修**:audit agent 从布局层 script 门控推断"子页付费墙死"(判 SUSPECT confirmed),但组件文件自己带了一个无条件内联 `<script src=payments.js>`——maker 用 dist grep + Node 实际执行当场证伪,若按报告盲改会引入脚本重复加载。规矩:任何 SUSPECT 裁决,修复者第一步是复现(dist grep/无头点击),复现不了按误报回销。
- **[2026-07-19] "没人付款"四路并行定性法(约 1 小时出裁决)**:①Stripe 21 天分日桶(sessions/PI/charges/events;裁决字段=最后成功付款时间戳 vs 代码改动窗口;剔除自家 e2e 合成 deviceId 污染)②生产链路逐跳 E2E(建 live session 不付款无害,且可用 Stripe retrieve 反查 success_url 实证 returnPath)③改动窗口 commit 逐一 CLEAR/SUSPECT ④GSC 周对比。低基数站先算基线——"上周有人付款"可能只是唯一一位买家;~3 真实 session/周的量级下"一周零单"是统计常态,别先假设故障。冷知识:`checkout.session.created` 事件类型在 Stripe 不存在(创建是同步 API 调用,不发事件)。
- **[2026-07-19] 工具站加子页时支付回跳链三件套要同步审**:①checkout 后端 returnPath 若是单段正则(`^\/[a-z-]*\/?$`),所有子页购买后静默跳回首页——放宽用 `^\/(?!\/)[a-z0-9-]+(?:\/[a-z0-9-]+)*\/?$` + 长度帽(天然拒 //、..、\、%,对抗探针实测无站外泄漏);②locale 解析别 `replace(/\//g,"")` 剥全部斜杠(多段路径永不匹配),读首段 `split("/").filter(Boolean)[0]`(zh-hant 连字符安全);③不载全站 i18n 运行时的页面用内联 shim 只带所需键,必须 `JSON.stringify().replace(/</g,"\\u003c")` 防 `</script` 逃逸 + `if(!window.X)` 防覆写。
- **[2026-07-19] AI 插图标注 "Illustration" 是内容站 E-E-A-T 信任信号**:宝石/矿物内容站用 AI 生成的"看起来真实"的标本图,必须在 figcaption 或组件内可见标注 "Illustration"(不是 alt-only、不是 HTML 注释)。三级分类:装饰/信息图可不标注;拟真宝石图必须标注;辨真假教学图禁止用 AI(必须真实照片)。标注透明度建立信任且不影响视觉品质;Google E-E-A-T 评估看"是否诚实展示内容来源"而非"是否用 AI"——标注反而加分。适用所有用 AI 插图呈现实物外观的内容站。
- **[2026-07-19] References 列表禁止裸 URL,必须显示描述性来源标题**:文末 References 区块的链接文字应显示"石头名 — 来源机构全称"(如 "Peridot — Gemological Institute of America (GIA)"),不是 `gia.edu/peridot` 式裸 URL。原因:①裸 URL 显得不专业,用户无法判断来源权威性;②屏幕阅读器读 URL 是噪音;③E-E-A-T 信号——证明作者真的读了来源并能命名它。实现:URL 域名模式固定时(GIA/Mindat/GemSociety/geology.com)用辅助函数从域名自动生成标题,不需改数据层;域名不固定时改数据模型为 `{title, url}` 对象。
- **[2026-07-20→修订] TanStack Start + CF Workers 站的 sitemap 用 prebuild 脚本生成,不手写不动态**:TanStack Start 无内置 sitemap 机制(无 @astrojs/sitemap、无 Next.js sitemap.ts),CF Workers 也不支持 API route 式动态 sitemap(增加运行时成本 + TTFB)。正确做法:一个 Node.js prebuild 脚本从**路由数据源**(如 signs.json)读全部页面 slug → 生成 static XML → 放进 public/ → vite build 打包为 Worker 静态资产,CDN 直送零运行时。关键:脚本与路由逻辑共享数据源(不是另存一份列表),确保路由新增 → sitemap 自动跟进,杜绝手写静态 sitemap 的漂移问题(实证:手写版 7 URL、自动版 17 URL,缺口 10 页)。`lastmod` 不能用构建日期冒充:Google 只在它持续、可验证地等于页面显著修改时间时使用;无法维护真实逐页日期就省略该可选字段。
- **[2026-07-20] 响应式 `srcset` 必须逐候选做资产门禁**:只检查 `<img src>` 或抽测 390/1440px 会漏掉中间宽度候选;浏览器会按 viewport/DPR 真实选择缺失的 960w,导致只在该档首屏破图。构建校验应从组件规格枚举每个内容实体的全部 800/960/1200 候选并逐文件断言,线上 crawl 也要直接请求每个候选 URL。
- **[2026-07-20] 手写静态 sitemap 必然漂移是已验证的反模式**:新页面上线但 sitemap 未同步更新的发生率 100%(本站实证:12 个星座页上线但 sitemap 仍只有 7 条)。小站认为"手动加一下很简单"——但人永远会忘,尤其数据驱动的动态路由(从 JSON 读 slug)不会主动提醒你更新 sitemap。任何超过 5 页的站,sitemap 必须由代码生成,无例外。
- **[2026-07-20] React/JSX SSR 页面的文本断言必须先归一化空白**:JSX 在插值边界注入 `<!-- -->` 注释标记,剥标签后 "How to Choose a Pearl" 变成双空格,天真 substring 检查报假阴性(实证同一天两个独立检查脚本都中招)。规矩:剥 script → 剥标签 → 空白归一化(`\s+`→单空格),然后才做 in/count 断言。
- **[2026-07-20] 模板+数据驱动批量页的 meta 长度断言按"最长数据组合"逐行算**:title/desc 模板串上最长实体名组合(如 "Sagittarius"+"Turquoise")才是超标点,只人工看旗舰页必漏(实证 12 页里 5 title/4 desc 超标,旗舰 Leo 恰好全合规)。修法=build 链加内容断言脚本,镜像模板字符串对每行数据计算长度;同一脚本顺带断言"每个数据引用都解析得到记录"(组合名 slug 查不到记录 → 整块静默不渲染,页面残缺 40% 无人报错)。上线前负向测试确认断言真的 exit 1。
- **[2026-07-20] 批量内容的事实错误浓度在"边角层"**:核心实体内容被反复过目,事实错误聚集在辅助层(aux 条目、次要 blurb)——一轮全量核查 3 个事实错误全部出在边角(含人物出生年份都对不上的张冠李戴)。审核资源分配要反直觉:越边角越要查;"人名+日期+数字"组合是最高危形态,联网核证优先给它们。
- **[2026-07-21] Workers Custom Domain 与旧根域 A/AAAA 记录冲突时，先读 CF API 错误再动 DNS**:自定义域部署若报 `100117 Hostname already has externally managed DNS records`，`custom_domain:true` 和 Wrangler 的覆盖参数都不会删除外部管理的同名 A/AAAA/CNAME。先列出该 hostname 的全部记录，确认旧源站确实失效后，只删除冲突的 IP/CNAME 记录，保留 TXT/MX/验证记录；重跑部署后 CF 会建立只读代理 Worker DNS 和证书。验收必须同时查 Custom Domain API、HTTPS 实际响应、canonical 和 sitemap，不能把 Worker upload 成功当域名上线。
- **[2026-07-21] IndexNow 的安全接入是“线上 root key + 已发布 canonical + 精确变更”**:先把 UTF-8 key 文件部署到正式域根目录并实际读取核对，再从 sitemap/路由真源筛出已上线的 canonical URL 提交；响应 200/202 只代表接收（202 还可能在校验 key），不是抓取或收录。首发可一次回填；默认只提交新增、更新或删除 URL，避免无意义地消耗 crawl quota。若用户明确要求小站每次生产发布全自动通知，则只能把 `--all` 串在**成功的** `wrangler deploy` 后，并以当次 sitemap 为唯一 URL 真源；通知失败必须让 CI 标红，但不能误称已发布的 Worker 被回滚。客户端脚本应在本地拒绝外域、query/hash 和 sitemap 外路径，并只重试网络或 5xx，4xx 直接报错。
- **[2026-07-21] 目录宣传不是链接属性证据**:免费目录的“可见 listing”与“可传递权重的外链”是不同事实；提交成功后必须打开最终公开页，核对目标 URL、重定向形态和 `rel`。实证中页面即时上线但出站链接带 `nofollow`，所以记录应拆成“已提交 / 已上线 / follow 或 nofollow / 已收录或带来 referral”，不得用 DR 宣传替代核验。
- **[2026-07-21] 批量目录的 success keyword 只能产出待复核候选**:通用确认词会读到表单说明或营销文案而误报成功；实证中一个页面正文写“review your submission”但同时报 `Tool's Name is empty`，另一个所谓确认页其实还停在选择免费/付费方案。批次结束后必须逐条核对结果 URL、错误提示、下一步按钮和邮件/审核门槛，再把状态落成“确认提交 / 待验证 / 校验失败 / 未提交”。

- **[2026-07-21] 建页和等权重不互斥——DR 0 阶段内容页的内链拓扑价值大于排名价值**:新页面即使短期无法排名,它向现有页面注入的内链(月历→晶体×2+星座×2+首页+Chart = 6 条/页)会加速爬虫发现已有页 + 传递话题信号 + 储备长尾变体的零成本曝光。因此内容拓扑型扩展(月历页、聚合页)在 DR 0 就应该建,不需要等到有权重再建——等的成本(内链缺口期)比建的成本(多维护几页)高。实证:birthstonemeaning 29 页站仅靠 zodiac↔crystal 双圈互链,补 10 个月历页可注入 42 条新内链打通三圈闭环。但此论点不适用于需要独立排名才有流量价值的孤岛页(如博客文章)。
- **[2026-07-26] 「可下载资产」挂哪个页面由 Suggest 的词形决定,不由你觉得哪页合适**:直觉会把可打印图表挂在最相关的新页(日历),但 Suggest 实测 `printable birthstone` 的 8 条联想**全部落在 chart、无一落在 calendar** —— 用户脑子里「能打印的那张表」叫 chart。而且 Suggest 会把形态一并说死(`free` / `pdf` / `with pictures`),照着做就行,不用猜。**配套裁决**:逐个子实体的下载页要先验需求——`printable december birthstone` 与 `december birthstone printable` 双双返回空,证明需求只在「一张涵盖全集的表」这个粒度,做 N 个单实体下载页 = N 个无人搜的薄页。
- **[2026-07-26] 「新增几个页面」是用户最容易误解的一环,先把「文件不是页面」讲清楚再谈方案**:PDF/PNG/WebP 是静态资产,不进 sitemap `<loc>`、无 TDK、不参与索引竞争;把可下载资产做成「现有页的一个 H2 区块 + 几个文件」通常是 0 新增 URL。用户问「是不是每个都要独立页面/独立 URL」时,答案往往是零,但必须画出层级图(页面 / 区块 / 文件三层)才讲得明白。**拆独立页要给触发条件而不是拍脑袋**:等 GSC 出现该词形的查询打到母页但排名靠后,才说明母页吃到意图却因 title 没占住词而排不上——那时拆才有依据。
- **[2026-07-26] 程序生成的下载物必须与站点共用数据源,并给排版加溢出断言**:海报/图表类可下载资产一旦手绘,必然与站上数据漂移(硬度改了、多石月份改了,下载版还是旧的)。正解是脚本从既有数据文件生成并进 build 链。**排版守卫同样重要**:固定画布(A4 595×842pt)里塞 N 行内容极易越界,而生成物是图片、CI 不会报错、肉眼不看就发不现——加一条「格内最后一条基线 ≤ 卡片高度」的断言,本轮当场咬中 152pt 内容塞进 150.5pt 卡片、两行文字被下一行边框划穿。
- **[2026-07-26] 修饰词的降难效应逐个实体不同(−11.5 到 −39.5),查一个就外推必然误判**:同一模板的 12 个词(`{month} birthstone meaning`)实测 KD 从 9.5 到 42.7 横跨三个难度档,`+meaning` 相对头词的降幅 October −39.5、December −32.8、April 只有 −11.5。**一个模板化词族看起来同质,SERP 却各不相同**——竞争者按实体分布不均(某些月份被珠宝电商重点做,某些没人管)。规矩:词族规划要**逐个实测**,不能查一个代表性词就给整族排批次;配额不够就先查最可能做的头几个,把其余标 `未测` 而不是估算填表。附带判据:排批次时用「KD × 最弱占位者 DR × 该占位者体验分」三元组,只看 KD 会把"最弱位是 DR 64"(无位可挤)和"最弱位是 DR 11 且体验分 29"(可挤)混为一谈。
- **[2026-07-26] 盘面里出现「低 DR + 高体验分」的占位者是警告而非机会**:哥飞模型会显式标注这种位置——DR 15 但停留 2:13、跳出 37%、体验分 81 的站,判词是"靠产品力站住的位置,复制它需要同等的产品质量"(-8)。**这类位置不是靠外链能拿的**,和"DR 11 + 体验分 29"的脆弱占位者要分开处理:后者堆链接+做好内容能挤,前者必须在内容质量上真正超过它。规划文档里要把这两类分开标注,否则执行时会误判工作量。
- **[2026-07-26] 一个修饰词能把同一主题的 KD 砍掉 30 分,选词必须在词形层面比价而不是主题层面**:`december birthstone` KD 46.5(8/8 是标题命中的单月专页,Tiffany/BlueNile/Jared 等电商重兵,需 50–110 引用域),加一个 `meaning` 变成 `december birthstone meaning` KD **13.7**(仅 3/8 标题命中,DR 11、体验分 28 的站占着 #6,需 10–20 引用域)。**同一主题不同词形是两个完全不同的 SERP**,只查主题头词就下"这个方向做不了"的结论必然误判。机制:头词往往是交易意图(电商砸资源),`+meaning`/`+symbolism`/`+history` 这类修饰词把意图切到内容侧,电商不专门做。**规矩**:对任何候选主题,至少查「头词 + 一个内容型修饰词」两个词形再裁决;规划文档里排批次也要按最终要打的那个词形排,而不是按头词。
- **[2026-07-26] 聚合页/工具页打不过"专页"盘面,但能吃"无人专门经营"的盘面,判据是 SERP 里的「专门经营」比例**:哥飞 KD 报告直接给这个信号——`birthstone calendar` 前十只有 1-2 个标题命中、"没有人押上首页经营这个词",聚合工具页有结构性机会;`december birthstone` 8/8 标题命中、模型明确标注"被正面争夺的红海词",聚合页零机会。**所以"一个聚合页承接 N 个子主题"这种设计,可行性完全取决于那 N 个词的专页比例,不取决于你的页面做得多好**。查一个代表性子词的盘面就能定生死,别先写代码。
- **[2026-07-26] URL 参数态(`?month=12`)永远不会成为独立搜索结果,别把它当承接页规划**:参数页的 canonical 必须指回无参基础页(否则自造重复内容),因此它在索引层不存在。想让某个子主题被单独承接只有两条路:独立 URL,或者接受由基础页整体承接。**用户常见误解是"给参数页做好 SEO 就能命中子词"**——要先把这条讲清楚再讨论方案,否则整个讨论建立在错误前提上。锚点(`#december`)同理:它能做站内链接目标和 passage 提示,但不产生独立索引单元;且锚点指向 `display:none` 的元素时原生跳转失效,需要在挂载时把 hash 解析成选中态。
- **[2026-07-26] 用户报"页面跳一下"时,先把同时发生的几件事拆开分别测,别信因果直觉**:用户看到的是"改选项 → URL 变 → 页面跳",三件事同时发生,几乎必然归因到最显眼的那个(URL)。实测:单独调 `replaceState` 滚动位移 **0px**,单独换面板位移 **150px** —— URL 完全无辜。根因是**可切换面板高度不等**(12 个面板 306–455px,摆动 149px),切换时它下方的一切被推走;顶部 tab 切换看不出来(变高的部分在视口下方),只有触发控件位于变化内容**下方**时用户才会被推走,这正是"只有些选项才跳"的解释。修法优先选"让触发控件把目标滚进视口"而不是锁死容器高度(后者要为最高的那个面板永久留白)。**通用检查**:任何 tab/手风琴/结果卡设计,先量各状态高度差,再看触发控件在内容的上方还是下方。
- **[2026-07-26] 单页应用里手写 `history.replaceState` 必须把原 state 传回去,且不能在水合前判断它是否为空**:框架路由(TanStack Router 等)把自己的 `__TSR_index`/`__TSR_key` 存在 `history.state` 里做历史追踪与滚动恢复;传 `null` 或 `{}` 会整个抹掉,后续导航的滚动行为随之出错。正确写法恒为 `replaceState(window.history.state, "", url)`。**陷阱**:SSR 页面在水合完成前读 `history.state` 得到 `null`,据此会误判"路由器根本没存东西、传 null 无害"——本轮差点因此否掉正确假设,水合后再读才是 `{__TSR_index, __TSR_key, key}`。排查时对全站 grep `replaceState` 逐个核对第一个参数,一个项目里通常只有最早写的那处是对的。
- **[2026-07-26] 循环里渲染的样板文案 = DOM 里的 N 份重复文本,肉眼永远查不出来**:免责声明、"了解更多"、单位说明这类文字写在 `.map()` 内部时,读者一次只看到一份(其余被 `hidden` 藏着),但爬虫拿到的是 N 份完全相同的段落,直接稀释主题词密度。实证:诞生石日历 12 个月面板各带一份相同的 chakra 免责声明,提到循环外只写一次后,页面从 2,403 词降到 2,006 词,少掉的 397 词全是重复样板。查法只能是数 DOM(`txt.count(片段)`),不能靠看页面。**推论**:凡是"每个卡片/每个 tab 都有同一句话"的设计,都应该提到容器层。
- **[2026-07-26] 「先否定后肯定」是跨语言的 AI 指纹,英文站同样要清,且改法是删掉否定的那半句**:`not X but Y` / `rather than` / `instead of` / `neither` / `says nothing about` / `X by design` 全是同一套路,和中文的「不是A，而是B」同源。实证:一版新写的英文页 12 处,其中 `rather than` 独占 6 处——这个词在英文技术写作里太顺手,是最容易漏的一个。正确改法不是换同义表达,而是**只留肯定的那半句**(`is not one mineral but a family of them` → `Six related minerals share the garnet name`;`Neither answer is wrong` → `Both answers are right`)。配套一个次级 tic:`which is why` 在 12 段并列文案里出现 5 次,同样要清零。
- **[2026-07-26] N 个并列条目的首句结构必须打散,同构就是模板指纹**:批量写 12 段/12 个卡片时,最自然的写法是每段都「{主体名} + 动词」开头,结果 12/12 同构,读者翻两屏就察觉是一句话跑了十二遍(红线级的模板页问题)。做法:强制按不同锚点起头——数量、地点、年代、过程、物质、名字,名字起头的控制在半数以下。检查方法是把 N 段的首个逗号前的部分并排打出来看,一眼可辨。
- **[2026-07-26] 改完内容必须重核计数,这是最容易漏也最显业余的一类错**:每轮改写都会让数字、区间、以及"页面承诺展示 X"与"实际展示了什么"对不上。日历页一轮改写后抓到 3 处:①FAQ 说星座起始日是 20th-23rd 而正文说 19th-23rd(Feb 19 = Pisces,19th 才对)——**同一事实在两处用不同数字表述时必然有一处错**;②新写的 intro 承诺"每张卡片给 color and hardness",但硬度当时只在表格里,卡片没有;③改写引入了 `Name: X: y` 双冒号渲染。前两类要写成脚本比对(数据源 vs 文案断言、承诺清单 vs 组件实际字段),不能靠通读。
- **[2026-07-26] 交互式"分月/分类"页要把全部面板渲进 SSR,靠 `hidden` 切换,而不是点击才渲染**:这类页(日历、tab 式对比、手风琴)的排名价值恰恰在于那 N 份长尾正文;点击后才挂载 = 爬虫只拿到 1/N,页面退化成一个空壳工具。实证:12 个月面板全量 SSR 后 raw HTML 有 2,403 可见词、12 段独有事实全部可抓,而交互体验完全不变。配套两条:①深链(`?month=N`)必须服务端就渲染对应面板,别等水合;②"当前月/今天"这类高亮**只能 mount 后算**,服务端取当前日期会让 HTML 随请求日期和时区变化(React #418),还会毁掉整页缓存——默认值取固定值,个性化交给页内控件。
- **[2026-07-26] 为省客户端包而复制的数据,安全性 100% 来自那条构建断言,复制和断言必须同一个 commit**:把大 JSON(64 条长文记录)整个 import 进客户端组件是包体灾难,所以抄少量字段(如 12 个 Mohs 值)进小数据文件是对的;但抄贝一旦没有断言就是必然漂移的第二真源。规矩:抄贝的注释里写明"由 X 断言守护",断言逐字段比对原始文件,并**负向测试确认它真的 exit 1**(改坏一个值看构建是否失败)——本轮 4 条断言全部负向测试通过,其中"关键词与另一页重复"这条是纯内容红线,静态类型检查永远抓不到。
- **[2026-07-26] 组件库的浮层控件(Radix Select 等)在浏览器预览面板里常常驱动不了,别把它当产品 bug 也别硬刚**:实测合成 pointerdown、typeahead+Enter、ArrowDown+Enter 全部无效,面板还会把 `innerWidth/innerHeight` 报成 0、`read_page` 返回空、`getBoundingClientRect` 全 0;换 tab、resize、把元素 `position:fixed` 钉到顶都救不回来(钉住反而会破坏 Radix 的定位)。正确做法是换一条能给出真实证据的验证路径:把该控件**最终影响的断言**抽出来,用真实编译产物验证(本轮改为对已上线的姊妹页发请求,核对 SSR 输出里的星座跨界结论 6/6 正确)——这比反复戳弹层更有价值,因为文案里的事实断言错了是红线级问题,而 select 接线错了是一眼可见的表层问题。报告时如实说明哪条路径验了、哪条没验。
- **[2026-07-25] 多个知识库文件同时过期会制造"一致的错觉",跨文件一致 ≠ 事实**:birthstonemeaning 的 `plan.md`/`audit.md`/`baseline.md`/`infra.md` 四个文件全都写着"GSC 未接入、仅首页被索引",互相印证得毫无破绽——实际 GSC 三天前就接好了,sitemap 31 URL 状态成功,抽检页面全部已编入索引。根因:一处状态变更时没人回写全部引用点,而后续每次读取都在复制同一个陈旧事实。规矩:**凡是"外部系统的状态"(GSC 接没接、sitemap 收没收、页面收录没收录、外链上没上线),一律以实时查询该系统为准,知识库只当线索不当证据**;确认后必须把全部提到该状态的文件一次改完(grep 状态关键词找全引用点),否则下轮又会被同一批文件误导。
- **[2026-07-25] "已索引"和"有曝光"是两个独立诊断,别把权重问题当技术问题修**:新站常见形态 = 31 页全部被发现、抽检页面均"网页已编入索引"、无人工处置措施,但 GSC 效果报告里**只有首页拿到曝光、内页近乎为零、平均排名 30+**。这不是收录故障,继续修 canonical/schema/sitemap 是白费力气;它是 DR 0 的权重与"索引后观察期"共同作用。判读顺序:①URL 检查确认索引状态 → ②效果报告看曝光的**页面分布**(不是总量) → ③两者都正常才说明瓶颈在站外(外链/内容面积)。反之若"已索引但零曝光"持续 30 天以上且有外链进来,才回头查内容质量或意图错配。
- **[2026-07-25] GSC URL 检查只能走顶部输入框,且必须坐标点击**:`/search-console/inspect?resource_id=...&id=<明文URL>` 形式的深链一律 404(GSC 的 `id` 是内部不透明句柄,如 `OA4xThouN1b6yTnlqOtM6w`,无法自己构造)。唯一可靠路径 = 顶部"检查…中的任何网址"输入框;而该框用 `find` 返回的 ref 点击后**接收不到键入**(type 静默丢弃,页面毫无变化),必须先 `screenshot` 再按坐标 `left_click`,然后 type + `key: Return`,等 4-5s。同一 quirk 也适用于 GSC 的其他自定义控件——ref 点击失败时先怀疑它,别以为是选择器找错了。
- **[2026-07-25] `.rankup/plan.md` 的勾选框是滞后指标，激活 skill 后必须先做三方对账再答"接下来做什么"**:计划文件由人/agent 手动勾选,而代码由 commit 推进,两者必然漂移。开工第一步 = `git log --oneline -25` + 路由文件清单 + `sitemap.xml` 的 `<loc>` 全量,三方交叉才是真实交付状态。实证:birthstonemeaning 的 plan.md 把已部署上线的礼物查找器仍标为未完成(4 个 commit + 页面 + 导航 + CTA 组件 + sitemap 条目俱在),若直接照 plan 回答会让用户重做一遍已完成的工作。同类残留:仓库根的 `progress.md`/autopilot 状态文件在任务完成后不会自动清理,读到"⏳ 未开始"要先去代码里验证,别当成待办。对账后立即回写 plan.md,不要只在回复里口头更正。
- **[2026-07-21] 全站性能验收必须从 sitemap 枚举真实 URL，不能用首页或一次满分代表全站**:先按模板分组定位可传播的共性问题，再对 sitemap 全集跑生产双端报告；同时保存 FCP/LCP/TBT/CLS，不能只存总分。PageSpeed 是受测试节点、网络与部署传播影响的估算值：同一构建可在 TBT 0/150ms 间波动，旧 HTML 引用刚下线的哈希资源还会短暂制造 Best Practices 误报。正确裁决是先复核 CI、生产 HTML/资源与重复运行；只有可复现的资源、主线程或布局问题才改代码，不能靠刷新筛选漂亮截图，也不能承诺每次恒定 100。
- **[2026-07-30] 聚合型首页的品牌 Hero 应稳定表达整站主题，日期个性化留在次级组件**:首页服务完整品类或 Finder 时，用“今天/本月/当前星座”决定首屏主图，会让页面主题、品牌记忆和不同访客看到的视觉证据随请求漂移；固定的全品类主视觉更适合作为 LCP。仍有用的日期个性化可以保留在下方 CTA/结果卡，并把两条数据依赖拆开。验收要同时断言首页 raw HTML 不再出现动态 Hero 路径、个性化 CTA 的日期函数仍在、子实体详情页原 Hero 未受影响；图片还要用固定尺寸 + responsive `srcSet` + eager/high priority，避免把品牌一致性修复变成 LCP/CLS 回归。**换可见 Hero 时必须同步审计社交 Meta**：`og:image` / `twitter:image` 常仍指向旧默认图；为首页单独绑定 1200×630 分享图，不要顺手替换全站 fallback，并把 URL、尺寸、alt 与路由接线一起写进构建守卫。

## 六、自更新协议(每次使用后必须执行)

1. **何时写回**:本轮优化中出现以下任一情况 → 在【经验库】追加带日期的条目:被数据验证的新判断;某通道状态变化(token 失效/新 API/新坑);一个假设被证伪。
2. **什么不写**:未验证的猜测、一次性细节(具体某次的数字进 memory 不进 skill)、与现有条目重复的(改为更新旧条目日期与内容)。
3. **怎么写**:一条一行,`[日期] 结论:证据`。通道变化直接改【数据通道地图】对应行。条目超过 ~25 条时合并同类、删除过时。
4. **双层分流**:通用规则(剥离站点细节后对任意站点成立)→ 本文件【经验库】;项目专属(基线数据、词库、裁决、站点结构)→ 项目 `.rankup/` 对应文件并同步 INDEX.md;敏感信息(token/密钥)→ 只进用户级 memory,两层都不放。
5. 更新后不用请示 —— 这是本 skill 的设计意图,改完在回复里提一句"rankup 已沉淀 N 条新经验"即可。
