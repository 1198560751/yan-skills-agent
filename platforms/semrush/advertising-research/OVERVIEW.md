# Advertising Research（广告研究）板块索引

URL 基式：`/analytics/adwords/<路由>/?db=us&q=<domain>&searchType=domain`（host: sem.3ue.co）。
`q=` / `db=` 参数**只对本 `/analytics/adwords/` 组生效**（.Trends 侧不吃 `q=`）。
2026-08-30 双证人（ground-truth.mjs，会话 `semrush-nav`，目标 canva.com）判决，判决书见
`backlink/SKILL.md` 的 `<semrush-ads-trends-capabilities>` 块；本地全文
`backlink/evidence/ground-truth/semrush-ads-trends-VERDICTS.md`（gitignore）。

顶部 tab 全集（实见）：排名 / 排名变化 / 竞争对手 / 广告创意 / 页面 / 子域名 ——
organic 四件套的付费版；本轮只实测了 排名 和 广告创意。

## 已判决路由

| 路由 | URL 模板 | 形状 | 规模（canva.com/us） | 回答什么 | PAGE.md |
|---|---|---|---|---|---|
| 排名 positions | `/analytics/adwords/positions/?db=us&q=<domain>&searchType=domain` | 摘要卡+趋势图+表格（readyBranch=table，31s） | 2,607 付费词，100 行/页×27 页 | 竞品投了哪些 Google Ads 词（已验证商业意图词） | **✅ `positions/PAGE.md`** |
| 广告创意 copies | `/analytics/adwords/copies/?db=us&q=<domain>&searchType=domain` | **卡片网格，无表格无图**（data-not-in-table） | 2,118 条广告创意 | 竞品广告文案原文 + 每条文案背书多少词 | **✅ `ad-copies/PAGE.md`** |

## 负面判决 / 死路由（不建目录，留档止损）

| 路由 | 判决 |
|---|---|
| ~~`/analytics/adwords/adshistory/`~~ ~~`/analytics/adwords/adhistory/`~~ | **两条路径都 302 回 positions**（hijack 自检 exit 3）。本账号/版本**无独立 Ads History 工具**：广告组左侧导航实见全集（开始 / Ads Launch Assistant / 广告 AI 代理 / 广告研究 / 谷歌购物广告研究 / AdClarity）里没有它。「某词连投 12 个月」矩阵在本版本 UI 无独立入口；未知 adwords 子路径统一回落 positions。候选替身：Keyword Overview 的广告历史区块（**未探，勿当结论**）。证据：`semrush-adwords-adshistory/`、`semrush-adwords-adhistory-kw/` |

## 同导航组、未采路由（待建候选）

排名变化 / 竞争对手 / 页面 / 子域名 —— 同组 tab 实见未采，URL 形式推定同基式换路由段。

## 板块级要点

- **exit 2 ≠ 空页**：copies 是全平台第一条 data-not-in-table 路由——table/chart 分支
  都不就绪，普通跑法 budget 退出，但 deepText 里数据齐全。判空前必须先 grep deepText；
  采集必须带 `--ready-text`。
- 镜像补丁坑（全平台通用）：gmitm 把 `document.referrer` 的 getter 换掉了，referrer 为空时
  读它直接抛 `Cannot read properties of undefined (reading 'charAt')`——页内 eval 读
  referrer 必须 try/catch。
- 表头词无障碍副本重复两遍（「关键词 关键词」），解析先去重；截图一屏只见约 7 列。
- 配额纪律见 `../OVERVIEW.md`：机器级 semrush 锁、单会话串行、30s 级间隔。
