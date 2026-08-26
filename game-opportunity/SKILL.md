---
name: game-opportunity
description: 小游戏机会的每日发现、筛选和调查 Skill。用户提到监测游戏平台 sitemap、发现新游戏内页、24 小时小游戏新词、Reddit/YouTube/X 游戏源头、游戏 KD、搜索量、可玩 iframe、每日候选报告、从老游戏里找仍有流量的竞争词，或要求自动运行小游戏机会流水线时使用。它复用 Rankup 与 Backlink 的现有脚本，把项目私有数据统一写进被 Git 忽略的 .rankup/。
---

# Game Opportunity

把游戏平台的新 URL 变成可直接挑选的建站候选。商业判断看今天的搜索需求、竞争盘面和可玩供给；
游戏发布时间只负责标注新旧，老游戏同样可以进入优先队列。

## 任务入口

| 任务 | 动作 | 固定产物 |
|---|---|---|
| `discover` | 抓取全部平台 sitemap、按站点路径过滤、与上次快照做 diff | `.rankup/demand/game-review/YYYY-MM-DD-discovery.json` |
| `radar` | 扫描 24 小时发布源与玩家社区，提取刚出现的游戏名、别名和玩法词 | `.rankup/demand/game-review/YYYY-MM-DD-radar.json` |
| `collect` | 依次完成 `discover` 和 `radar`，并合并当天新增游戏 | 上述两个输入文件与 `YYYY-MM-DD-new-games.json` |
| `collect-checklist` | 执行采集并完成 10 项硬验收 | `YYYY-MM-DD-collect-checklist.{json,md}` |
| `dedupe` | 不联网，读取当天 discovery/radar，去掉重复游戏与社交 campaign | `.rankup/demand/game-review/YYYY-MM-DD-new-games.json` |
| `plan` | 从真实游戏生成原名、英文名、本地名的全球优先查询计划 | `YYYY-MM-DD-demand-plan.json` 与 `YYYY-MM-DD-global-keywords.txt` |
| `demand` | 先查全球量和主要国家，再一次性查询各国家库 | `YYYY-MM-DD-demand-results.json` |
| `evaluate` | 验活、合并实体、查量/KD/趋势/SERP/供给、排序 | `.rankup/demand/game-review/YYYY-MM-DD-candidates.json` 与 `YYYY-MM-DD-report.md` |
| `decision-checklist` | 执行需求调查、日报并完成 10 项硬验收 | `YYYY-MM-DD-decision-checklist.{json,md}` |
| `daily` | 依次完成 `collect`、`demand` 和 `evaluate` | 上述全部产物 |

所有任务都走同一个真实入口：

```bash
node game-opportunity/scripts/game-opportunity.mjs <discover|radar|collect|collect-checklist|dedupe|plan|demand|evaluate|decision-checklist|render|daily>
```

用户只说“运行小游戏监测”时执行 `daily`。自动任务分成 `collect` 和 `demand + evaluate` 两个时段：
平台增量与 24 小时雷达先形成稳定输入，需求阶段再按全球、国家、竞争顺序查数并生成日报。

## `radar`

24 小时内的新名字先从发布源和玩家现场发现，再进入搜索量验证：

1. 供给端：游戏平台 sitemap、itch.io 最近 7 天、GameJolt Hot、Poki / CrazyGames 新游位、
   Scratch / Cocrea、SteamDB New & Trending、GitHub 游戏仓库与 App Store / Google Play 新游戏；
2. 玩家端：Reddit 的 `r/WebGames`、`r/playmygame`、`r/IndieGaming`、玩法垂直社区；
3. 传播端：YouTube 当日上传、X 最新帖，以及目标语言的本地游戏论坛；
4. 搜索端：Google Trends 实时热搜、7 天曲线和 related rising，以及 Google Autocomplete / Related
   Searches 里的 `play <name> online`、`<name> unblocked`、`<name> html5` 等长尾萌芽；
5. 验证端：Similarweb 最近 28 天关键词与流量去向、Semrush 分国家搜索量与 KD。

使用 Agent Reach 当前可用后端读取社区；桌面登录态优先走 OpenCLI：

```bash
opencli reddit search "<游戏名>" --sort new --time day --limit 10 -f json
opencli youtube search "<游戏名> game" --upload today --sort date --limit 10 -f json
opencli twitter search '"<游戏名>" since:<YYYY-MM-DD>' --product live --limit 10 -f json
```

