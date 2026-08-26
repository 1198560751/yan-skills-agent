---
name: game-opportunity-decision
description: 小游戏机会每日决策 Checklist。每天对采集结果查询全球与国家搜索量、KD、意图、独立需求和可玩供给，生成开发、调研、观察或静候结论时使用；对应“小游戏机会每日决策报告”定时任务。必须逐项完成 10 个 Check，并把证据写入 .rankup/。
---

# Game Opportunity Decision

在仓库根目录运行：

```bash
node game-opportunity/scripts/game-opportunity.mjs decision-checklist
```

需要修复失败项时，读取 [`../game-opportunity/SKILL.md`](../game-opportunity/SKILL.md) 的需求双轨、关键词、需求查询与排序说明，然后重跑同一命令。

## Checklist

- [ ] D01 当天采集 Checklist 已全部通过。
- [ ] D02 已按优先级选出不超过 6 个真实游戏进入深查。
- [ ] D03 每个深查游戏都有 1–3 个去重后的原名、英文名或本地名关键词。
- [ ] D04 每个计划关键词都有全球量与主要国家结果或明确无数据状态。
- [ ] D05 国家计划已在同一批次取完且没有缺少国家关键词组合。
- [ ] D06 每个深查游戏都记录已查关键词、国家和 demandCoverage。
- [ ] D07 每个深查游戏都完成页面可达性与可玩供给核对。
- [ ] D08 所有建议开发候选都通过流量、KD、意图、独立需求和可玩性硬门槛。
- [ ] D09 最终结论与建议开发数量一致并允许明确选择静候。
- [ ] D10 JSON、Markdown、latest、分组数量、链接和异常信息彼此一致。

只有 `.rankup/demand/game-review/latest-decision-checklist.json` 的 `ok` 为 `true` 才算完成；否则返回失败 Check、证据和产物链接。
