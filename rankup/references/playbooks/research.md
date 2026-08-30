# 调研流水线（预制 playbook）

**这个文件回答一件事：用户丢来一句模糊的话，从下一秒开始该跑哪几条命令、按什么顺序、哪些并行。**

`SKILL.md` 的 `<intent-routing>` 是**索引**（意图 → 某个文档），
[`capability-map.md`](../capability-map.md) 是**底账**（有哪些能力），
[`research-checklist.md`](../research-checklist.md) 是**验收单**（跑完了没有）。
三者都不告诉你「先跑哪个、再跑哪个、谁能并行」——那是本文件。

读完本文件里对应的一节，**不需要再读第二个文档就能开跑**。判读环节才回去读判据文档。

## 怎么用

1. 用户开口 → 进 [P0 分流器](#p0--分流器做个研究这类最模糊的说法)，**只问一个问题**（或干脆不问，见 P0）。
2. 落到 P1–P4 中的一条 → 跑它的 [阶段 0](#阶段-0-开工前-30-秒每条流水线都以它开头)，再照着阶段表往下走。
3. 每个阶段表的列固定是：**阶段 | 并行/串行 | 跑什么 | 拿到什么 | 卡住了怎么办**。
4. 「并行」= **一条消息里派多个 sub agent**（`SKILL.md` 执行纪律硬性要求）。
   「串行」= 上一阶段的产出是这一阶段的输入，或者它是配额站（见下方铁律三）。

### 路径变量（每个 sub agent 的 prompt 里都要带上这两行）

```bash
RANKUP=~/.agents/skills/rankup        # 本仓库开发时 = <repo>/rankup
BACKLINK=~/.agents/skills/backlink    # 本仓库开发时 = <repo>/backlink
```

**为什么必须写全路径**：Semrush / Similarweb / Tools Share 那一组脚本住在
`$BACKLINK/scripts/`，**不在 rankup 里**。`research-checklist.md` 第三～七节
写的是裸文件名（`semrush-keyword.mjs`），照抄会 `MODULE_NOT_FOUND`。

---

## 三条贯穿全部流水线的铁律

| # | 铁律 | 违反后长什么样 |
|---|---|---|
| 1 | **脚本只采集，判决由你下。** 2026-08-30 三波重构后，`revenue-site-audit` 不再出 verdict、`site-network` 不再出 strength、`keyword-value` 不再出 low/normal/high、`similarweb-query` 的 `belowFloor` 已改名 `noDataTextObserved`（观测事实，不是判决）。 | 把脚本某个字段当结论抄进报告，而那个字段现在只是「页面上写了一句话」 |
| 2 | **看到 0 条或空表，先开 `manifest.json`。** 落点 `.rankup/evidence/demand/<脚本>-<时间戳>/`。`sources` 里有任何一条非 `ok`，这次运行就不能当「真没需求」的证据；全 `ok` 且 `rawCount:0` 才允许读成真空态。 | 429 / CAPTCHA / 改版 / 超时全都产出 0 条，被写成「这个方向没人做」 |
| 3 | **一个配额工具只许有一个采集器。** Semrush / Similarweb 会话名固定（`semrush-nav` / `similarweb-nav`），**不要传 `--session`**；因此**同一时刻只能有一个 sub agent 在跑面板**。零配额源可以随便并行。 | 三个 agent 同时开 Similarweb → 触发上限，三个都拿不到数，且不报错 |

---

## 阶段 0 开工前 30 秒（每条流水线都以它开头）

**串行，主线自己跑，不派 agent。** 30 秒，决定后面整场调研的规模。

```bash
# ① seo.web.cafe 档位（脚本会自动把配额打在第一行）
node $RANKUP/scripts/seo-webcafe.mjs tools 2>&1 | head -3

# ② 有哪些钥匙（决定哪些脚本今天能跑）
cut -d= -f1 $RANKUP/.env 2>/dev/null; env | grep -oE 'SERPER_API_KEY|GITHUB_TOKEN|GH_TOKEN|PRODUCTHUNT_TOKEN|REDDIT_CLIENT_ID|IGDB_CLIENT_ID|TABAPI_KEY'

# ③ 面板节点（只在这一轮确实要用 Semrush/Similarweb 时才跑，它自己不耗配额）
node $BACKLINK/scripts/tools-share-node.mjs list --tool semrush
node $BACKLINK/scripts/tools-share-node.mjs list --tool similarweb
```

**为什么是第一个动作**：2026-08-22 真实事故——整场调研按「匿名 10 次/日」规划、省着用、
少测 4 个词、报告写成「配额耗尽无法验证」，账号其实是 VIP 500/日、当天只用了 66 次。

**钥匙缺失时的降级路线（照抄，不要现想）**：

| 缺的钥匙 | 谁受影响 | 换成什么 |
|---|---|---|
| `SERPER_API_KEY` | `demand/serp-query.mjs` 完全跑不了 | `seo-webcafe.mjs serp --keyword "<词>"`（计 1 配额）；盘面构成仍以阶段 1 的人眼实勘为准 |
| `GITHUB_TOKEN` | `github-skill-search --mode code/recent` 不可用 | `--mode repo`（无 token 可跑）；`github-trending --source trending` 不受影响 |
| `PRODUCTHUNT_TOKEN` | 无 | `boards.mjs producthunt` 自动降级浏览器路径，**浏览器路径本来就更全** |
| `REDDIT_CLIENT_ID` | `reddit-wishes` 没有 score | 自动降级 RSS，能跑但慢（`--delay` 别低于 6000） |
| `IGDB_CLIENT_ID` | `game-newtitles --source igdb` | 换 `--source steam` / `steam-featured` / `itch` / `poki` |
| `TABAPI_KEY` | 无 | `aitdk-lookup` 默认 `--provider webcafe`，免费（但吃 seo.web.cafe 共享配额） |

**Similarweb / Semrush 的配额读数只在面板启动那一次刷新**，之后会话复用就不再刷新。
所以整场调研要用多少次面板，必须在阶段 0 定死，不能边跑边加。

---

## P0 · 分流器（「做个研究」这类最模糊的说法）

### 触发

「做个研究」「帮我调研一下」「看看有什么能做的」「研究一下这块」「随便挖挖」

### 产出

一次分流判断 + 直接进入 P1/P2/P3/P4 中的一条，**同一轮对话内就开始跑阶段 0**。
不产出「请问您想……」的选项清单。

### 分流规则：按「用户给了什么输入」判，不要按他说的名词判

**唯一判据**：把用户那句话里**他交给你的东西**（词 / 域名 / 词表 / 站）挑出来，
按下表落点。**他说出口的名词往往是他要的结果，不是他给的输入**——
「帮我调研下关键词」里的「关键词」是**结果**，他手上一个词都没有，所以走 P1。
这条判据与 `SKILL.md`「用户手上有什么」那条、[`INDEX.md`](INDEX.md)「选哪条」表**必须三处一致**；
读到不一致，以本表为准并当场把另外两处改齐。

| 用户交给你的输入 | 直接去 | 不要问 |
|---|---|---|
| **一个具体的词 / 一句话意图**（"kd 这个词能做吗"、"想做个 PDF 转换的站"） | [P2](#p2--这个词--这条赛道能不能做) | 别问"您想了解哪方面"——先跑 KD |
| **一个域名 / 一个竞品 / 一个帖子链接**（"这站月入 5k 真的吗"、"查查这个站"） | [P4](#p4--竞品调研--反查谁在赚钱) | 别问"要查哪些指标"——四件套全跑 |
| **一批词 / 一个词根 / 已有词表**（"帮我扩词"、"围绕 converter 挖长尾"） | [P3](#p3--研究长尾词--扩词) | 别问"要多少个词" |
| **一个已有站**（"我这站还能做什么词"） | [P3](#p3--研究长尾词--扩词)，从 [阶段 0.5](#阶段-05--种子从哪来必跑一个种子都没给时就靠它) 反推种子后进阶段 1A | 别问"你主打哪些词" |
| **什么都没有**（"不知道做什么"、"最近有什么能做的"） | [P1](#p1--挖需求--找方向--不知道做什么) | — |

#### 三种最容易判反的形态（实测就栽在这三句上）

| 用户原话 | 他给了什么 | 落点 | 为什么不是另一条 |
|---|---|---|---|
| 「**帮我调研下关键词**」「找几个关键词」 | **什么都没有**。「关键词」是他要的产出 | **P1** | 不是 P3：P3 是「已经有一批词/一个方向，再往外扩」；这里连方向都没有，扩词无从下手 |
| 「**研究下长尾词**」「帮我扩词」「词表还能补什么」 | **一个扩词动作**（哪怕没给种子） | **P3** | 不是 P1：他已经锁定「在既有盘子里往外扩」这个动作。**没给种子不构成回退到 P1 的理由**——走 P3 [阶段 0.5](#阶段-05--种子从哪来必跑一个种子都没给时就靠它) 把种子挖出来 |
| 「**review 一下我这个网站**」 | **一个站**（哪怕没说域名） | 不在本文件——走 [`site-review.md`](site-review.md) 第一节 | 不是 P4：P4 是反查**别人**的站；这句的宾语是他自己的站，要的是体检不是竞品情报。**没说域名不构成反问的理由**，走那边的阶段 0.0 |

**共同的错误形状**：因为「他没给我 X」就退回去问一句。
**没给 X 时的正确动作是去把 X 挖出来**——P3 阶段 0.5 和 site-review 阶段 0.0 就是为此存在的。

### 只有一个问题值得问，且只在最后一行才问

> **「有没有已经想好的方向、词根或者感兴趣的领域？有的话给我一个；没有的话我直接开跑。」**

**问法纪律**：这句话和阶段 0 的自检**同一条消息发出**，不等回答就开始跑阶段 0 和 P1 的第一小时子集。
用户回了就切到 P2/P3，没回就沿 P1 跑下去。**不许把这个问题当阻塞点**——
`SKILL.md` 执行纪律：「不请示、不确认、不汇报选项」。

### 收尾

分流结论一行记进 `.rankup/decisions.md`：走了哪条 playbook、依据是用户话里的哪个信息。

---

## P1 · 挖需求 / 找方向 / 不知道做什么

### 触发

「不知道做什么」「找几个关键词」「挖点需求」「最近有什么能做的」「找个新方向」
「挖个新词的工具站」「有什么能做的方向」「找选题」「市场探测」「选品调研」

### 产出

1. `.rankup/decisions.md` —— 1–3 个候选方向，每个带：主词 + 支撑词矩阵（KD / 月搜 / CPC / SERP 盘面摘要）、竞品真实流量（Similarweb + Semrush **各标口径**）、收入估算区间、开发复杂度、量化的继续/停止标准。
2. `.rankup/keywords.md` —— 候选词表，每行带来源脚本 + 日期。
3. `.rankup/checks.md` —— [`research-checklist.md`](../research-checklist.md) 那张检查矩阵，逐项打勾。
4. **被排除的方向 + 排除理由（带数据）** 和 **数据局限性声明**（哪些没取到、为什么）——这两项不是可选的，见 research-checklist 第九节。

### 流水线

#### 第一小时最小可执行子集（面对 23 个脚本不要发呆，先跑这 6 个）

**全部零配额、零登录、零钥匙**，可以在**一条消息里派 6 个 sub agent 并行**。

| 阶段 | 并行/串行 | 跑什么 | 拿到什么 | 卡住了怎么办 |
|---|---|---|---|---|
| 1a | **并行 A** | `node $RANKUP/scripts/demand/stripe-referring.mjs top --new-only --limit 40 --json --out /tmp/r/stripe.json` | 本月**新进榜**的 Stripe 引荐域名 = 最强的「新机会」信号 | 不计配额，几乎不会失败；空了看 `months` 子命令确认榜单月份 |
| 1b | **并行 A** | `node $RANKUP/scripts/demand/boards.mjs trustmrr --board growth --limit 40 --json --out /tmp/r/mrr.json`<br>`node $RANKUP/scripts/demand/boards.mjs traffic-cv --type traffic --tab new --json --out /tmp/r/tcv.json` | TrustMRR 是 **Stripe 实连**（唯一能当数字用的收入源）；traffic.cv 是定性信号 | 需真实浏览器过 CF 质询，不需登录。失败带 `--keep-open` 保住现场 |
| 1c | **并行 A** | `node $RANKUP/scripts/demand/boards.mjs taaft --board requests-top --pages 2 --json --out /tmp/r/wish.json` | 许愿区**按票数排**——真实需求信号最强的一档 | 同上，CF 质询 |
| 1d | **并行 A** | `node $RANKUP/scripts/demand/reddit-wishes.mjs --subreddit SaaS,startups,SideProject,Entrepreneur --time month --limit 40 --json --out /tmp/r/reddit.json` | 用户**原话**（可直接当页面标题用） | 没 token 会走 RSS，`--delay` 别低于 6000，否则 429 |
| 1e | **并行 A** | `node $RANKUP/scripts/demand/hn-signals.mjs --mode ask --days 14 --limit 40 --json --out /tmp/r/hn.json`<br>`node $RANKUP/scripts/demand/github-trending.mjs --since weekly --limit 30 --json --out /tmp/r/gh.json` | 痛点讨论 + 唯一公开的 star 增速信号 | HN 走 Algolia，稳；GitHub trending 是公开 HTML |
| 1f | **并行 A** | `/anysearch` → `python3 ~/.agents/skills/anysearch/scripts/anysearch_cli.py batch_search --query "site:turbo0.com new tools" --query "huggingface trending spaces this week" --query "indie hackers revenue milestone 2026" --max_results 10` | 覆盖 **capability-map「手工源」表**里 turbo0 / IndieHackers / HuggingFace Trending / Arena.ai 那几行——它们**没有脚本**，此前只能靠人 | 匿名可跑（已实测）；要更高频率再配 `ANYSEARCH_API_KEY` |

**合流（串行，主线做）**：

```bash
mkdir -p /tmp/r && cat /tmp/r/*.json | jq -r '..|.domain? // empty' | sort -u > /tmp/r/candidates.txt
wc -l /tmp/r/candidates.txt
```

#### 第二小时起：候选池 → 域名画像 → 阈值初筛

| 阶段 | 并行/串行 | 跑什么 | 拿到什么 | 卡住了怎么办 |
|---|---|---|---|---|
| 2 | **串行**（吃 seo.web.cafe 共享配额） | `node $RANKUP/scripts/demand/aitdk-lookup.mjs --file /tmp/r/candidates.txt --out /tmp/r/profiles.jsonl --limit 60` | 每个域名的**注册日期 / 站龄 / 月访问 / 流量结构 / DR / 核心搜索词** | 带 `✗ HTTP 429/403` 的行 = 配额耗尽或被挡，**不是「该站没数据」**。加 `--via browser` 换高档配额，或次日重跑（`.jsonl` 可续跑，已取到的会跳过） |
| 3 | 串行，主线判读，**不跑脚本** | 对 `/tmp/r/profiles.jsonl` 套 [`demand-sources.md`](../demand-sources.md) 十·「常用的筛选阈值」：注册 <1 年 / 月访问 >3,000 / 搜索占比 >20% / 直接访问占比 >20% | 通常 60 个域名剩 0–2 个（**实测命中率约 300:1**，剩 0 个是正常结果，不是失败） | 剩 0 个 → 回阶段 1 换榜单源再来一轮，**不要放宽阈值**。阈值是可调的，但调之前要写明为什么调 |

#### 第三段：入选候选逐个走验证链路 → 进 P2

| 阶段 | 并行/串行 | 跑什么 | 拿到什么 | 卡住了怎么办 |
|---|---|---|---|---|
| 4 | **并行 B**（零配额那半） | 每个入选域名派一个 agent：<br>`node $RANKUP/scripts/demand/sitemap-diff.mjs --domain <域名> --all --slug-words --top-words 40`<br>`node $RANKUP/scripts/demand/site-network.mjs --domain <域名> --confirm --max 10 --json` | 它铺了哪些词族（slug 词频）、它背后还有哪些兄弟站 | `site-network` 空结果读成「这条路没找到」而不是「它没有兄弟站」——实测某组 10 个兄弟站没有一个共享指纹，绑住它们的是同一个 `utm_source` |
| 5 | **串行 · 独占面板**（铁律三） | **一个** agent 顺序跑完全部入选域名：<br>`node $BACKLINK/scripts/similarweb-query.mjs --domain <d> --report performance --out sw-<d>.json`<br>`node $BACKLINK/scripts/semrush-traffic.mjs --domain <d> --out semt-<d>.json`（**总访问口径，用来和上一行并排**）<br>`node $BACKLINK/scripts/semrush-overview.mjs --domain <d> --db us --out sem-<d>.json`（自然搜索口径，**不能和总访问裸比**） | 真实总访问、渠道构成 / 两家的总访问口径互证 / 单国家库自然流量 | `stable:false` 会直接抛错而不是给最后一次读数（**静默的错数比显式超时坏**）。失败前脚本已 `captureScene` 落截图+DOM 进 `--evidence-dir`，先开现场再下结论 |
| 6 | 与 5 并行（不同工具，不冲突） | `python3 $RANKUP/scripts/gt.py compare "<词1>" "<词2>" --geo US --time 12m` | 方向在涨还是在跌 | **全组连坐**：compare 里有一个词太冷，**整组**返回「没有数据」。处理顺序：先跑必然有量的词 → 逐个单跑 → 只把有量的进 compare。一次最多 5 个词 |
| 7 | 串行，本地零配额 | `node $RANKUP/scripts/seo-webcafe.mjs money --income 1000 --kws 5 --kd 30` | 目标收入需要多少 UV / 日搜索量 / 外链投入 / ROI | 纯本地计算，不会失败 |
| 8 | 串行 | 把每个存活候选交给 [P2](#p2--这个词--这条赛道能不能做) 走四道闸 | 立项 / 否决 | — |

### 判读（每个阶段的结果对照哪份文档的哪一节）

| 阶段 | 判据在 |
|---|---|
| 1a/1b 收入信号 | [`demand-sources.md`](../demand-sources.md) 二「收入数字该信谁」：**TrustMRR 是 Stripe 实连（能当数字用），traffic.cv 是定性信号，Toolify 只说明「在收钱」**。三家域名集合几乎不相交，是互补候选池 |
| 1c/1d 用户原话 | [`experiences/demand-discovery.md`](../experiences/demand-discovery.md) 四·3「许愿句式」+ 四·2 高价值关键句（最值钱的一句是 `"I love this extension, but..."`） |
| 2/3 域名画像与阈值 | [`demand-sources.md`](../demand-sources.md) 十·「常用的筛选阈值」+ ②·五「低 DR 站先查域名年龄」——**年龄 9–18 个月的高流量站是最强信号；<6 个月的低流量什么都不说明**（还在蜜月期） |
| 4 站群 | [`demand-sources.md`](../demand-sources.md) 九·二那张 strong/medium/weak 指纹表（**那是给你的判读指引，不是脚本输出**）。价值在「哪几个做成了、哪几个没跑起来」，后者才是机会 |
| 5 两个面板打架 | [`demand-sources.md`](../demand-sources.md) **②·六·四**：先拉排名词分布再决定信不信总数。第一大词占比 <20% 可信；**>50% 且位次 #5–#10 → 按高估 4–13 倍处理，以面板为准**；只有一套数时标「未验证」 |
| 6 趋势 | [`trends.md`](../trends.md) 〇「0-100 是组内归一化，必须双锚」——实测两个锚点系数差 1.33 倍，**Trends 相对刻度约 ±30% 失真，单锚必须报区间** |
| 7 折成钱 | [`demand-sources.md`](../demand-sources.md) **十·五**：低进入门槛恰恰是坏消息（没有护城河）；新进入者时间线在**加速**要读成「淘金潮末段」 |
| 元规则 | [`experiences/demand-discovery.md`](../experiences/demand-discovery.md) 〇「取数失败会伪装成一个否定答案」——**只有零需要被证明是零**：决定生死的零，必须换一种调用方式复查到两次一致 |

### 省配额

| 档位 | 这条链路里的谁 | 代价 |
|---|---|---|
| **零配额，放开跑** | 1a stripe-referring · 1e hn-signals / github-trending · 1f anysearch · 4 sitemap-diff / site-network · 6 gt.py · 7 money · `seo-webcafe.mjs kgr/string/money/email` | 只花时间。**并行度只受机器限制** |
| **零配额但要真浏览器**（过反爬，不需登录） | 1b boards trustmrr/traffic-cv · 1c taaft · reviews-mine 的 trustpilot/g2/capterra · chrome-stats | 每个源一个**描述性会话名**，跑完 `opencli browser <session> close`。sub agent 退出前必须显式关 |
| **吃 seo.web.cafe 共享池**（游客 10 / 登录 100 / VIP 500 每日） | 2 aitdk-lookup（每域 1）· `kd`（每词 1，7 天缓存内免费）· `serp`（每次 1）· `payment-referrers serp`（每查询 1） | **整场规模在阶段 0 定死**。`--batch` 走保险丝间隔 |
| **面板配额，一次一个采集器** | 5 similarweb-query / semrush-overview / semrush-report / similarweb-keywords | 会话名固定，**不许并行**。`similarweb-batch` 单域 6–10 秒，可续跑 |
| **要钱的** | `aitdk-lookup --provider tabapi`（按 credit）· `serp-query`（serper 付费额度） | 有免费替代就别用：aitdk 默认 provider 是免费的 webcafe |

### 收尾

- 候选词表 → `.rankup/keywords.md`（每行带来源脚本 + 日期 + 引擎/国家）
- 方向级结论、排除理由、数据局限性 → `.rankup/decisions.md`
- [`research-checklist.md`](../research-checklist.md) 的检查矩阵复制进 `.rankup/checks.md` 并逐项打勾：
  **全部必做项 + 全部应做项 + 至少 3 个按需项**打完才算调研完成
- 证据目录留在 `.rankup/evidence/demand/`，**不要清理**——manifest 是下一轮判读的唯一依据

---

## P2 · 这个词 / 这条赛道能不能做

### 触发

「这个词能不能做」「这词难不难」「值不值得进」「这条赛道有机会吗」「KD 才 12，能做吗」
「我想做个 XX 的站，行吗」

### 产出

一份**四道闸的逐闸判决**写进 `.rankup/decisions.md`：每道闸的读数、过没过、依据的判据出处；
以及最后一句「能排上去」与「排上去能赚多少钱」的**分开回答**。

### 流水线

**这条链路有四道闸。前三道回答「能不能排上去」，第四道回答「排上去值不值」——
只跑前三道会得出一个 SEO 上完全正确、商业上完全错误的结论。**

| 阶段 | 并行/串行 | 跑什么 | 拿到什么 | 卡住了怎么办 |
|---|---|---|---|---|
| 0 | 串行 | [阶段 0](#阶段-0-开工前-30-秒每条流水线都以它开头) | 档位与钥匙 | — |
| **1 · 亲眼看**（在任何取数之前） | **并行 C**，每个引擎一个 agent | 沙箱浏览器（公开搜索**不需要**登录态，这是少数可以用沙箱的场景），**无痕/隔离窗口 + 显式 `gl`/`hl`**：<br>Google `?q=<词>&gl=us&hl=en`<br>Bing `?q=<词>&mkt=en-US`<br>Brave（第三个**独立**索引）<br>目标市场本地引擎（Naver / Yandex / 百度 / Seznam），非英语市场必做 | 每个引擎的**七样**：前十页面类型构成 / 有几个是专门为该词做的页面 / 最弱占位者长什么样 / SERP 特性占几屏 / 有没有 AI 答案及引用了谁 / 广告几条谁在投 / 有没有独立站空位 | **DuckDuckGo 不是独立样本**（网页结果主要来自 Bing 索引），两边一致不构成交叉验证。<br>**不要用二手 SERP 接口代替这一步**：2026-08 起 Google 把出站链接换成 `google.com/goto` 跳板，二手通道会降级而接口照样回 200 |
| **2 · 闸一：量** | 串行（面板） | `node $BACKLINK/scripts/semrush-keyword.mjs --kw "<词>" --db us --out kw.jsonl` | US Volume、**`globalVolume`**、KD、CPC、竞争密度、意图、`byCountry` | **`--db` 别省**——不传会默默落到 `jp`，一个英文词查出来的是「日本市场当英文词搜」的量，看着合理实际错了。<br>要全球规模读 `globalVolume`，**不要拿 `byCountry` 加总替代**（那只是 Top-N，往往到不了一半）。<br>`volume:0 + noData:true` 是**结果不是故障** |
| **3 · 闸二：KD** | 串行（seo.web.cafe，每词 1） | `node $RANKUP/scripts/seo-webcafe.mjs kd --keyword "<词>" --gl us` | KD 分、top 9 盘面（DR / 首页内页 / 专营非专营）、引用域中值、`linkBudget`、`keywordTrend` | 摘要行印出「月搜 —」**不是「未知，先按 KD 走」，是停止信号**（见 [`seo-webcafe.md`](../seo-webcafe.md) 对应两节）。7 天结论缓存，`--force` 强制重算但**仍计配额** |
| **4 · 闸三：SERP 盘面** | 串行 | 有 `SERPER_API_KEY`：`node $RANKUP/scripts/demand/serp-query.mjs "<词>" --gl us --json`<br>没有：`node $RANKUP/scripts/seo-webcafe.mjs serp --keyword "<词>"`（计 1） | 精确/部分域名命中数、首页数、内页数、relatedSearches、PAA | 这是**计数不是结论**。盘面的定性判断以阶段 1 的人眼实勘为准，本阶段只补可比的数 |
| **4.5 · 低 DR 站分叉**（盘面里出现 DR 0–3 首页时**必跑**） | **并行 D** | 对每个低 DR 首页：<br>`curl -s https://rdap.verisign.com/com/v1/domain/<域名> \| jq -r '.events[]\|select(.eventAction=="registration").eventDate'`<br>再 `node $RANKUP/scripts/demand/aitdk-lookup.mjs <域名>` | 注册日期 + 真实流量 | **`dr: null` 不是 `dr < 10`**。把 null 计入低 DR 会凭空造出机会 |
| **5 · 闸四：折成钱**（不能跳过） | 串行 · 独占面板 | ① 一个 agent 顺序跑同类站：<br>`node $BACKLINK/scripts/similarweb-query.mjs --domain <竞品> --report performance`<br>`node $BACKLINK/scripts/semrush-report.mjs --report organic-positions --domain <竞品> --db us`<br>② 本地折算（零配额）：<br>`node $RANKUP/scripts/seo-webcafe.mjs money --income <目标$> --kws <词数> --kd <KD>` | 同类站**面板真实流量**（不是模型流量）→ 折成收入区间；以及达到目标收入需要的 UV / 日搜索量 / 外链投入 / ROI | 面板 `noDataTextObserved:true` 是**观测事实**（页面正面渲染出「没有此网站的数据」且连读三次一致），不是「查不到」，更不是「流量小」 |
| 6 | 串行，本地 | `node $RANKUP/scripts/seo-webcafe.mjs kgr --volume <月搜> --intitle <allintitle 数> --kd <KD>` | KGR / EKGR / KDROI | 纯本地零配额，可 `--batch` 批量 |
| 7 | 与 5 并行 | `python3 $RANKUP/scripts/gt.py compare "<词>" "<参照词>" --geo US --time 5y`<br>`python3 $RANKUP/scripts/gt.py related "<词>" --geo US` | 是不是季节尖峰、rising 飙升词 | 见 P1 阶段 6 的全组连坐 |

### 判读

| 闸 | 判据在 |
|---|---|
| 闸一（量） | [`demand-sources.md`](../demand-sources.md) **②·六·四**（模型流量何时高估）+ [`seo-webcafe.md`](../seo-webcafe.md)「读 `kd` 的输出：月搜量必须配捕获率一起看」「`volume:0/noData:true` 本身也可能是假的——**零必须复查**」 |
| 闸二（KD） | [`experiences/webcafe-topics.md`](../experiences/webcafe-topics.md) 一~二：**低 KD 不等于能做；词龄 >30 天且竞品域名 >20 天要考虑放弃**。[`trends.md`](../trends.md) KD 解读：`score` <40 且 `keywordVolume` >1000 = 高价值蓝海；`score` >70 且无新站信号 = 淘汰；**月搜 <500 直接否** |
| 闸三（盘面） | [`demand-sources.md`](../demand-sources.md) 一·五「SERP 盘面怎么读」：**domainMatch 是启发式不是事实**；精确域名命中多 → 成熟小生态，**难度分往往低估**；首页多 → 新站难插入，内页多 → 有缝；只看前十，第二页之后没有解释力。<br>四类必须直接否掉的形状（[`demand-discovery.md`](../experiences/demand-discovery.md) 二·SOP 第 6 步）：搜索目标不可替代 / 搜索引擎自己就出答案 / 季节尖峰 / 对抗性工具。<br>**所有引擎首页都是新闻影视赛事成人内容 → 需求真实但不是工具需求，直接否** |
| 闸三·分叉 | [`demand-sources.md`](../demand-sources.md) **②·五**：<6 个月的低流量什么都不说明（蜜月期）；**9–18 个月的高流量是最强信号**；>3 年的高流量说明不了新站可复制性。**真正的打法藏在竞品的实际取词里，不在你一开始盯的头部词上** |
| 闸四（钱） | [`demand-sources.md`](../demand-sources.md) **十·五** + [`demand-discovery.md`](../experiences/demand-discovery.md) 八·第六条：全绿指标下同类站真实流量几百–八千/月 = **$20–100/月**。搜索量→流量→收入两次折损各一个数量级 |
| 本地数值 | [`seo-webcafe.md`](../seo-webcafe.md)「本地命令数值判读指引（脚本只出数，评级在这里）」 |

### 省配额

一个词跑完全套 = **seo.web.cafe 约 2 次**（`kd` 1 + `serp` 1，若无 serper）+ **面板约 2–4 次**（每个竞品域名 1–2）。

- **初筛阶段用 bulk**：`semrush-keyword.mjs --kw-file words.txt --bulk --db us`（同国家最多 100 词/次）。
  但 **bulk 模式没有 `globalVolume` 也没有 `byCountry`**——入选词必须回单词模式补跑。
- **`kd` 有 7 天缓存**：同一个词一周内重跑不额外扣。别为了「刷新一下」加 `--force`。
- **`kgr` / `money` / `string` / `email` 是纯本地**：零网络零配额，`--batch` 随便跑。
- 阶段 1 的人眼实勘**完全不花配额**，而它是最重要的一道。省配额时优先砍二手 SERP，不砍实勘。

### 收尾

写进 `.rankup/decisions.md`，格式固定为四行：

```
闸一 量：<globalVolume> / <db>=<volume>（口径：Semrush <db> 库，YYYY-MM-DD）→ 过/不过
闸二 KD：<score>，top9 中位引用域 <n>，最弱位是 <描述> → 过/不过
闸三 盘面：Google <国家> 前十 <n> 个专门页 / Bing <n> 个；最弱位 <描述>；AI 答案引用 <域名列表> → 过/不过
闸四 钱：同类站面板真实流量 <区间>/月（Similarweb 全球总访问，YYYY-MM）→ 折 $<区间>/月 → 过/不过
```

**四道闸任何一道没跑，结论里必须写「未验证」，不许留空**（留空会在下一轮被当成过了）。

---

## P3 · 研究长尾词 / 扩词

### 触发

「研究一下长尾词」「帮我扩词」「围绕 XX 挖点词」「我只有一个词根」「这批词还能再扩吗」
「我这站还能做什么词」

### 产出

1. `.rankup/keywords.md` —— 收敛后的词表，每行：`词 | 月搜 | KD | CPC | 意图 | 簇 | 来源 | 日期 | 口径(db/geo)`
2. 一个**按量加权的 CPC**（扩词前 / 扩词后各一个）——见判读，这是唯一能揭穿「盘子更大了」这个假好消息的数字
3. **差集报告**：自己扩的 vs 竞品实际排名词，缺的那三类构词各补了多少

### 流水线

**扩词有两条腿，缺一条必漏一半。** 腿 A 是自己按构词模式扩；腿 B 是反查竞品实际排名词库。
[`demand-sources.md`](../demand-sources.md) 九·六 实测：只跑腿 A，**整整三类构词一个都没有**
（泛型入口词、问句/信息词、口语与拼写变体），补上后同难度档的池子从几十词翻到一百多词、量接近翻倍。

#### 阶段 0.5 · 种子从哪来（必跑：一个种子都没给时就靠它）

**「研究下长尾词」这句话里通常一个种子都没有。**「没给种子」不是回退到 P1 的理由，
也不是反问的理由——下面这条回退链把种子挖出来。**按顺序走，任何一档拿到 ≥3 个种子就停，
往下走阶段 1A。**六档里前五档都不需要用户开口，只有全落空才允许问那一个问题。

| 档 | 前提 | 跑什么 | 拿到什么 | 拿不到就下一档 |
|---|---|---|---|---|
| **a · 项目已有词表** | 在一个项目根里 | `test -f .rankup/keywords.md && head -80 .rankup/keywords.md` | 标「做」的那些词，直接就是种子；同时看到口径与日期 | 文件不存在 / 全是 ⬜ → b |
| **b · 项目定位** | `.rankup/` 存在 | `head -60 .rankup/PROJECT.md`；再 `head -40 .rankup/INDEX.md` | 定位与目标用户里的名词短语（"PDF 转换"、"简历模板"）就是第一版种子 | `.rankup/` 不存在 → c |
| **c · 站点自己在打什么词**（**主力档**，和 [`site-review.md`](site-review.md) D1 同一招） | 手上有站点地址；**没有就先去 [`site-review.md` 阶段 0.0](site-review.md#阶段-00--站点地址从哪来先取址再体检)取址** | `node $RANKUP/scripts/seo-audit.mjs --sitemap <sitemap> --json > /tmp/k/audit.json`（**没有 `--out`**，用重定向）<br>`jq -r '.[].overview.title.text // empty' /tmp/k/audit.json \| sort \| uniq -c \| sort -rn \| head -30`<br>`jq -r '.[].headings[]? \| select(.level==1) \| .text' /tmp/k/audit.json \| sort \| uniq -c \| sort -rn \| head -30`<br>再 `node $RANKUP/scripts/seo-audit.mjs --sitemap <sitemap> --density-only`（全站聚合的 1/2/3-gram） | 全站 title/h1 里反复出现的名词短语 + 高频 2/3-gram = 站点**实际在打**的词 | 没有 sitemap 时改逐页：`node $RANKUP/scripts/seo-audit.mjs <url1> <url2> … --json`。全站抓不动 → d |
| **d · 从域名反查**（只有一个域名时） | 手上有域名 | `node $RANKUP/scripts/demand/sitemap-diff.mjs --domain <域名> --all --slug-words --top-words 40`（零配额）<br>`node $RANKUP/scripts/seo-webcafe.mjs mineSeed --input <站点URL>`（**不计配额**，网址也吃）<br>还不够再 `node $RANKUP/scripts/demand/aitdk-lookup.mjs <域名>`（**每域 1 配额**，出「核心搜索词」） | slug 词频里的词族 + 域名画像给的核心搜索词 | 全部空 → 先按 [铁律二](#三条贯穿全部流水线的铁律)开 manifest 分辨「采集失败」还是「站真的没内容」，再 e |
| **e · 转 P1 自造种子**（连项目和域名都没有时） | 什么都没有 | 直接跑 [P1 的第一小时子集](#第一小时最小可执行子集面对-23-个脚本不要发呆先跑这-6-个) 1a–1f（**全部零配额零登录，一条消息六个 agent**），从榜单候选域名里挑 3–5 个同赛道站，再回本表 d 档对它们做 slug 词频 | 从真实需求信号里长出来的种子 | 这一档**不会失败**——1a/1e/1f 几乎不依赖任何前提 |
| **f · 只剩这一档才问** | 上面五档全落空 | 发一句话，**同一条消息里阶段 0 和 e 档的 P1 子集已经在跑**，不等回答：<br>「给我一个词根或者一个网址就行；没有的话我按 `<c/d/e 档里最像的那个方向>` 先跑一轮。」 | 一个种子，或者用户默认你的猜测 | 用户不回 → 按你自己反推出的方向跑下去，**不许停在这里等** |

**a–e 档全部零配额或不计配额**（唯一例外是 d 档的 `aitdk-lookup`，每域 1），
所以**没有任何理由跳过它们直接问用户**。

**反推出来的种子和用户给的种子不是一回事**：它是「这个站现在在打的词」，
不是「这个站应该打的词」。把它写进 `.rankup/keywords.md` 时标清来源是 `阶段 0.5-<档>` 与日期，
阶段 3 的竞品差集就是用来揭穿这批种子有多偏的——**别把反推种子当成已验证的词表**。

| 阶段 | 并行/串行 | 跑什么 | 拿到什么 | 卡住了怎么办 |
|---|---|---|---|---|
| 0 | 串行 | [阶段 0](#阶段-0-开工前-30-秒每条流水线都以它开头) | 档位与钥匙 | — |
| 0.5 | 串行 | 上表的回退链（**手上没有种子时必跑**） | ≥3 个种子词 / 词根 | 见上表最后一列 |
| **1A · 腿 A：本地扩** | **并行 E**（零配额） | `node $RANKUP/scripts/demand/word-roots.mjs list --grep <主题>`<br>`node $RANKUP/scripts/demand/word-roots.mjs expand <词根> --seeds a,b,c --target <词> --json \| jq -r '.[]."候选串"' > /tmp/k/roots.txt`<br>**别用 `--out`**：它落的是 JSON 对象数组，而下一步的 `--seed-file` 按「一行一个种子」的纯文本读——直接串起来会把 `[`、`{`、`"词根": …` 当成种子喂进面板，**返回空扩展词且不报错**（正是铁律二说的「0 条被读成没需求」，只不过病因在命令本身） | 51 条词根库 × 8 个模板（`x-root`/`root-x`/`online`/`free`/`ai`/`a-to-b`/`best`/`bare`）扩出的**候选串** | **扩出来的是候选串，不是关键词**——没有量也没有难度。「我扩出了 300 个词」当成「我找到了 300 个词」是这条路最常见的自欺 |
| **1B · 腿 A：自动补全** | **并行 E** | Alphabet Soup（**没有脚本，capability-map 手工源表第 6 行**）：<br>`for c in {a..z}; do curl -s "https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=<种子>%20$c"; done`<br>或 `/anysearch` 批量搜同一批前缀 | 26 个方向的下拉建议（直接输种子只给 8–10 个最热的） | 后缀法找修饰语/场景，前缀法找品牌名/形容词。**Amazon 上出现而 Google 不出现的词往往是高购买意图词** |
| **1C · 腿 A：多语言乘法** | **并行 E** | 把 1A/1B 的词根翻成目标语种再走一遍 | 「JSON 编辑器」而不是「JSON editor」 | **社群流传的词根库全是英文，这是整个社群共同的盲区**，也是目前最没被人挖的一片矿。这一步只有 agent 跑得动 |
| **2 · 面板扩词**（腿 A 的规模化出口） | **串行 · 独占面板** | `node $BACKLINK/scripts/similarweb-keywords.mjs --seed-file /tmp/k/roots.txt --tab relatedKeywords --out /tmp/k/kw.jsonl --jsonl`<br>（`--tab` 四选：`phraseMatch` 词组 / `relatedKeywords` **量最大** / `trending` / `questions` **专补问句那一类**） | 批量扩词。[`demand-discovery.md`](../experiences/demand-discovery.md) 记的规模是 **1,309 词根 → 97,681 关键词** | **只读当前页 100 行**，页面自报总量在 `shownTotal`，`complete` 明确告诉你读全了没有——不做静默截断。`table_never_settled` 会 captureScene 落现场，「表没稳定」和「这个词没有扩展词」必须对着现场分辨 |
| **2' · 另一条整包出口** | 串行 · 同一面板窗口 | `node $BACKLINK/scripts/semrush-report.mjs --report keyword-magic --keyword "<词>" --db us` | 整包词 + Topics 聚簇 | 与 2 是**互补**不是替代：Similarweb 给 relatedKeywords 广度，Semrush 给聚簇 |
| **3 · 腿 B：反查竞品词库**（必做，不是可选） | 串行 · 同一面板窗口（**一次装一堆，这是省配额的关键**） | ```S=semrush-recon```<br>对 **3–5 个同赛道、站龄 9–24 个月、已有排名的站**，每站前 100 词：<br>`node $BACKLINK/scripts/semrush-report.mjs --report organic-positions --domain <竞品> --db us --out pos-<竞品>.json` | 竞品实际排名词 → 与自己的池子做**差集** | **不知道竞品是谁时不要问用户**，按顺序取：① `node $BACKLINK/scripts/similarweb-query.mjs --domain <自己或任一同赛道域名> --report similar-sites`（面板，和本阶段同一个会话里顺手跑）；② 阶段 1B 主种子词的 Google 前十里那些**专门为该词做的独立站**；③ `node $RANKUP/scripts/demand/site-network.mjs --domain <已知竞品> --confirm --max 10 --json`（零配额）拿它的兄弟站。三条都空才降级成「只跑腿 A 并在收尾里标明差集未做」。<br>站龄选择很关键：<9 个月还在蜜月期，>24 个月的词库说明不了新站可复制性 |
| **4 · 差集补测** | 串行 | `node $BACKLINK/scripts/semrush-keyword.mjs --kw-file diff.txt --bulk --db us --out diff.jsonl` | 差集词的量与难度 | **被自己判过「太难」的头词尤其要测**——它常常就是竞品流量的主要来源。不要凭印象取舍 |
| **5 · 重算加权 CPC**（扩完必跑） | 串行，本地零配额 | `node $RANKUP/scripts/demand/keyword-value.mjs --in /tmp/k/kw.jsonl --json` | 每个词的 CPC、同批中位数、二者之比 | 脚本**只出数值**，不给 low/normal/high 档位名（2026-08-30 第二波重构已删 `level` 字段）。**`cpc:null` ≠ `cpc:0`** |
| **6 · 收敛：意图分类 + 聚簇** | 串行，主线判读 | `/keyword-research` —— **只用它的第 4 相（Classify 意图）和第 7 相（Cluster 聚簇）**，喂给它的是阶段 2–5 实测出来的量/KD/CPC | 意图标签（informational/navigational/commercial/transactional）+ pillar/cluster 结构 | **严禁跑它的第 5 相（Score）**：那个 skill 没有任何数据源，它的 difficulty 1-100 和 volume 是模型自己编的。rankup 出数字，它只出分类骨架 |
| 7 | 串行 | 收敛后的头部词逐个进 [P2](#p2--这个词--这条赛道能不能做) 走四道闸 | 立项词 | — |

### 判读

| 阶段 | 判据在 |
|---|---|
| 1A–1C | [`demand-sources.md`](../demand-sources.md) 九·五「两条必须一起记的约束」：候选串 ≠ 关键词；词根 × 语言的乘法 |
| 1B | [`demand-sources.md`](../demand-sources.md) 九·七「跨平台自动补全扩词」 |
| 3 差集 | [`demand-sources.md`](../demand-sources.md) **九·六** 那张「漏掉的三类构词」表 + 4 条操作规则 |
| 3 之后的品牌截流词 | [`demand-sources.md`](../demand-sources.md) 九·六 末「品牌截流词」：B2B SaaS **35–45% 的品牌 SERP 首页上有第三方内容**；`[brand] alternative/vs/review` **KD 通常很低**（竞品不会做自己的替代品页）。**限制**：只有产品确实能替代时才做，内容必须是真实对比 |
| 5 CPC | [`demand-discovery.md`](../experiences/demand-discovery.md) 八「CPC 怎么读」：**CPC 是 U 型不是越高越好**；参照系是**这批词自己的中位数**（实测 image converter 100 个词的 CPC 挤在 $0.9–1.1，保险/法律能到几十美元）。**扩完词加权 CPC 掉下来时，「盘子更大了」是个假的好消息** |
| 6 收敛目标 | [`demand-discovery.md`](../experiences/demand-discovery.md) 二·规模化版本心得 2：**不同目标不同阈值**。做「精品工具页 + 关键词域名」时是 KD 很低 / 搜索量不用高 / 有点 CPC 就行，**几千到一万出头的月搜就值得上**；做大站换一套 |
| 漫游筛选条件 | [`demand-discovery.md`](../experiences/demand-discovery.md) 二·SOP 第 3 步：排除 NSFW；**KD < 30（40 也可以看看）**；按量降序；有「搜索意图」字段的把**导航类去掉**（导航词抢不走） |

### 省配额

| 档位 | 谁 |
|---|---|
| **零配额** | `word-roots`（纯本地 JSON）· Google suggest（公开端点）· `/anysearch`（匿名可跑）· `keyword-value`（纯计算）· `seo-webcafe kgr` |
| **面板，一次一个采集器** | `similarweb-keywords`（每个种子一次页面加载，`--settle` 默认 18 秒）· `semrush-report --report keyword-magic` · `semrush-report --report organic-positions` |
| **省配额的关键动作** | **一次装一堆**：同一个 `--session` 常量下连续跑多个域名的报表，跑完再 `opencli browser $S close`。每次重开会话都要重走面板导航 |
| **bulk vs 单词** | 初筛用 `--bulk`（100 词/次），入选词才回单词模式补 `globalVolume` / `byCountry`。**bulk 下这两个字段恒为 null，不是「查不到」** |

### 与全局 `/keyword-research` 的分工（写死，别每次重想）

| 谁 | 出什么 | 不许出什么 |
|---|---|---|
| **rankup（本 playbook）** | 所有**数字**：量、KD、CPC、盘面计数、竞品词库、加权 CPC | — |
| **`/keyword-research`** | 意图分类骨架（第 4 相）、pillar/cluster 模板（第 7 相）、交付格式 | **任何量/难度/机会分**。它没有数据源，第 5 相 Score 的 `Opportunity=(Volume×IntentValue)/Difficulty` 里两个输入都是它自己编的 |

### 收尾

- 词表 → `.rankup/keywords.md`，**每行必须带口径**（`--db` 是哪个国家库、`geo` 是哪里、日期）
- 差集报告 + 扩词前后的加权 CPC 对比 → `.rankup/decisions.md`
- `.rankup/checks.md` 打勾 research-checklist 第七节 7.1–7.6 全部六项

---

## P4 · 竞品调研 / 反查谁在赚钱

### 触发

「谁在赚钱」「反查这个站」「他还做了哪些站」「帖子说月入 X 是真的吗」「竞品调研」
「他排了哪些词」「这站流量哪来的」「竞品最近在做什么」

### 产出

1. `.rankup/decisions.md` —— 一份**跨源对照表**：每个数字带来源面板 + 报告页 + as-of 日期 + 口径（全球/国家库、总访问/自然流量），**并排列出，不做算术运算**
2. 一句明确的 verdict（证实 / 部分证实 / 无法证实 / 反证）**由你下**，附判据出处
3. 站群清单（如果有）+ 每个兄弟站「做成了 / 做了没跑起来」的分类——**后者才是机会**

### 流水线

| 阶段 | 并行/串行 | 跑什么 | 拿到什么 | 卡住了怎么办 |
|---|---|---|---|---|
| 0 | 串行 | [阶段 0](#阶段-0-开工前-30-秒每条流水线都以它开头) | 档位与钥匙 | — |
| **1 · 钱的信号** | **并行 F**（全部零配额或不计配额） | `node $RANKUP/scripts/demand/stripe-referring.mjs site --domain <域名>`<br>`node $RANKUP/scripts/seo-webcafe.mjs referringSite --domain <域名>`（**不计配额**）<br>`node $RANKUP/scripts/demand/boards.mjs trustmrr --board mrr --limit 60 --json` | 该域名在 Stripe 引荐榜的**在榜轨迹**（31 个月历史）；TrustMRR 上有没有它 | 不在 Stripe 榜 ≠ 没收钱——可能用长尾网关，去阶段 1' |
| **1' · 长尾网关**（Stripe 榜没有它时） | 并行 F | `node $RANKUP/scripts/demand/payment-referrers.mjs list`<br>`node $RANKUP/scripts/demand/payment-referrers.mjs serp <网关> --max-queries 2` | Creem / Lemon Squeezy / Paddle / Gumroad 等网关的引荐站 | `serp` 走 seo.web.cafe，**每查询 1 次配额**，`--max-queries` 默认 2 就是为了省。逐 query 记状态进 manifest，**查询失败 ≠ 没人引用** |
| **2 · 域名画像** | 并行 F | `node $RANKUP/scripts/demand/aitdk-lookup.mjs <域名>` | 注册日期 / 站龄 / 月访问 / 流量结构 / DR / 环比 / 核心搜索词 | `✗ HTTP 429/403` = 被挡，不是没数据 |
| **3 · 站群反查** | 并行 F | `node $RANKUP/scripts/demand/site-network.mjs --domain <域名> --confirm --max 25 --json --out net.json` | 同一主体运营的其它站 + 共同指纹 + 回访状态 | 脚本**只记事实不裁定强弱**。`revisit=fetch_failed` = 这次没看到，不是不共享指纹。**「无共同指纹」是站群的常态**（各站独立 GA4 / 埋点进 GTM 容器 / 服务端埋点），空结果读成「这条路没找到」 |
| **4 · 广告与供给侧** | 并行 F | `node $RANKUP/scripts/demand/ads-transparency.mjs creatives --domain <域名> --region US`<br>`node $RANKUP/scripts/demand/sitemap-diff.mjs --domain <域名> --all --slug-words --top-words 40` | 他在不在持续买流量（持续投放 = ROI > 1）；他用几页吃了多少词 | ads-transparency 不需要 token 不需要登录。**广告数值不准，趋势与量级对**（50K 真值 40K–60K），**不进任何财务测算** |
| **5 · 面板真实流量** | **串行 · 独占面板**（铁律三） | 一个 agent，一个会话，顺序跑完：<br>`node $BACKLINK/scripts/similarweb-query.mjs --domain <d> --report performance`<br>`--report channels` / `--report similar-sites` / `--report audience-geo` / `--report site-keywords`<br>**`node $BACKLINK/scripts/semrush-traffic.mjs --domain <d>`** ← 这一条是口径对齐的关键<br>`node $BACKLINK/scripts/semrush-overview.mjs --domain <d> --db us`<br>`node $BACKLINK/scripts/semrush-report.mjs --report organic-positions --domain <d> --db us`<br>`--report organic-pages` / `--report backlinks-overview` | 总访问 + 渠道构成 + 相似站 + 地理分布 + 站点词 / **Semrush 侧的总访问量口径（.Trends）** / 单国家库自然流量 + 排名词 + 主要页面 + 反链 | **两家「差三倍」多半是拿错了数**：`semrush-overview` 给的是**自然搜索**估算，Similarweb 给的是**总访问**，本来就不同量级。要并排就用 `semrush-traffic.mjs` 的 .Trends 总访问——2026-08-28 实测 canva.com 两家差 2.4%。（该脚本 `--window` 默认 **foreground**，全仓唯一例外：这张报表在后台标签页里不水合。）<br>**只有 performance 报表有结构化 metrics**——在渠道页上跑 deriveMetrics 会把筛选器文字当数值抓（实测 globalRank 抓成 1）。<br>`organic-pages` 从 URL 后方读当前行（旧版向前读会整体错位）。<br>**一次装一堆**：同一个 `--session` 常量跑完所有域名再 close |
| **6 · 薄编排复核**（帖子声称数字时） | 串行，在 5 之后 | `node $RANKUP/scripts/demand/revenue-site-audit.mjs --domain <域名> --source-url <帖子链接> --claimed-visits <n> --claimed-organic-share <pct> --claimed-mrr <n> --keyword <主词> --db us --out audit.json` | 各源原始对照数据 + 倍差事实，**不含 verdict** | 它顺序调用现有 AITDK / Similarweb 两张报表 / Semrush / sitemap / KD 脚本。`--from <目录>` 可离线重整已保存的原始文件（**不重跑不再花配额**）。原始文件全保留在输出的 `rawFilesDir` |
| **7 · 定性背景**（可选，判断「他为什么能起来」） | 并行，与 5/6 无冲突 | `/deep-research` 或 `/agent-reach`：查这个品牌/产品在 Reddit / X / 小红书 / 播客里的讨论<br>`node $RANKUP/scripts/webcafe-forum.mjs chat-search "<品牌或赛道>"` | 叙事与打法（社群里有没有人拆过它） | **这一步只出定性叙事，不出任何数字**。哥飞社区那条**优先于问 AI**：`chat-search` 拿的是群聊归档原文，不经模型转述、零 AI 额度。**匿名不报错，只把正文抹成空串** |

### 判读

| 阶段 | 判据在 |
|---|---|
| 1 收入源 | [`demand-sources.md`](../demand-sources.md) 二「收入数字该信谁」：TrustMRR = Stripe 实连（可当数字）；traffic.cv = 定性；Toolify 只说明「在收钱」。派生指标 `到达付费页比例 = Stripe 引荐 ÷ 总访问`（实测算例 ≈8.60%），**榜上的是优等生，保守按 1% 折算** |
| 3 站群 | [`demand-sources.md`](../demand-sources.md) 九·二 strong/medium/weak 指纹表：GA4/AdSense/Clarity/Umami 账号 ID 相同 = strong；同一 `utm_source` 或共享 GTM 容器 = medium；**只有一条外链 = weak，不构成证据** |
| 4 广告 | [`demand-discovery.md`](../experiences/demand-discovery.md) 一·3：口径警告——数值不准，趋势与量级对，不进财务测算 |
| 5 两家打架 | [`demand-sources.md`](../demand-sources.md) **②·六·四** + **②·六**：**Similarweb 默认全球，Semrush 只给一个国家库**。并排之前先看目标国占比（实测美国占比 21–39%，光这一条就是约 5 倍）。判断渠道构成用 Similarweb 自己的 channel mix，**不要跨面板相减**。差 >2 倍必须归因（地理？渠道口径？模型失真？） |
| 5 页数规划 | [`demand-sources.md`](../demand-sources.md) **②·七**：别按「词数」规划页数——查竞品 sitemap，看它**用几页吃了多少词** |
| 6 verdict | [`demand-sources.md`](../demand-sources.md) 第十节那四条：`estimateRatio > 2` → 两源打架，claimed「无法证实」，**不许引用较高的那个数**；`similarwebPerformanceVsChannelsRatio > 1.35` → 同一面板两张报表自相矛盾，两个原始字段都保留；自然占比 claimed 与面板差 ≤5pp 吻合 / ≤20 部分吻合 / 更大是反证；MRR 只在 `stripeVerifiedForThisDomain:true` 且 `claimedToVerifiedRatio ≤1.1` 才算证实——**Stripe 只证收入规模，不证「靠哪类页面/渠道赚的」** |
| 自有计数器 | [`demand-discovery.md`](../experiences/demand-discovery.md) 一·7：引用竞品页面上任何「实时数字」之前**先 `curl -sI` 看 `age` / `x-*-cache` / `cache-control`**——实测某站 Live Stats 三次不变，`age: 521292`（6 天前的缓存） |
| 站群里哪个是机会 | [`demand-sources.md`](../demand-sources.md) 九·二末：价值在「哪几个赛道做成了、哪几个做了没跑起来」，**后者才是机会** |

### 省配额

| 档位 | 谁 |
|---|---|
| **不计配额**（seo.web.cafe 明确不扣） | `referring` / `referringMonth` / `referringSite` · `translatePage` · `translateAggregate` · `mineReport` |
| **零配额** | `stripe-referring` · `ads-transparency` · `site-network` · `sitemap-diff` · `boards`（浏览器但不计额度） |
| **吃 seo.web.cafe 共享池** | `aitdk-lookup`（每域 1）· `payment-referrers serp`（每查询 1） |
| **面板配额** | 阶段 5 全部。**一个域名跑全 5 张 Similarweb 报表 + 4 张 Semrush 报表 = 9 次页面加载**，规模在阶段 0 定死 |
| **免费重跑的技巧** | `revenue-site-audit --from <已保存目录>` 离线重整，不重新取数 |
| **不要用** | `stripe-referring top --enrich` 的批量补总访问量（**吃配额**）——改用 `--visits <本地 JSON 映射>` |

### 收尾

- 跨源对照表 → `.rankup/decisions.md`。**每个数字四件套：来源面板 + 报告页 + as-of 日期 + 口径**；
  两源并排列出，**不做算术运算**，渠道行合计不得冒充 Performance 总访问
- 站群清单 → `.rankup/decisions.md`，逐个标「做成了 / 没跑起来」
- 原始采集文件留在 `rawFilesDir`（默认 `.rankup/evidence/demand/revenue-site-audit-<时间戳>/`），**不要清理**
- `.rankup/checks.md` 打勾 research-checklist 第四、五、六节

---

## 附 · 兄弟 Skill 在这条链路里的位置

全局装了一批 Skill，其中只有四个该进调研链路。**写死在这里，不要每次重新评估。**

| Skill | 进不进 | 在哪一步用 | 硬约束 |
|---|---|---|---|
| **`/anysearch`** | **进** | P1 阶段 1f、P3 阶段 1B | 覆盖 capability-map「手工源」表里 turbo0 / IndieHackers / HuggingFace Trending / Arena.ai / StackOverflow / AppSumo / AlternativeTo 那几行——**它们没有脚本，此前只能靠人**。`batch_search` 一次并行多条；`extract` 取整页正文。**匿名可跑（已实测）**，零 rankup 配额 |
| **`/agent-reach`** | **进** | P1 阶段 1 补位、P4 阶段 7 | 覆盖手工源表 §八「用户的原话」里 **TikTok / YouTube / X / V2EX / 小红书**——rankup 只有 `reddit-wishes` 一个脚本，其余平台一个都没有。**只取原话，不出数字** |
| **`/keyword-research`** | **半进** | P3 阶段 6，**只用第 4 相和第 7 相** | 它**没有任何数据源**（`Data Sources` 那节写明"Without tools, ask for seed keywords"）。它的第 5 相 Score 会凭空生成 volume 和 difficulty 1-100 —— 那与 rankup「脚本只采集、数字必须有出处」的全部纪律直接冲突。**严禁跑它的 Score 相** |
| **`/deep-research`** | **半进** | P4 阶段 7、P1 用户提到陌生领域时 | 它是 WebSearch 的多角度方法论。**只用于赛道背景的定性理解**，产出不许进 `.rankup/keywords.md` 或任何带数字的表 |
| **`/opencli`** | **底座** | 所有需要真浏览器的阶段 | 会话纪律、`--window background` 默认、`close` 必须显式——`SKILL.md`「浏览器与取数」一节已指向它，本文件不重复 |
| **`/backlink`** | **底座** | P2 阶段 2/5、P3 阶段 2/3、P4 阶段 5 | Semrush / Similarweb / Tools Share 脚本的宿主。未装：`npx skills add yan-labs/yan-skills --skill backlink -g -y` |
| `/ai-seo`、`/seo-geo`、`/seo-audit` | **不进** | — | 它们是**优化侧**（决定做了之后怎么做好），在调研阶段没有输入可给。立项之后才登场 |

---

## 维护契约

新增一个调研脚本或手工源时，**同时改四处**（少改一处，那条能力就只存在于那次对话里）：

1. [`capability-map.md`](../capability-map.md) —— 底账加一行
2. [`demand-sources.md`](../demand-sources.md) —— 源 → 脚本路由表加一行
3. [`research-checklist.md`](../research-checklist.md) —— 验收矩阵加一个勾选项
4. **本文件** —— 塞进 P1–P4 中它真正该出现的那个阶段，标明并行/串行与配额档位

**只加进底账不加进本文件 = AI 知道有这个能力，但不知道什么时候跑它。**