同时搜索 `new browser game`、`playable demo`、`release trailer`、`HTML5 game` 与各语言对应表达，
从正文、标题和落地链接提取新实体。每条雷达记录保存 `firstSeen`、来源 URL、发布时间、互动量、
可玩链接、语言、市场和别名。同一作者、官方账号及相同文案的跨社区发布合并为一个 `campaign`；
独立发布者、平台类型和非官方互动分别计数。雷达线索先进入验证队列，达到下方早期爆发闸门后升级。

新词按首次发现后的第 3、7、14、28 天复查。早期保存 `volumeStatus: not-yet-observed`，继续用
社区增速、跨平台重复、可玩供给和 Trends 判断；搜索量出现后再并入常规 KD、SERP 和国家筛选。
Similarweb 用于最近 28 天的关键词、国家和流量去向验证，Semrush 用于分国家搜索量与 KD。

## 外部需求双轨闸门

站内新增页、首页入口和 sitemap 批量更新时间负责发现候选。外部需求分从独立 Google SERP、本地
搜索量、Trends、竞品自然搜索词，以及非官方社区传播中取得。

### 搜索需求轨

| 项目 | 分值 |
|---|---:|
| 目标国家精确词月搜：1–99 / 100–499 / 500–1999 / 2000+ | 5 / 10 / 15 / 20 |
| Google 前十存在多个独立域名且意图与游戏一致 | 10 |
| 30 天或 7 天 Trends 形成连续曲线并向上 | 10 |
| Similarweb 能在竞品自然搜索词中看到该词 | 5 |
| KD：≤30 / 31–40 / 41–50 / >50 | 15 / 12 / 8 / 3 |
| SERP 有低权重、新页面或独立站空位 | 10 |
| 可玩供给 / 移动端稳定 / 两天内可上线 | 10 / 5 / 5 |
| 目标国家与搜索意图匹配 | 10 |

精确词、玩法大类和多语言变体分别打分。搜索量达到“全球精确词 1,000，或目标国家精确词 500”
只进入调研，不代表可以开发。独立单游戏站的开发硬门槛是全球精确词至少 10,000、最高国家至少
2,000、KD 不高于 30、游戏意图已核实、存在独立外部需求并且可玩供给稳定；任一项缺失就进入调研
或观察。候选再计算 KGR
（`allintitle` 结果数 ÷ 月搜）：社区初筛线为 KGR <0.25 或 `allintitle` <100；同时查看 EMD 与前十
专业站占位。总分 70+ 进入 `quick-ship`，50–69 进入 `priority-research`，其余进入 `watch`。

### 早期爆发轨

面板尚未形成数据时，保存 4 小时、24 小时、7 天三个快照，并以去重后的 `campaign` 计算：

| 项目 | 初始通过线（先运行 1–2 周回测再校准） |
|---|---|
| 24 小时非官方独立发布者 | ≥3 |
| 独立平台类型 | ≥2（如 Reddit + YouTube） |
| 24 小时发布速率 / 前 7 天日均 | ≥3 倍 |
| 非官方互动或观看 | ≥20 次互动，或 ≥500 次观看 |
| 搜索萌芽 | Trends rising、Autocomplete 长尾、相关查询或新 SERP 页面命中一项 |
| 可玩供给 | 已有可打开的网页游戏、demo 或稳定 iframe |

前四项全部达到并在 4 小时复查后继续增长，进入 `priority-research`；再取得搜索萌芽与可玩供给，
升级为 `quick-ship`。这些数字是自动化的第一版校准值：每天保存命中与后续真实搜索结果，运行 1–2 周
后按成功样本调整。每个发布者的账号、文案、落地链接和发布时间都保存在证据里，方便识别自然扩散
与集中推广。

新词用 7 天、30 天窗口看加速度；有历史的玩法词再看 3 年、5 年窗口，区分长期向上与短时毛刺。
同一痛点在 3 个以上独立平台重复出现，记录为跨平台需求证据。

## 数据边界

- 平台清单：`.rankup/demand/game-platforms.json`
- sitemap 快照：`.rankup/demand/game-sitemap-snapshots/`
- 发布源快照：`.rankup/demand/game-radar-snapshots/`
- 原始报告、KD 输入与结果、候选 JSON、日报：`.rankup/demand/game-review/`
- 长期候选与判断：`.rankup/research.md`

