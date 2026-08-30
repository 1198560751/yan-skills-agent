# Traffic Analytics · Sources & Destinations（来源与目标）

## 页面身份

- URL 模板：`https://sem.3ue.co/analytics/traffic/sources-destinations/?q=<domain>&searchType=domain`
  - `q`：目标域名；`searchType`：固定 `domain`
  - 面板可能自动附加 `lid=` 与 `__gmitm=`（剥敏，只留键名）——都不需要手动传
- `document.title`：`Dashboards`（不反映页面内容，别拿它当落点判据）
- 页面标题「来源与目标」；报表头维度：全球 / 月份 / 所有设备
- 顶部两个 tab：**来源 / 目标**（默认落在来源 tab；目标 tab 未单独测量）

## 回答什么业务问题

竞品的流量从哪些域名来（来源 tab）、用户离开后去哪（目标 tab）——直接/搜索/AI/
社交/邮件各渠道背后具体是哪些站。找引荐外链源、看「谁在给竞品送 AI 流量」从这页进。

## 数据清单

1. **类别汇总卡**（来源 tab 顶部）：总计 46,486 个来源域，按渠道计数——AI 流量 26、
   引荐 45,065、自然搜索 488、谷歌 AI 模式 1、付费搜索 28、自然社交 614（canva.com，2026-07）。
2. **主表**：50 行 × **6 列** = 300 格，实测 **filledCells=272**（「类别」列部分行为空，
   属数据本身缺失，非渲染未完成）。列：来源、类别、渠道、流量比例、访问量、位差。
3. **分页器**：Page 1 of **930**。
4. 样例行（canva.com，2026-07）：canva.com 直接 79.32% 6.3亿 ↑4.4%；
   google.com「Google 自然搜索」自然搜索 11.06% 8785.3万 ↑3.79%；
   chatgpt.com AI 流量 0.46% 363.9万 ↑18.48%；mail.google.com 电子邮件 0.41% 325.8万。

## 形状与就绪

- 形状：**table**（manifest `readyBranch=table`）。就绪判据：**filledCells > 0**。
- 注意：本页满值是 **272 而非 300**——「类别」列天然有空格。判「渲染完成」看
  filledCells 稳定在 272，不要等 300。
- 实测时间线（2026-08-29）：**就绪 36.9 秒**，5 轮 poll，refreshCount=1，stopReason=stable。

## 怎么采

```sh
platforms/semrush/traffic-analytics/sources-destinations/collect.sh [domain] [out-dir]
# 默认 domain=canva.com；证据落 backlink/evidence/ground-truth/ 下带时间戳目录
```

内部是一条 `node backlink/scripts/ground-truth.mjs --url … --out … --budget 240`：
自动持机器级 semrush 锁、会话 `semrush-nav`、轮询→成对截图+census→manifest。
采完由 AI 对质双证人出结论（脚本不判决），配额纪律见 `../../OVERVIEW.md`。
「目标」tab 与翻页采集（930 页）尚无脚本。

## 已知坑

| 坑 | 细节 |
|---|---|
| 空格是数据不是故障 | 「类别」列很多来源就是「无类别」或空——filledCells 272<300 是本页常态 |
| 首行是自己 | 来源表首行 canva.com 直接 79.32%——「直接流量」的来源记为域名自身，别当外部来源统计 |
| 壳会骗文本判据 | 深层壳文本 ~1.6M 字符先于数据到位；deepTextLength 阈值判据会误判 |
| 表头词重复两遍 | columnheader innerText 形如「来源 来源」，解析去重 |
| `tables=1` 有歧义 | 真实 `<table>`=0，主表是 `[role=grid]` DIV，读 `grids` 字段 |
| 共享标签页会被抢 | 会话 `semrush-nav` 共享标签页，同板块其他路由实测被导走过；判决前核对每轮 href |
| 「导航成功」≠「有数据」 | open 秒回，数据 37 秒后才落 |

## 验证记录

- **2026-08-29**（UTC 08:08–08:09）双证人复核，canva.com，会话 `semrush-nav`。
  退出码 0（stable，readyBranch=table），就绪 36.9s，refreshCount=1，5 组截图+census。
  filledCells=272 与历史 272 **精确一致**；抽查 79.32%、8785.3万（google.com 自然搜索）
  均在 census-s1 命中；6.3亿直接访问与 canva 7.9 亿月访问量级一致。Page 1 of 930。
  裁决：**confirmed-data**。
  证据（本地，gitignore）：`backlink/evidence/ground-truth/recheck-sources-destinations/`，
  判决书 `backlink/evidence/ground-truth/recheck-VERDICTS.md`。
- 截图档案：`assets/loaded.png`（来源 tab + 类别汇总卡 + 主表首行）。
