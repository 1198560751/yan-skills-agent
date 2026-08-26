---
name: game-opportunity-collect
description: 小游戏机会每日采集 Checklist。每天监测游戏平台 sitemap、24 小时发布源与社区线索，生成去重后的新增游戏时使用；对应早间“小游戏机会每日采集”定时任务。必须逐项完成 10 个 Check，并把证据写入 .rankup/。
---

# Game Opportunity Collect

在仓库根目录运行：

```bash
node game-opportunity/scripts/game-opportunity.mjs collect-checklist
```

需要修复失败项时，读取 [`../game-opportunity/SKILL.md`](../game-opportunity/SKILL.md) 的 `discover`、`radar` 与数据边界说明，然后重跑同一命令。

## Checklist

- [ ] C01 平台配置已读取且本次覆盖全部配置平台。
- [ ] C02 每个平台都有 compared、baseline 或 failed 的明确结果。
- [ ] C03 全部 sitemap 抓取成功且没有平台失败。
- [ ] C04 每个平台都分别记录 added、changed 和 removed。
- [ ] C05 Steam、itch、Poki 与启用的社区雷达全部执行成功。
- [ ] C06 discovery、radar 与 new-games 均属于当天。
- [ ] C07 discovery 与 radar 已合并且统计数量和实体数量一致。
- [ ] C08 社交 campaign 与非游戏记录没有混入新增游戏。
- [ ] C09 新增游戏按名称或 URL 去重且没有重复实体。
- [ ] C10 采集产物、名称、来源链接和 Git 忽略边界全部完整。

只有 `.rankup/demand/game-review/latest-collect-checklist.json` 的 `ok` 为 `true` 才算完成；否则返回失败 Check、证据和产物链接。
