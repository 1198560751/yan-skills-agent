# Traffic Analytics · Email（电子邮件）

## 页面身份

- URL 模板：`https://sem.3ue.co/analytics/traffic/email/?q=<domain>&searchType=domain`
  - `q`：目标域名；`searchType`：固定 `domain`
  - 面板可能自动附加 `lid=` 与 `__gmitm=`（剥敏，只留键名）——都不需要手动传
- `document.title`：`Dashboards`（不反映页面内容，别拿它当落点判据）
- 页面标题/左侧导航「电子邮件」高亮；维度：全球 / 月份 / 每月 / 所有设备

## 回答什么业务问题

竞品邮件渠道带来多少流量。**注意：对 canva.com 这页是真空态**——邮件渠道
无可展示数值。这页手册的主要价值是记录**无文案空态的判别法**，因为它是
本板块 19 条路由里唯一的真空态，历史上曾被错误归类。

## 数据清单

对 canva.com（2026-07 实测）**本页没有数据**：

1. 页面骨架有四个区块标题：流量趋势 / 桌面设备趋势 / 移动设备趋势 / 增长最快的页面，
   每块带「导出」控件。
2. 区块内容全部是**灰色锯齿占位图**：无坐标轴、无刻度、无数据点；「导出」按钮置灰。
3. deepText 里找不到任何 万/亿 数字；**占位图不带「暂无数据」之类文案**。
4. 对邮件流量可观的其他域名，本页可能呈现与 `referral/` 同构的趋势图——尚未实测（待补测）。

## 形状与就绪

- 形状：**empty-state（真空态）**。判别子是 census 的 **svgText=0**：
  - 本板块 chart-only 路由就绪后 svgText 为 3–1132；**只有空态是 0**。
  - **标记法失效**：占位图没有任何「无数据」文案，detectEmptyState 不触发——
    别等文案，认 svgText=0。
  - 排除加载中：2026-08-29 实测经 2 次刷新 + 30 轮轮询 svgText 恒 0，是稳定空态不是慢渲染。
- ground-truth.mjs 会在 manifest 标 `suspectedEmptyState: true`；**判决仍归 AI**——
  必须双证人合验：像素（灰色锯齿、无数字）+ DOM（svgText 0、无数值文本）互相印证才判空。

## 怎么采

```sh
platforms/semrush/traffic-analytics/email/collect.sh [domain] [out-dir]
# 默认 domain=canva.com；证据落 backlink/evidence/ground-truth/ 下带时间戳目录
```

内部是一条 `node backlink/scripts/ground-truth.mjs --url … --out … --budget 240`。
换别的域名采集时：若 svgText>0 且三轮稳定，说明该域有邮件流量图，按 chart-only
路由（参照 `referral/PAGE.md`）解读；若 svgText 恒 0 且截图是灰色锯齿，判空态。

## 已知坑

| 坑 | 细节 |
|---|---|
| **空态没有文案** | 无「暂无数据」字样，任何基于文案标记的空态检测都不触发；唯一可靠判别子是 svgText=0 |
| 别把空态当加载中 | 灰色锯齿 + 刷新/轮询后恒定不变 = 稳定空态；反之落点正确但恒空白也可能是卡加载（参照 page-groups 的 v1 事故），双证人 + 多轮稳定才可判 |
| 别把空态当「功能不存在」 | 历史判决把本页与 8 条有数据的 chart 路由混为一类记成「无数据」——功能存在、页面存在，只是 canva.com 这个域的邮件渠道无数值；换域名结论可能不同 |
| 「导出」置灰是佐证不是判据 | 置灰状态在截图里可见，但 DOM 判别以 svgText=0 为准 |
| 壳文本照样齐 | 空态页深层壳文本同样 ~1.6M 字符——文本长度判据在空态页也会误判「有货」 |
| 共享标签页会被抢 | 会话 `semrush-nav` 共享标签页；判决前核对每轮 href |

## 验证记录

- **2026-08-29**（UTC 07:34–07:38）双证人重测，canva.com，会话 `semrush-nav`。
  退出码 2（budget），30 轮 poll，refreshCount=2。
  filledCells=0；deep.tables 0 / deep.grids 0 / **svgText 0**（与其他 chart-only
  路由的 43–49 截然不同）。截图落点正确（「电子邮件」高亮、canva.com）：三张卡片
  全是灰色锯齿占位、无坐标轴、无数据点、「导出」置灰；deepText 无任何 万/亿 数字。
  双证人一致：像素与 DOM 互相印证。
  裁决：**empty-state**（canva.com 的电子邮件渠道无可展示数值；经 2 次刷新 +
  30 轮轮询恒定，排除加载中）。历史把它与有图路由归为一类是错的——它连图都没有。
  证据（本地，gitignore）：`backlink/evidence/ground-truth/remeasure-email/`，
  判决书 `backlink/evidence/ground-truth/remeasure-VERDICTS.md`。
- 截图档案：`assets/empty.png`（灰色锯齿占位 + 置灰导出——空态的样子）。
