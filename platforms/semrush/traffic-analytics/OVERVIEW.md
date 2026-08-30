# Traffic Analytics（流量与市场）板块索引

URL 基式：`/analytics/traffic/<路由>/?q=<domain>&searchType=domain`（host: sem.3ue.co）。
19 条路由已于 2026-08-29 用双证人（ground-truth.mjs）全部判决，判决书见
`backlink/SKILL.md` 的 `<semrush-traffic-route-capabilities>` 块（证据目录 gitignore，本地在
`backlink/evidence/ground-truth/remeasure-*` 与 `recheck-*`）。

## 有表格数据的路由（readyBranch=table）

| 路由 | filledCells (canva.com) | 回答什么 | PAGE.md |
|---|---|---|---|
| `top-pages` | 850（50 行×17 列，共 1,430 页） | 竞品哪些页面扛流量、各渠道占比 | **✅ `top-pages/PAGE.md`** |
| `subfolders-subdomains` | 900 | 流量按子目录/子域怎么分 | ✅ [`subfolders-subdomains/PAGE.md`](subfolders-subdomains/PAGE.md) |
| `usa` | 459 | 美国市场切片 | ✅ [`usa/PAGE.md`](usa/PAGE.md) |
| `sources-destinations` | 272 | 流量从哪来、往哪去 | ✅ [`sources-destinations/PAGE.md`](sources-destinations/PAGE.md) |
| `audience-overlap` | 204 | 受众与谁重合 | ✅ [`audience-overlap/PAGE.md`](audience-overlap/PAGE.md) |
| `geographical-regions` | 198 | 地理分布 | ✅ [`geographical-regions/PAGE.md`](geographical-regions/PAGE.md) |
| `business-regions` | 36 | 商业大区分布（四区合计 ≈7.9 亿，与月访问量对齐） | ✅ [`business-regions/PAGE.md`](business-regions/PAGE.md) |
| `page-groups` | 20 | 页面分组 | ✅ [`page-groups/PAGE.md`](page-groups/PAGE.md) |
| `demographics` | 20 | 人口画像 | ✅ [`demographics/PAGE.md`](demographics/PAGE.md) |

## 数据不在表格里的路由

| 路由 | 形状 | 规模（canva.com 月度） | PAGE.md |
|---|---|---|---|
| `behavior` | 摘要卡+社媒条+兴趣条+设备环图（值在 DOM 文本） | — | ✅ [`behavior/PAGE.md`](behavior/PAGE.md) |
| `socioeconomics` | 卡片+条图/堆叠图，九条 chart 路由里最稠 | — | ✅ [`socioeconomics/PAGE.md`](socioeconomics/PAGE.md) |
| `referral` | chart-only | 40M–60M | ✅ [`referral/PAGE.md`](referral/PAGE.md) |
| `organic-search` | chart-only | 100M–130M（轴顶 150M） | ✅ [`organic-search/PAGE.md`](organic-search/PAGE.md) |
| `paid-search` | chart-only | 0.8M–1.15M（轴顶 1.5M） | ✅ [`paid-search/PAGE.md`](paid-search/PAGE.md) |
| `organic-social` | chart-only | 11M–24M（轴顶 30M） | ✅ [`organic-social/PAGE.md`](organic-social/PAGE.md) |
| `paid-social` | chart-only | 140K–170K（轴顶 200K） | ✅ [`paid-social/PAGE.md`](paid-social/PAGE.md) |
| `display-ads` | chart-only | 45K–170K | ✅ [`display-ads/PAGE.md`](display-ads/PAGE.md) |
| `daily-trends` | chart-only | 日访问 20M–35M（轴顶 40M） | ✅ [`daily-trends/PAGE.md`](daily-trends/PAGE.md) |
| `email` | **时变**：2026-08-29 空态（svgText=0）→ 2026-08-30 同域有图（svgText=31） | 轴顶 1000万（有图轮） | ✅ [`email/PAGE.md`](email/PAGE.md) |

## 板块级要点

- **「没有表格」≠「没有数据」**——历史上这条错误推断在 9 条路由里错了 8 条。
  chart 路由的轴标签、系列名、数值都在穿透后的 `deep.svgText` 里（13–1132 节点）。
- 就绪判据两分支：`filledCells > 0`（先查）→ `svgText > 0` 三轮稳定（chart 分支），
  manifest 记 `readyBranch`。
- `email` 曾被判唯一真空态（svgText=0，2026-08-29），**2026-08-30 同域（canva.com）
  渲染出真图（svgText=31）——判决降级为「时变/水合相关」**：svgText=0 只能判
  「本轮空」，判不了「该路由恒空」；详见 `email/PAGE.md`。
- **平台坑：全树 `q=` 被 `lid` 覆盖（2026-08-30 round4 实锤）**。面板会自动附加
  `lid=<未命名列表>`，此后**所有** `/analytics/traffic/*` 子路由渲染的都是列表域的
  数据，href 里的 `q=` 是摆设（`?q=nytimes.com` 落点仍渲染 canva.com）。换域必须先
  换共享「未命名列表」的域名 chip 或建新列表——而现存列表被历史证据引用、只读纪律下
  不动，**换域采集是待裁决事项，不是 bug**。判决书：`semrush-round4-VERDICTS.md` 页卡 7。
- **骨架屏 + 分页计 0 + 导出置灰 ≠ 空态**：sources-destinations 目标 tab 实测两轮
  ~4 分钟全骨架、第三轮出数——判空必须等到非骨架行或明确空文案。
