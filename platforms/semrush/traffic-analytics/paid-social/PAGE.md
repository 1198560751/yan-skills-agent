# Traffic Analytics · Paid Social（付费社交）

## 页面身份

- URL 模板：`https://sem.3ue.co/analytics/traffic/paid-social/?q=<domain>&searchType=domain`
  - `q`：目标域名；`searchType`：固定 `domain`
  - 面板可能自动附加 `lid=` 与 `__gmitm=`（剥敏，只留键名）——都不需要手动传
- `document.title`：`Dashboards`（不反映页面内容，别拿它当落点判据）
- 页面标题/左侧导航「付费社交」高亮；维度：全球 / 月份 / 所有设备

## 回答什么业务问题

竞品付费社媒投放带来多少月流量、趋势涨跌、桌面/移动怎么分。
判断「竞品在社媒买不买量」的量级基准从这页进。

## 数据清单

**本页没有任何表格（grids=0、cells=0），数据在图表里**（canva.com，2026-07 实测）：

1. **流量趋势**折线图：y 轴顶 **20万**（刻度序列 5万/10万/15万/20万），
   数据点 **14万–17万** 区间。即付费社交月流量十几万级——自然社交（千万级）的约 1%。
2. **桌面设备趋势**（20万轴）/ **移动设备趋势**（3万轴）两张分图。
3. 轴刻度、系列名都在穿透后的 `deep.svgText` 里（**45 个 SVG 文本节点**，light=deep）。

**没有表格 ≠ 没有数据**：历史判决曾把本页记成「无数据」，2026-08-29 双证人重测推翻。

## 形状与就绪

- 形状：**chart-only**。filledCells 恒 0 是本页常态。
- 就绪判据：**svgText > 0 且三轮稳定**（chart 分支）；空态分界是 svgText=0（见 `email/`）。
- 2026-08-29 证据采集时 collector 还只有 table 判据，故该轮退出码 2（budget，
  30 轮 poll、刷新 2 次无效也无害）；chart 分支上线后重跑应 stable 提前退出。

## 怎么采

```sh
platforms/semrush/traffic-analytics/paid-social/collect.sh [domain] [out-dir]
# 默认 domain=canva.com；证据落 backlink/evidence/ground-truth/ 下带时间戳目录
```

内部是一条 `node backlink/scripts/ground-truth.mjs --url … --out … --budget 240`：
ground-truth.mjs 自动走 chart 就绪分支（svgText>0 三轮稳定），无需额外参数。
采完由 AI 对质双证人出结论：量级从截图读曲线区间、从 deepText 核对轴刻度，两证互验
（本页双证人对质样例：轴刻度序列 5/10/15/20万 像素↔DOM 逐项一致）。

## 已知坑

| 坑 | 细节 |
|---|---|
| **没有表格≠没有数据** | 历史 no-table-structural（34/5）的「无数据」引申是错的——数据存在，形状是图 |
| filledCells 判据永不触发 | 等 filledCells>0 会烧满预算退出码 2；认 svgText |
| 量级很小是常态 | 轴顶 20万 与邻居路由差 2–3 个数量级；别把小轴当渲染故障 |
| 曲线精确值不在文本里 | svgText 只有轴刻度/系列名；能落的结论是区间量级（14万–17万） |
| 壳会骗文本判据 | 深层壳文本 ~1.6M 字符先于图表到位；deepTextLength 阈值判据会误判 |
| 共享标签页会被抢 | 会话 `semrush-nav` 共享标签页；判决前核对每轮 href |

## 验证记录

- **2026-08-29**（UTC 07:28–07:32）双证人重测，canva.com，会话 `semrush-nav`。
  退出码 2（budget，当时无 chart 分支——预期路径），30 轮 poll，refreshCount=2。
  filledCells=0；deep.tables 0 / deep.grids 0 / **svgText 45**。
  截图落点正确（「付费社交」高亮、canva.com），y 轴顶 20万，数据点 14万–17万；
  桌面 20万轴 / 移动 3万轴分图。抽查 5万/10万/15万/20万/付费社交 **全部命中 deepText**
  （轴刻度序列与截图逐项一致）。
  裁决：**chart-only**（付费社交月流量 14万–17万 量级）；历史「无数据」判决被推翻。
  证据（本地，gitignore）：`backlink/evidence/ground-truth/remeasure-paid-social/`，
  判决书 `backlink/evidence/ground-truth/remeasure-VERDICTS.md`。
- 截图档案：`assets/loaded.png`（趋势折线图 + 桌面/移动分图）。