这些都是当前项目自己的数据。复用规则和脚本保存在本 Skill、Rankup 与 Backlink 中。

`collect` 会把当天 discovery URL 与 radar 的 Steam/itch/Poki 游戏标题合并成唯一的 `games[]`，社交
`campaign` 只保留在 radar 原始输入里，不计入新增游戏数。`dedupe` 可在不联网的情况下重建该文件。

## `discover`

在仓库根目录执行：

```bash
node game-opportunity/scripts/game-opportunity.mjs discover
```

平台配置里的 `include`、`exclude`、`kind` 和 `timeout` 分别负责游戏路径、杂页路径、内容类型和
单站抓取窗口。保留每个平台的独立快照与统计，让报告可以按平台、语言和市场回溯。

## `evaluate`

先运行入口脚本生成当天候选队列并验活：

```bash
node game-opportunity/scripts/game-opportunity.mjs evaluate
```

### 1. 验证并归并

读取当天 discovery JSON，对新增 URL 依次完成：

1. 直接 HTTP 检查状态、最终 URL、正文长度和标题；
2. 用 Jina Reader 提取可读正文；
3. 页面依赖登录态或浏览器渲染时，用 OpenCLI 读取；
4. 按 canonical、游戏名、slug 和 iframe URL 合并同一游戏的多语言页面；
5. 分成 `playable-game`、`new-on-platform`、`game-adjacent`、`stale-url`。

`new-on-platform` 表示监测站今天刚收录；另行查明游戏首次发布时间。两者同时写入报告。

### 2. 生成关键词

每个有效实体提取 1–3 个真实搜索表达：官方原名、官方英文名、已有本地名。大小写变体合并；`Demo`
只作为版本标记，不单独占一个词。平台所在国家只记录发现来源，不用于断定游戏产地或目标市场。

英文不能因为游戏来自小语种平台而省略：有官方英文名或通用英文名就进入全球查询。非英语原名也
单独查全球，因为全球查询只统计完全相同的字符串，不会自动把 `ノノグラム` 翻译成 `nonogram`。

先执行：

```bash
node game-opportunity/scripts/game-opportunity.mjs plan
node game-opportunity/scripts/game-opportunity.mjs demand
```

`demand` 固定按下面顺序运行：

1. 按优先级取前 6 个真实游戏，查询其原名、英文名和本地名，读取 `globalVolume` 与 Top-N `byCountry`；
2. 把发现市场、`byCountry` 中有量的国家合并成国家计划；
3. 在同一个 Semrush 页面会话中批量取完所有国家的当地量、KD、CPC 和意图；
4. 已完整取得的全球和国家结果直接复用，重跑时不重复打开浏览器。

Semrush 启动时出现一次工具主页属于初始化；国家查询不得为每个国家重新启动工具或反复跳主页。

### 3. 查询竞争与需求

全球与国家分布完成后，再对主要机会查询哥飞 Web.Cafe 的 KD 与 SERP 盘面：

```bash
node rankup/scripts/seo-webcafe.mjs kd \
  --batch ".rankup/demand/game-review/${TODAY}-kd-input.txt" \
  --spacing-ms 6500 \
  --out ".rankup/demand/game-review/${TODAY}-webcafe-kd.json"
```

Web.Cafe 结果用于 KD、首页/内页构成、最弱竞争者和链接预算。搜索量、CPC 与全球量使用：

```bash
node backlink/scripts/semrush-keyword.mjs \
  --kw-file ".rankup/demand/game-review/${TODAY}-keywords-<db>.txt" \
  --db <db> \
  --bulk \
  --out ".rankup/demand/game-review/${TODAY}-semrush-<db>.jsonl"
```

单个国家文件仍可独立补查，`--db` 始终显式填写；批量页一次提交最多 100 个词。跨国家自动任务使用：

```bash
node backlink/scripts/semrush-keyword.mjs \
  --bulk-plan ".rankup/demand/game-review/${TODAY}-country-plan.json" \
  --out ".rankup/demand/game-review/${TODAY}-semrush-countries.jsonl"
```

