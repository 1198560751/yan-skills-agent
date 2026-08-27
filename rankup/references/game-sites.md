# 小游戏站：流量与变现执行链

用户提到「小游戏站」「游戏新词」「监控游戏站」「游戏 iframe」时，按本文件执行；建站、上线、
索引和分析平台接入继续走 [`lifecycle.md`](lifecycle.md)。

每日机会流水线由 Rankup 的专项模块 `game-opportunity` 执行：`discover` 负责 sitemap 增量，
`evaluate` 负责验活、需求簇、查量/KD、趋势、独立需求、供给检查和候选排序。通用能力保存在仓库，
项目 `.rankup/` 只保存该项目的私有运行数据。

## 一、目标

小游戏站是一门流量生意：尽早发现正在增长的游戏词，快速接入可玩的游戏供给，上线搜索页面，
获取玩家流量，再用广告、游戏内付费分成和持续扩页提高收入。

执行优先级：新词速度 → iframe / 游戏供给 → SERP 空位 → 上线速度 → 玩家留存 → 广告收入。

Web.Cafe 的流量、收入、上线过程和失败复盘是本链路的主要实战依据。项目自己的 GSC、分析和
收入数据负责每轮裁决。

## 二、每天发现游戏新词

### 上新平台

```bash
node scripts/demand/game-newtitles.mjs --source steam --json --out .rankup/demand/games-steam.json
node scripts/demand/game-newtitles.mjs --source itch --json --out .rankup/demand/games-itch.json
node scripts/demand/game-newtitles.mjs --source poki --json --out .rankup/demand/games-poki.json
```

更多源与字段见 [`demand-sources.md`](demand-sources.md)「持续涌现新词的平台」。

### 竞品 sitemap

把项目自己的平台与 sitemap 清单保存在 `.rankup/demand/game-platforms.json`。每天批量保存快照，
把新出现的游戏内页汇总成候选报告：

```bash
node scripts/demand/game-platform-monitor.mjs
node scripts/demand/game-platform-monitor.mjs --language de,pl,ja,ar,ru
node scripts/demand/game-platform-monitor.mjs --market KZ,UA,DE,JP
```

`.rankup/` 保存本项目的平台名单、快照、报告与候选，整目录由 Git 忽略。第一次运行建立 baseline，
之后的报告直接给出新增内页。单站深挖继续使用：

```bash
node scripts/demand/sitemap-diff.mjs --domain example.com --slug-words
```

每个平台可以在私有清单里配置 `include`、`exclude`、`kind` 和 `timeout`：保留游戏详情路径，滤掉
标签、分类、博客等杂页，同时标明它属于可玩游戏、游戏资讯或游戏相关内容。候选页先用 HTTP 验证
状态和正文，再用 Jina Reader 提取内容；需要登录态或浏览器渲染时交给 OpenCLI。同一游戏的多语言
页面合并成一个实体，并分别记录「平台首次收录时间」与「游戏发布时间」。

项目新增的平台写入项目 `.rankup/research.md`，记录站点、sitemap、语言、市场和最近有效信号；
验证稳定后再加入通用清单。

### 搜索与社区

- Trends：记录 12 个月、30 天、7 天斜率，以及增长地区和 related rising。
- Google SERP：记录首页/内页比例、结果类型、页面新鲜度和前十引荐域。
- 24 小时雷达：按最新排序读取 itch 最近 7 天、GameJolt Hot、Poki/CrazyGames 新游位、
  Scratch/Cocrea、SteamDB New & Trending、GitHub、应用商店、Reddit、YouTube 和 X；提取游戏名、
  别名、玩法词、发布时间、互动量和可玩链接。
- Reddit、短视频和论坛：按作者、文案和落地链接合并 `campaign`，记录非官方发布者、平台数、互动、
  4 小时/24 小时/7 天发布速率；同一开发者跨社区发布按一次推广计算。
- 站点与频道清单：筛选最近仍在更新、持续发布网页游戏的来源。
- Similarweb：用最近 28 天的关键词、国家和流量去向验证社区信号；Semrush 继续给分国家量与 KD。
- 新词在首次发现后的第 3、7、14、28 天复查；搜索量尚未形成时使用社区增速、跨平台重复、可玩供给
  与 Trends 共同排序。
- 站内新增页负责发现。外部需求用独立 SERP、本地搜索量、Trends、竞品自然搜索词和非官方传播验证。
- 早期爆发初始线：24 小时 ≥3 位非官方发布者、≥2 类平台、发布速率达到前 7 天日均 3 倍，并取得
  ≥20 次互动或 ≥500 次观看；4 小时后仍增长再升级。连续运行 1–2 周后按成功样本校准这些数字。
- Autocomplete / Related Searches 出现 `play X online`、`X unblocked`、`X html5` 等长尾时，记录为
  搜索萌芽；候选再用月搜、KGR、EMD 与前十专业站占位收敛。

## 三、建立候选卡

| 字段 | 内容 |
|---|---|
| `name / aliases / slug` | 主词、拼写、多语言变体 |
| `entity_type / keyword_clusters` | 品牌词、品类词或泛词；同义词与承接意图分簇 |
| `first_seen / sources` | 首次发现时间和两个独立信号 |
| `trend` | 12 月、30 日、7 日趋势与地区 |
| `serp_shape` | 前十页面类型、新鲜度和品牌强度 |
| `volume / KD / CPC` | 已取得的数据与查询日期 |
| `metric_scope` | 全球、国家、28 天总量、7 天方向与数据来源 |
| `competition_review` | KD 口径、SERP 意图、弱位、新站与数据冲突 |
| `internal_traffic_risk` | 平台内推荐与独立外部需求是否已经分开 |
| `top10_ref_domains` | 前十页面的真实引荐域 |
| `playable_source / embed` | iframe 来源、加载、移动端、全屏、声音 |
| `ship_time` | 最小版本预计上线时间 |
| `difference` | 页面体验、速度、玩法或工具优势 |
| `recheck_date` | 下一次复查日期 |

