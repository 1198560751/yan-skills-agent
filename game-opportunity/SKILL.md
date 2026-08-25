---
name: game-opportunity
description: 小游戏机会的每日发现、筛选和调查 Skill。用户提到监测游戏平台 sitemap、发现新游戏内页、小游戏新词、游戏 KD、搜索量、可玩 iframe、每日候选报告、从老游戏里找仍有流量的竞争词，或要求自动运行小游戏机会流水线时使用。它复用 Rankup 与 Backlink 的现有脚本，把项目私有数据统一写进被 Git 忽略的 .rankup/。
---

# Game Opportunity

把游戏平台的新 URL 变成可直接挑选的建站候选。商业判断看今天的搜索需求、竞争盘面和可玩供给；
游戏发布时间只负责标注新旧，老游戏同样可以进入优先队列。

## 任务入口

| 任务 | 动作 | 固定产物 |
|---|---|---|
| `discover` | 抓取全部平台 sitemap、按站点路径过滤、与上次快照做 diff | `.rankup/demand/game-review/YYYY-MM-DD-discovery.json` |
| `evaluate` | 验活、合并实体、查量/KD/趋势/SERP/供给、排序 | `.rankup/demand/game-review/YYYY-MM-DD-candidates.json` 与 `YYYY-MM-DD-report.md` |
| `daily` | 依次完成 `discover` 和 `evaluate` | 上述全部产物 |

用户只说“运行小游戏监测”时执行 `daily`。自动任务分成 `discover` 和 `evaluate` 两个时段，前者提供
稳定数据边界，后者可以在数据源限流或登录失效后单独重跑。

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