`globalVolume` 表示完全相同关键词的全球合计，`byCountry` 只表示页面列出的主要国家，不等于全部
国家。全球量不能证明搜索意图属于这款游戏：`Island Survival` 这类泛词必须再查 `<name> game`、
`play <name>`、SERP 实体和竞品页面。Semrush 的零值单词单独复查一次。趋势用
`rankup/scripts/gt.py` 查询 12 个月、30 天和 7 天窗口。对可玩候选提取 iframe 或游戏入口，记录
HTTP 状态、加载页、移动端与全屏线索。

### 4. 排序

把候选放进三组：

- `quick-ship`：全球量、主要国家量、KD、游戏意图、独立需求与可玩供给全部通过开发硬门槛；
- `priority-research`：已有需求信号，还需要补一项供给、趋势或竞争证据；
- `watch`：游戏相关信号成立，等待下一次平台、趋势或搜索量信号。

老游戏按当前量、当前 KD、当前 SERP 和当前供给进入同一套排序。把失效 URL 单独汇总，便于清理
sitemap 噪声。

### 5. 写回并生成日报

把量化结果写成 `.rankup/demand/game-review/YYYY-MM-DD-evaluation.json`，格式为
`{"candidates":[...]}`；每项用 `entityId`、名称或 URL 与队列合并。然后执行：

```bash
TODAY=$(date +%F)
node game-opportunity/scripts/game-opportunity.mjs render \
  --evaluation ".rankup/demand/game-review/${TODAY}-evaluation.json"
```

入口脚本固定生成日期文件和两个稳定入口：

- `.rankup/demand/game-review/latest.json`：机器可读候选；
- `.rankup/demand/game-review/latest.md`：给用户阅读的最新日报。

日报按 `develop`、`research`、`watch` 三组展示，每个候选必须有发现页、可玩页或证据链接。搜索量
分开显示“全球量、最高国家及其量、发现市场及其量”，不能把最高国家的数字写到发现市场名下；同时
带该主要市场 KD、可玩状态和一句下一步。自动任务完成时直接把三组 List 与这些链接返回
给用户，由用户决定继续调研或创建网站开发任务。

没有候选通过开发硬门槛时，日报明确写“今天没有达到开发门槛的机会，静候下一轮”，不把中小词
或意图未核实的泛词升级成建议开发。

前一日的 `research/watch` 会自动续带；首次发现后的第 3、7、14、28 天在 `carryForward.recheckDue`
标记复查。新候选始终排在续带候选之前。

## JSON 产物

`YYYY-MM-DD-candidates.json` 至少包含：

```json
{
  "date": "YYYY-MM-DD",
  "sourceReport": "...-discovery.json",
  "stats": {},
  "candidates": [
    {
      "entityId": "...",
      "names": [],
      "urls": [],
      "platforms": [],
      "languages": [],
      "markets": [],
      "pageType": "playable-game",
      "firstSeen": "...",
      "gameReleasedAt": "...",
      "reachable": true,
      "playable": true,
      "embed": {},
      "keywords": [],
      "demandProof": {"track": "search", "score": 0, "evidence": []},
      "promotionRisk": {"internalLinks": false, "campaigns": 0, "independentPublishers": 0},
      "trend": {},
      "decision": "quick-ship",
      "reasons": [],
      "nextAction": "..."
    }
  ]
}
```

每个 `keywords[]` 条目保存关键词、市场、语言、Web.Cafe KD、SERP 形态、Semrush 本地量、全球量、
主要国家量、CPC、Semrush KD、查询时间和原始结果文件。日报用表格列出候选、量、KD、可玩性、
结论和下一步。

## 完成判定

- 早间任务以 `game-opportunity-collect` 的 10 项 Checklist 为唯一完成门槛；
- 决策任务以 `game-opportunity-decision` 的 10 项 Checklist 为唯一完成门槛；
- discovery 报告存在，并给出成功、baseline、失败和新增数量；
- 每条新增 URL 都有可访问性结论；
- 多语言重复页已经合并；
- 每个进入排序的候选都有供给状态和至少一组市场关键词数据；
- 候选先有 `globalVolume/byCountry`，再有发现市场和主要国家的当地量；有英文名时英语词已进入全球查询；
- `demandCoverage` 明确记录查过的关键词和国家，日报不把平台国家当成游戏产地；
- JSON 与 Markdown 数字一致，所有私有产物都位于 `.rankup/`。
- `latest.json` 与当日 candidates 一致，`latest.md` 与当日日报一致；
- 最终回复包含 `develop/research/watch` 三组候选和可点击来源链接。