快速上线信号：两个独立来源同时出现、Trends 斜率向上、SERP 出现独立站空位、游戏稳定运行、
最小版本赶得上流量窗口、目标地区具备广告收入空间。

KD 执行线：`<20` 可直接复核，`20–39` 是新站主战场，`40–49` 必须同时看到 SERP 弱位/新站、
集中意图和可形成的体验差异，`>=50` 不作为 DR≈0 新站主攻词。近 28 天总量与最近 7 天方向分开写；
“月度仍高、短期回落”不能写成“仍在上涨”。同义词分别展示，不简单相加。

## 四、接入游戏供给

供给来源包括公开 iframe、发行平台、自研游戏和开源游戏。

公开 iframe 在桌面端与移动端正常渲染、操作和全屏，即进入上线测试。每个游戏在项目
`.rankup/integrations.md` 记录：

- 来源页、iframe URL、首次发现时间和可用地区；
- 加载时间、移动端、全屏、声音和游戏内广告/付费；
- 健康检查 URL、最近检查时间和替代源；
- 外层广告空间与页面布局。

供给状态使用三个值：`active` 正常供给、`watch` 需要观察、`replace` 切换替代源。

## 五、快速上线单游戏页

最小版本包括：

1. 一个稳定 URL，首屏直接展示游戏和开始入口；
2. 清楚的加载状态、操作方式、全屏、音量、暂停和重新开始；
3. 游戏目标、控制方式、玩法技巧、常见问题和来源说明；
4. title、description、canonical、语言、OG 和适用的结构化数据；
5. 成绩、每日挑战、重玩或分享入口；
6. 隐私、条款、联系入口、广告说明和 404；
7. 移动端与真实域名冒烟测试。

扩张顺序：单游戏首页 → 同游戏玩法/模式/每日挑战/攻略工具 → 相邻游戏 → 已验证市场的多语言页。

AI 用于整理元数据、翻译草稿、生成代码和维护模板；玩家体验、玩法信息和页面差异来自真实游戏。

## 六、获取流量

1. 让搜索意图与页面体验匹配；
2. 在游戏社区和垂直创作者渠道分发；
3. 用成绩、挑战和分享页带来自传播；
4. 从相关站点、游戏目录和评论区建立早期链接；
5. 使用 `backlink` Skill 扩展相关外链并验收真实落地结果；
6. 对表现最好的国家和语言增加本地化页面。

## 七、广告变现

1. 预留清晰的广告位，保持游戏控制区完整；
2. 接入站点分析、GSC 和广告平台；
3. 配置根路径 `ads.txt`；
4. 按国家、设备、页面和渠道观察覆盖率、RPM 与流量质量；
5. 使用 Web.Cafe 案例里的 UV、RPM 和审核周期作为初始基准；
6. 把高收入地区、页面和游戏加入下一轮扩张队列。

## 八、自动监控

| 频率 | 信号 | 现有能力 | 动作 |
|---|---|---|---|
| 每日 | 新游戏与新玩法 | `game-newtitles.mjs` | 新候选进入验证队列 |
| 每 4 小时 | 24 小时发布与社区信号 | Agent Reach + OpenCLI | 写入雷达并合并同名来源 |
| 每日 | 多语种游戏平台新增内页 | `game-platform-monitor.mjs` | 汇总候选并合并同名信号 |
| 每日 | iframe 加载与开始入口 | 项目冒烟测试 | 标记 `active/watch/replace` |
| 每日 | PV、UV、开始率、局数、分享率、国家 | GA/Cloudflare/项目事件 | 找到增长页面与地区 |
| 每日 | 广告覆盖、RPM、流量质量 | 广告后台 | 调整渠道与广告位 |
| 每日 | 候选 Trends、KD、SERP、搜索量 | `gt.py` + Web.Cafe + Semrush | 生成可上线、优先研究、观察三组 |
| 第 3/7/14/28 天 | 新词复查 | Similarweb + Semrush + Trends | 从未观察到量转入量化筛选 |
| 每周 | 竞品流量渠道与关键词 | Similarweb/Semrush | 更新候选与路线图 |
| 每周 | 新增/丢失引荐域 | `backlink` Skill | 验收并扩展有效来源 |
| 每周 | sitemap、索引率、GSC 查询/页面 | GSC + `seo-audit.mjs` | 更新页面与内链 |
| 每月 | iframe 稳定性与收入集中度 | 供给台账 | 增加替代源与新游戏 |

调度使用项目现有 CI、cron 或自动化平台。结果写入 `.rankup/demand/`，登录后台的任务复用固定
浏览器会话，每个站点保持一个会话。

## 九、持续加码

每天筛选新候选；每周汇总已上线站点：

- 搜索：曝光、点击、查询覆盖、排名、索引率；
- 产品：开始率、加载成功率、每用户局数、重玩、分享、7 日回访；
- 质量：移动端体验、退出点、广告位置、iframe 稳定性；
- 商业：国家/设备 RPM、覆盖率、收入集中度、流量质量；
- 外部：趋势斜率、SERP 新进入者、iframe 供给。

裁决动作：

- **加码**：扩展增长游戏的玩法、工具、语言、外链和分享能力；
- **优化**：提升加载、移动端、开始率、重玩和广告布局；
- **换源**：把 `watch/replace` 游戏切到稳定 iframe；
- **转向**：把开发和外链资源投向下一批上升词。

每轮结果写入项目 `.rankup/iterations.md`，下一轮从表现最好的游戏、地区和流量来源继续扩张。
