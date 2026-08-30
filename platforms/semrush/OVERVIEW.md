# Semrush 平台总览

- **host：`sem.3ue.co`**（唯一合法面板 origin；所有 PAGE.md 里的 URL 模板都是它上面的路径）。
- 共享账号，**GURU 套餐 + .Trends add-on**（Traffic Analytics 22 条路由实测有真数据，证明
  .Trends 已带）。会话固定为 `semrush-nav`。
- 全部 URL 剥敏：`__gmitm=` 只留空值键名，任何值都不落盘、不进文档。

## 套餐边界（GURU，摘自 backlink/references/semrush-feature-map.md）

| 维度 | GURU 限额 |
|---|---|
| Projects | 15 |
| 跟踪关键词 | 1,500 |
| 每报表结果数 | 30,000 |
| **每日报表请求** | **5,000**（配额纪律的根源） |
| Site Audit 月爬取页 | 300,000 |

- GURU 有：Content Marketing 工具组、历史数据（2012 起）、Looker Studio、多地点/多设备跟踪。
- GURU 没有：**API 访问**（BUSINESS 独占）——所以才要浏览器采集；PLA 分析、SEO Share of Voice 同样没有。
- Local / Social / App Center 多数应用：各自单独付费，默认当作不可用。

## 配额纪律（碰任何 sem.3ue.co 页面之前必读）

1. **一工具一采集者**：任一时刻至多一个 collector 碰 Semrush——包括人肉手动探索。
   手动探索不持锁曾被持锁的批任务合法驱走（2026-08-29 实测）。
2. **整轮持机器级锁**：`yan-tools-share-semrush.lock`（`backlink/scripts/lib-tools-share.mjs`
   的 `acquireToolsShareBrowserLocks`），第一条命令前拿、`finally` 里放。
   daemon 的同名会话队列只串行单条批命令，不串行整轮——四次实测接管都发生在
   「以为排队就安全」的轮次里。
3. **固定会话 `semrush-nav`**，foreground 出生；每次 census 记录 `href`，落点偏离目标
   路由立刻按 hijack 处理（exit 3），绝不在别人的页面上继续轮询。
4. 双证人纪律：截图 + 穿透 shadow DOM 的 census 成对采集，负面结论（「没数据」「功能不存在」）
   必须两个证人都在场，判决只能由 AI 做，脚本不出结论。

## 平台级坑（跨页面通用）

| 坑 | 表现 | 对策 |
|---|---|---|
| **假付费墙 = URL 编码错误** | 「升级到 Business」整页模糊弹窗稳定复现 | 先怀疑自己的 URL（如 compareWith 用了逗号 %2C 而不是管道 %7C），再怀疑套餐 |
| **壳先到、货后到** | 深层文本 9 秒内就 1.6M 字符，报表数据 60–76 秒才落 | 就绪判据绑 `filledCells > 0`（表格页）或 `svgText > 0` 三轮稳定（图表页），绝不用文本长度 |
| **shadow DOM 埋壳** | light innerText 只有几十字符，42+ 个 shadow root | 一切读数穿透 shadow；但注意报表主体常在 light DOM 里，逐页确认 |
| **302 别名** | `/analytics/organic/pages/` 302 到 `/analytics/toppages/` | 采集直接用落点 URL，或传 `--accept-redirect`，否则被自检当 hijack |
| **表单是 React 受控组合框** | AX 层全盲、合成 value setter 打崩组件 | 配方：`el.focus()` + `document.execCommand("insertText")` 打字、`opencli keys Enter` 提交、纯 `button.click()` 点按钮；**别用 Escape 收下拉**（会清掉未提交文本） |
| **水合看心情** | 同 URL 首开常停在 1.6M 壳（innerText 59–344） | 连续 3 轮 census 不变且 filledCells=0 就 `location.reload()`（ground-truth.mjs 的 stall-refresh 已内置） |
| **图例归一化到根域** | 韦恩图把 express.adobe.com 显示成 adobe.com | 域名以表格列头为准，绝不读图例 |
| **无障碍副本** | 表头 innerText 每个词重复两遍（「页数 页数」） | 解析表头先去重 |

## 板块索引

| 板块 | 目录 | 状态（2026-08-30 批量建成） |
|---|---|---|
| Traffic Analytics（.Trends 流量与市场） | `traffic-analytics/` | ✅ 19/19 页全有 PAGE.md（9 表格 + 9 chart/文本 + email 真空态） |
| Organic Research + Keyword Gap（抄竞品链路） | `organic-research/` | ✅ 6/6 页（keyword-gap、positions、changes、pages、competitors、subdomains） |
| Advertising Research（广告研究） | `advertising-research/` | ✅ 2 页（positions、ad-copies）；其余 4 tab 待建，Ads History 死路由留档 |
| Market Overview + Bulk Analysis | `market-overview/` | ✅ 2 页（overview `?lid=` 直达、bulk-analysis 100 域/次）；3 条死路由留档 |
| Backlink Analytics + 竞对监控 | `backlink-analytics/` | ✅ 7 页（overview、backlinks、refdomains、anchors、indexed-pages、backlink-gap、competitor-monitoring 像素-only） |
| 关键词研究 / 内容 / 站点审计 | 未建目录 | 未勘测；全景见 `backlink/references/semrush-feature-map.md` |
