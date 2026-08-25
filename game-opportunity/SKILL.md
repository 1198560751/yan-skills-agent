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
| `evaluate` | 验活、合并实体、查量/KD/趋势/SERP/供给、排序 | `.rankup/demand/game-review/YYYY-MM-DD-candidates.json` 与 `YYYY-MM-DD-report.md` |
| `daily` | 依次完成 `discover`、`radar` 和 `evaluate` | 上述全部产物 |

用户只说“运行小游戏监测”时执行 `daily`。自动任务分成 `discover`、`radar` 和 `evaluate` 三个时段：
平台增量提供稳定数据边界，24 小时雷达补充早期名字，量化评估可以在数据源恢复后单独重跑。

## `radar`

24 小时内的新名字先从发布源和玩家现场发现，再进入搜索量验证：

1. 供给端：游戏平台 sitemap、itch.io / Steam 新发布与更新、App Store / Google Play 新游戏；
2. 玩家端：Reddit 的 `r/WebGames`、`r/playmygame`、`r/IndieGaming`、玩法垂直社区；
3. 传播端：YouTube 当日上传、X 最新帖，以及目标语言的本地游戏论坛；
4. 搜索端：Google Trends 实时热搜、7 天曲线和 related rising；
5. 验证端：Similarweb 最近 28 天关键词与流量去向、Semrush 分国家搜索量与 KD。

使用 Agent Reach 当前可用后端读取社区；桌面登录态优先走 OpenCLI：

```bash
opencli reddit search "<游戏名>" --sort new --time day --limit 10 -f json
opencli youtube search "<游戏名> game" --upload today --sort date --limit 10 -f json
opencli twitter search '"<游戏名>" since:<YYYY-MM-DD>' --product live --limit 10 -f json
```

同时搜索 `new browser game`、`playable demo`、`release trailer`、`HTML5 game` 与各语言对应表达，
从正文、标题和落地链接提取新实体。每条雷达记录保存 `firstSeen`、来源 URL、发布时间、互动量、
可玩链接、语言、市场和别名。官方发布页加一条独立社区/视频信号，或两个独立社区同时出现，即进入
候选；单一来源进入观察队列。

新词按首次发现后的第 3、7、14、28 天复查。早期保存 `volumeStatus: not-yet-observed`，继续用
社区增速、跨平台重复、可玩供给和 Trends 判断；搜索量出现后再并入常规 KD、SERP 和国家筛选。
Similarweb 用于最近 28 天的关键词、国家和流量去向验证，Semrush 用于分国家搜索量与 KD。

## 数据边界

- 平台清单：`.rankup/demand/game-platforms.json`
- sitemap 快照：`.rankup/demand/game-platforms/`
- 原始报告、KD 输入与结果、候选 JSON、日报：`.rankup/demand/game-review/`
- 长期候选与判断：`.rankup/research.md`

这些都是当前项目自己的数据。复用规则和脚本保存在本 Skill、Rankup 与 Backlink 中。

## `discover`

在仓库根目录执行：

```bash
TODAY=$(date +%F)
node rankup/scripts/demand/game-platform-monitor.mjs \
  --out ".rankup/demand/game-review/${TODAY}-discovery.json"
```

平台配置里的 `include`、`exclude`、`kind` 和 `timeout` 分别负责游戏路径、杂页路径、内容类型和
单站抓取窗口。保留每个平台的独立快照与统计，让报告可以按平台、语言和市场回溯。

## `evaluate`

### 1. 验证并归并

读取当天 discovery JSON，对新增 URL 依次完成：

1. 直接 HTTP 检查状态、最终 URL、正文长度和标题；
2. 用 Jina Reader 提取可读正文；
3. 页面依赖登录态或浏览器渲染时，用 OpenCLI 读取；
4. 按 canonical、游戏名、slug 和 iframe URL 合并同一游戏的多语言页面；
5. 分成 `playable-game`、`new-on-platform`、`game-adjacent`、`stale-url`。

`new-on-platform` 表示监测站今天刚收录；另行查明游戏首次发布时间。两者同时写入报告。

### 2. 生成关键词

每个有效实体提取 1–3 个真实搜索表达：游戏名、目标语言名、玩法大类。每个词带上 `gl`、`hl`、
来源 URL 和实体 ID。多语言市场分别查询，不把英文数据套给本地语言。

### 3. 查询竞争与需求

先批量查询哥飞 Web.Cafe 的 KD 与 SERP 盘面：

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

每个文件只放同一个国家库的词，`--db` 始终显式填写；批量页一次提交最多 100 个词。第一轮得到
当地搜索量、KD、CPC、竞争程度和意图。进入候选组的词再用单词模式读取全球量和主要国家：

```bash
node backlink/scripts/semrush-keyword.mjs --kw "<keyword>" --db <primary-db> \
  --out ".rankup/demand/game-review/${TODAY}-semrush-<keyword>-countries.json"
```

`globalVolume` 表示全球合计，`byCountry` 表示页面列出的主要国家。把这些国家和项目目标市场分别
建立 `<db>` 批量文件，再取各地自己的量与 KD。Semrush 的零值单词单独复查一次。趋势用
`rankup/scripts/gt.py` 查询 12 个月、30 天和 7 天窗口。对可玩候选提取 iframe 或游戏入口，记录
HTTP 状态、加载页、移动端与全屏线索。

### 4. 排序

把候选放进三组：

- `quick-ship`：页面可读、供给可玩、搜索量已确认、KD 或 SERP 存在可竞争空间；
- `priority-research`：已有需求信号，还需要补一项供给、趋势或竞争证据；
- `watch`：游戏相关信号成立，等待下一次平台、趋势或搜索量信号。

老游戏按当前量、当前 KD、当前 SERP 和当前供给进入同一套排序。把失效 URL 单独汇总，便于清理
sitemap 噪声。

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

- discovery 报告存在，并给出成功、baseline、失败和新增数量；
- 每条新增 URL 都有可访问性结论；
- 多语言重复页已经合并；
- 每个进入排序的候选都有供给状态和至少一组市场关键词数据；
- JSON 与 Markdown 数字一致，所有私有产物都位于 `.rankup/`。
