# 环节闸门：每个环节的 checklist

**这是 rankup 的主线。每个环节都有一套 check，不过 check 不许进下一个环节；每一轮迭代新做的东西，也要把相关的 check 重新过一遍。这是硬性门槛，不是建议。**

读这个文件的是 Agent，不是解释器。**判断由你做**——「三方对账一致吗」「每条 AI 建议都有采纳或拒绝理由吗」这类事没有任何脚本能替你判，去看真实代码、真实线上响应、真实后台读数，然后下判断。

只有真机械的那一层（`.rankup/` 里某个文件在不在、够不够大、含不含某个词）才交给
`scripts/review.mjs`，它给的是「文件层面的缺口清单」，**不是「这一项做对了」**。
一个 500 字节的 `audit.md` 能让脚本变绿，但里面写的是不是全站逐 URL 的 TDK 结果，只有你能看出来。

## 两层 check：闸门 + 步骤

| 层 | 在哪 | 回答什么 | 什么时候跑 |
|---|---|---|---|
| **闸门 check**（本文件） | `checklists.md`，一个环节一张表 | **这个环节能不能算完、能不能进下一个** | 环节收尾时 |
| **步骤 check** | 各阶段自己的 md 里，紧跟在必做动作后面（[`lifecycle.md`](lifecycle.md) 每个阶段的「步骤 check」一节） | **这一步做对了没有** | 每做完一步就核 |

**关系是单向的：闸门过不了，一定是某条步骤 check 没过。** 反过来不成立——
步骤全过不自动等于闸门过，闸门还要判跨步骤的一致性
（例如阶段 1 每个词单独看都齐了，但意图核验与搜索量核实的先后顺序看不出来）。

**为什么步骤 check 不写在这里**：它脱离动作原文就没法读。硬塞进本文件会逼着执行的人
在两个文件之间来回翻，而判据和动作一旦分家，改了动作没改判据是必然发生的事。

## 三条规则

| 规则 | 为什么 |
|---|---|
| **每条 check 都要有证据，证据要写清楚在哪个文件的哪一段** | 这套东西唯一致命的失败形态是**看着全绿、底下什么都没有**。只跑了命令、没留下证据不算过；控制台一个绿色图标不是证据 |
| **闸门判据写在这里，步骤判据紧贴动作，操作说明写在各自的 md** | 同一件事在两处各写一份，改了一处另一处就静默过期，而两边看起来都正常。所以本文件的「怎么做」一列只给一句话加一个指路 |
| **过不了就写清为什么过不了** | 需要 CAPTCHA、需要付费决策、需要用户的物理操作 —— 这些标 ⏸ 并写明卡在哪、需要用户做什么，不要留一个悬空的空格 |

**还有一条贯穿全程的：任何调研都要亲眼去搜索引擎看一遍第一页。** 数据平台给的是模型输出与面板外推，首页是搜索引擎此刻真正端给用户的东西。至少 Google + Bing，做非英语市场再加目标市场的本地引擎，方法见 [`demand-sources.md`](demand-sources.md) 第一·五节。

## 复查口径：哪些 check 下一轮还要再过

| 口径 | 含义 | 典型 |
|---|---|---|
| **一次** | 过了就一直过，技术事实不会自己退回去 | 脚手架跑通、zone 生效、远端仓库存在 |
| **每轮** | **每一轮迭代都必须重跑** | 三方对账、构建全绿、性能基线、迭代记录 |
| **动了 URL** | 本轮新增或修改了线上可访问的 URL 才必须重跑 | 上线前闸门的 TDK、技术 SEO、IndexNow 推送 |
| **会过期** | 依赖的外部数据是易腐品，超过 30 天必须重取 | SERP 快照、关键词裁决 |

**每轮开工时的第一个动作**：把上一轮标记为「每轮」的 check 全部打回未过，
本轮动过线上 URL 的把「动了 URL」那一批也打回。**不打回等于默认继承上一轮的绿灯**，
而这正是清单腐坏的起点。

## 状态记在 `<project>/.rankup/checks.md`

一个环节一段，格式和 `integrations.md` 同构（✅ 已过 / ⬜ 未过 / ⏸ 卡住 / ❌ 判定不做）：

```markdown
## 阶段 7.5 · 上线前闸门（第 3 轮）

| 检查项 | 状态 | 证据 | 日期 |
|---|---|---|---|
| 闸门 2 · TDK | ✅ | seo-audit 全站 42 URL 必修观察项为零（判读口径见 seo-box.md），逐 URL 结果在 audit.md「TDK」一节 | 2026-08-28 |
| 闸门 5 · 哥飞 AI 审阅 | ⏸ | 缺 SEO_WEBCAFE_COOKIE，需要用户在浏览器登录一次 | 2026-08-28 |
| 闸门 6 · 性能 CWV | ⬜ | — | — |
```

**状态在项目侧，判据在这里，两边不得各存一份。** 本文件不写任何站名、域名、真实数字。

---

## 阶段 0 · 恢复并对账项目上下文

说明见 [`lifecycle.md`](lifecycle.md) 阶段 0。

| 检查项 | 客观通过条件 | 证据落点 | 怎么做 | 复查 |
|---|---|---|---|---|
| 项目记忆存在且可导航 | `.rankup/INDEX.md` 与 `PROJECT.md` 存在，INDEX 的导航指向真实存在的文件 | `.rankup/INDEX.md` | 缺目录跑 `rankup init`；结构见 [`project-memory.md`](project-memory.md) | 每轮 |
| 三方对账通过 | `git log -25`、真实路由/页面清单、线上 `sitemap.xml` 全量 `<loc>` 三者与 `plan.md` 的勾选一致；不一致的已回写 | `.rankup/plan.md` | 三样各查一次再比对，**勾选框是滞后指标，读到「未开始」先去代码里验证** | 每轮 |
| Skill 版本状态已记录 | `skill-state.json` 记着本地版本与最近检查时间 | `.rankup/skill-state.json` | `check-version.mjs --project-root . --apply` | 每轮 |

## 阶段 1 · 机会与市场调研

说明见 [`lifecycle.md`](lifecycle.md) 阶段 1、[`experiences/demand-discovery.md`](experiences/demand-discovery.md)、[`demand-sources.md`](demand-sources.md)。

**执行清单**：[`research-checklist.md`](research-checklist.md) 是本环节的展开——9 节、40+ 个步骤，覆盖 seo.web.cafe / Semrush / Similarweb / Google Trends / 收入三榜 / 折成钱的完整工具链。**每次调研必须逐项走完那张清单，不许只用一部分工具。**

| 检查项 | 客观通过条件 | 证据落点 | 怎么做 | 复查 |
|---|---|---|---|---|
| **多引擎首页实勘** | 目标词/方向在 **Google + Bing + 目标市场本地引擎**（做非英语市场时必看）各搜过一遍，**且是无痕/隔离窗口、显式指定了地区与语言**；每个引擎按 [`demand-sources.md`](demand-sources.md)「每个引擎记下这七样」一节逐样记全，带引擎+国家+日期（七样是什么以那一节为准，本表不复述）。**引擎之间不一致要写出来，不能只留一个「综合印象」** | `.rankup/keywords.md`（词级）或 `.rankup/decisions.md`（方向级） | 见 [`demand-sources.md`](demand-sources.md) 第一·五节。**这一步在任何取数之前**，不许拿 `serp-query.mjs` / `seo-webcafe.mjs serp` 这类二手接口代替——它们看不到版式、SERP 特性和 AI 答案。DuckDuckGo 用的是 Bing 索引，**和 Bing 不算两个独立样本** | 会过期 |
| 需求证据 | 每个进入开发的机会都有两条来源不同的证据，至少一条是直接信号（GSC 曝光 / Suggest / 持续投放 / 可核验收入）。证据不足的仍标 `RESEARCH`，没有被写成已验证 | `.rankup/decisions.md` | `scripts/demand/` 取数 → [`demand-sources.md`](demand-sources.md) 第十节的候选验证链路 | 一次 |
| 每个「做」的词有完整裁决 | 六项证据同时对得上：搜索量、KD、SERP 构成、意图核验、链接预算、目标页面。**意图核验与搜索量核实是两条分开可见的记录** | `.rankup/keywords.md` | `seo-webcafe.mjs kd --keyword <词>`；判断读 [`webcafe-topics.md`](experiences/webcafe-topics.md) 一 | 会过期 |
| SERP 快照是当天的 | 每个词的 SERP 构成带日期；写了「窗口在关闭」的词另带一个不超过一个月的复测日期 | `.rankup/keywords.md` | 拉一次真实 top10。**先读 [`seo-growth.md`](seo-growth.md) 的 `google.com/goto` 一节**——二手 SERP 通道会降级但照样 200，盘面「突然空了」先怀疑通道 | 会过期 |
| **词表已反查竞品补第二轮** | 自己扩的词池与 **3–5 个同赛道、站龄 9–24 个月竞品的实际排名词库**（每站前 100 词）做过差集，差集里的词逐个补测了量与难度。**被自己判过「太难」的头词也测了**。补漏后**重算了按量加权的 CPC** | `.rankup/keywords.md` | `backlink/scripts/semrush-report.mjs` 取排名词报表；规则见 [`demand-sources.md`](demand-sources.md) 九·六 | 一次 |
| **排上去值不值已折成钱** | 同赛道竞品的**真实流量**（面板，不是关键词模型）已取到并折成收入区间，与词池的模型上界并排写出。**面板与模型的倍差有归因**，不是只写「口径不同」。竞品低于面板收录门槛的，如实记为「无可观测流量」 | `.rankup/roadmap.md`（进立项前置条件）与 `.rankup/decisions.md` | `similarweb-query.mjs` + `semrush-overview.mjs` 取数，`seo-webcafe.mjs money` 折算；**判断读 [`demand-sources.md`](demand-sources.md) 十·五与 ②·六·四**——单个大头词以 #5–#10 撑起竞品过半模型流量时，模型高估 4–13 倍，以面板为准 | 会过期 |
| 量化的继续/停止标准 | `roadmap.md` 有阶段目标与放弃条件，且放弃条件是可判定的数字或事实，不是「效果不好就停」 | `.rankup/roadmap.md` | 判据取自 [`zero-to-one.md`](experiences/zero-to-one.md) 的止损线一节 | 一次 |

## 阶段 2 · 产品与架构设计

说明见 [`lifecycle.md`](lifecycle.md) 阶段 2、[`cloudflare-stack.md`](cloudflare-stack.md)。

| 检查项 | 客观通过条件 | 证据落点 | 怎么做 | 复查 |
|---|---|---|---|---|
| 关键路径有可测试的验收标准 | `plan.md` 每条 P0 都写了动作、证据、预期影响和完成判定 | `.rankup/plan.md` | 手写 | 每轮 |
| 每个 Cloudflare 服务都有理由 | 每个服务写明需求、binding、环境边界和失败处理；**没有「以后可能需要」而提前创建的资源** | `.rankup/architecture.md` | 对照 [`cloudflare-stack.md`](cloudflare-stack.md) 逐项填 | 一次 |
| 高风险动作有回滚方案 | 数据、支付、发布三类各有一条回滚路径 | `.rankup/decisions.md` | 手写 | 一次 |

## 阶段 3 · 初始化项目

说明见 [`lifecycle.md`](lifecycle.md) 阶段 3。

| 检查项 | 客观通过条件 | 证据落点 | 怎么做 | 复查 |
|---|---|---|---|---|
| 脚手架真实可运行 | Monorepo 被包管理器识别，dev/build 脚本真实跑通，用户已有文件没被覆盖 | 项目仓库 | 真跑一遍，不看脚手架的成功输出 | 一次 |
| 构建缓存生效 | 连续两次构建，第二次命中缓存 | 项目仓库 | 连跑两次比对耗时与缓存日志 | 一次 |
| 站点身份不是模板占位 | title/description/manifest/OG 里没有脚手架预设文案，且是目标市场语言 | 项目仓库 | grep 脚手架默认字符串 | 一次 |
| 远端仓库存在且已推送 | `git remote` 有值，当前状态已推，**远端默认私有** | 项目仓库 | 未上线项目的仓库里带着选题与定价策略，公开等于把选题送人 | 每轮 |
| 入库内容不含凭据 | 将要入库的文件里没有真实密钥、token、私钥 | 项目仓库 | 提交前扫一遍 diff | 每轮 |
| 域名跳转是 301 且不超过一跳 | 裸域/www、http/https 收敛到同一个规范域，**中间每一跳都是 301**；302/307 不传权重 | `.rankup/infrastructure.md` | `curl -sIL <四种入口> \| grep -iE '^(HTTP/\|location:)'`，判据见 [`seo-box.md`](seo-box.md) 二。要**全站**而不只是这四个入口，用 `ahrefs-site-audit.mjs report <id> redirects` | 动了 URL |

## 阶段 4 · 建立 Cloudflare 全栈基础

说明见 [`cloudflare-stack.md`](cloudflare-stack.md)。

| 检查项 | 客观通过条件 | 证据落点 | 怎么做 | 复查 |
|---|---|---|---|---|
| 真实 SSR/API 路径能跑 | 至少一条 SSR 页面和一条 API 路由在本地或预览环境返回预期内容 | `.rankup/infrastructure.md` | `wrangler dev` + curl | 一次 |
| bindings 完成最小读写验证 | 每个声明的 binding 都做过一次真实读写，不是只在配置里存在 | `.rankup/infrastructure.md` | 逐个 binding 跑一次 | 一次 |
| zone 与 NS 用真实解析核验 | `dig` 的真实返回，**不是「已告知用户改 NS」就结项** | `.rankup/infrastructure.md` | `dig NS <域名> +short` | 一次 |
| 仓库与 `.rankup/` 无真实密钥 | `secrets.md` 只有名称、用途、环境、保管位置 | `.rankup/secrets.md` | 扫描 | 每轮 |

## 阶段 5 · 开发与测试

说明见 [`lifecycle.md`](lifecycle.md) 阶段 5。

| 检查项 | 客观通过条件 | 证据落点 | 怎么做 | 复查 |
|---|---|---|---|---|
| 目标验收场景通过 | 本轮定义的可观察结果逐条达成 | `.rankup/plan.md` | 按 plan.md 的完成判定逐条核 | 每轮 |
| 类型检查、测试、生产构建全绿 | 三样都跑过且通过。**失败不得隐瞒，也不得把旧失败归因到本次改动** | 项目仓库 | 项目自己的 check-types / test / build | 每轮 |
| 关键路径不只由 mock 证明 | 至少一条端到端或真实浏览器验证覆盖关键交互 | `.rankup/audit.md` | 真实浏览器或等价 E2E | 每轮 |
| 未解决问题有处置计划 | 每条遗留问题都写了证据、影响、处置计划，不是只列现象 | `.rankup/audit.md` | 手写 | 每轮 |

## 阶段 6 · 集成专项能力

说明见 [`integrations.md`](integrations.md)。

| 检查项 | 客观通过条件 | 证据落点 | 怎么做 | 复查 |
|---|---|---|---|---|
| 集成在目标环境端到端验证 | 不是本地 mock 通过就算 | `.rankup/integrations.md` | 按 [`integrations.md`](integrations.md) 逐项验证 | 每轮 |
| 回调签名、幂等、错误路径 | 三类各有一次真实验证记录 | `.rankup/integrations.md` | 构造真实回调与重复回调 | 一次 |
| 四处均未暴露密钥 | 代码、日志、Git、`.rankup/` 扫描都干净 | `.rankup/secrets.md` | 扫描 | 每轮 |

## 阶段 7 · 部署并真实线上验证

说明见 [`lifecycle.md`](lifecycle.md) 阶段 7。

| 检查项 | 客观通过条件 | 证据落点 | 怎么做 | 复查 |
|---|---|---|---|---|
| 线上部署关联到预期提交 | 部署状态里的提交号 = 本轮要发的提交 | `.rankup/releases.md` | `wrangler deployments` 或 CF 面板 | 每轮 |
| 真实域名返回预期 SSR HTML | curl 拿到的原始 HTML 里有预期正文，不是壳。**构建成功 / Worker upload 成功 / 健康页 200 都不算完成** | `.rankup/releases.md` | `curl -s https://<域名>` | 每轮 |
| 关键 API、bindings、上传、鉴权、支付回调 | 适用项逐条在线上跑过一次 | `.rankup/releases.md` | 逐条真实请求 | 每轮 |
| 回滚目标和方法已记录 | 写明回滚到哪个版本、用什么命令 | `.rankup/releases.md` | 手写 | 一次 |
| 索引推送焊进出荷命令 | 项目自己的 ship 命令末段带索引推送，**脚本在项目仓库内而不是指向 Skill 目录** | 项目仓库 | 见 [`search-platforms.md`](search-platforms.md)「挂进发布流程」。这是静默收尾动作：漏了不会有任何东西变红 | 动了 URL |

## 阶段 7.5 · 品牌资产与测量接入（上线前闸门七行）

说明见 [`lifecycle.md`](lifecycle.md) 阶段 7.5。**判据的完整版在那边，本表只是取用口。**
下表前七行（闸门 0-6）对应 D 节那张七行表；余下五行不在 D 表里，各有出处：
「分析通道在采集」出自 B 节第 7-8 条，「IndexNow」「两边 sitemap 已提交」「接入清单逐行有状态」
出自 C 节的平台清单与该阶段的出口条件，「封板声明」出自 D 节后面的第 17 条。
**改判据要回各自的出处改，别只改这张表。**
站主原话：「这些东西都必须要走一遍……这是硬性要求」。**只跑了命令、没留下证据不算过这项。**

| 检查项 | 客观通过条件 | 证据落点 | 怎么做 | 复查 |
|---|---|---|---|---|
| 闸门 0 · 站点身份 | OG 元数据（`og:image` ≥1200px）与图标全集线上 200，`manifest.json` 引用全部命中真实文件，标记经 16px 实测 | `.rankup/integrations.md` | curl 各路径 + 人工核对线上 HTML | 动了 URL |
| 闸门 1 · 技术 SEO | sitemap 条目与真实 URL 集合一致且零 404；内链零 404；`llms.txt` 列出的路径与真实 URL 一致（不是模板占位）；robots 未误挡应收录路径 | `.rankup/audit.md` | 抓 sitemap 逐条请求 + 抓全站内链逐条请求 + 请求 `/robots.txt`。站点已在 Ahrefs 里验证过所有权时，`ahrefs-site-audit.mjs report <id> links` 是**第二双眼睛**——**两边都说没问题才算数，且必须一起记下 Ahrefs 那次抓取的日期**（它抓的可能是几天前的站）。Ahrefs 报的每条问题要用 `issues --json` 里的 data-explorer 链接拿逐 URL 清单，与本地 `seo-audit.mjs` 的结果对上再修，修完手动重抓核销 | 动了 URL |
| 闸门 2 · TDK | 全站 title 互不重复、description 互不重复且长度在截断阈值内；**每页恰好一个 `h1`**；必修观察项清零（seo-audit 已改为只出事实记录，哪些算必修按 [`seo-box.md`](seo-box.md)「seo-audit 判读指引」判：NO_TITLE / NO_DESCRIPTION / NO_VIEWPORT / NO_H1 / NOINDEX 等为零，`fetchError` 为零——抓取失败 ≠ 通过）。**覆盖全站每一个 URL，不是抽样** | `.rankup/audit.md`（逐 URL，不是一条总述） | `seo-audit.mjs --sitemap <url> --json`，逐条读 `issues` | 动了 URL |
| 闸门 3 · 关键词密度 | 密度在自然区间，且**「声明的短语」与「测量的短语」逐页是同一个字符串** | `.rankup/audit.md` | `seo-audit.mjs --sitemap <url> --density-only`。实测过 8 个页面在构建绿灯下全过，逐页核对才发现每页测的都不是自己声明的短语 | 动了 URL |
| 闸门 4 · GEO / AI Agent 就绪度 | 有带分数与逐项结果的基线报告，且**每条 `partial`/`failed` 都独立核实过**（成立则改，误报则记驳回理由） | `.rankup/agentic/<domain>/<date>.json` + 核实结论进 `audit.md` | `is-agentic.mjs scan <domain> --save` | 每轮 |
| 闸门 5 · 哥飞 AI 审阅 | 每条建议有采纳/拒绝记录，拒绝附理由；**`done` 事件的 `toolCalls`、`rounds`、`charged` 已打印并记录** | `.rankup/audit.md` | `seo-webcafe.mjs chat --ask "审阅 https://<域名> …"`，见 [`seo-webcafe.md`](seo-webcafe.md) | 动了 URL |
| 闸门 6 · 性能 / CWV | 首页、工具页、内容页三类都达到**项目自设下限**；实验室与现场数据都记录，不一致以现场为准；**先验仪器再信读数** | `.rankup/baseline.md` | `pagespeed.mjs plan <三类页面 URL> --strategy both` 出链接与读数清单，再**在浏览器里打开 pagespeed.web.dev 读数**（2026-08-31 起走网页版，零 key 零配额；也可 `pagespeed.mjs collect …` 采双证人）——**网页版一屏同时给实验室（Lighthouse）与现场（CrUX）**；单跑 Lighthouse 只给实验室，这条闸门只能过一半而表面是绿的。`--strategy both` 另指移动端 + 桌面端都跑。**现场那一块不存在 = CrUX 流量不足，原样记「现场无数据（流量不足）」，不是 0、不等于通过，更别留空**（见 [`seo-box.md`](seo-box.md)「一 · PageSpeed 网页版 → 补上闸门 6 缺的那一半」） | 每轮 |
| 分析通道在采集 | **线上原始 HTML 里 grep 得到 beacon**。控制台显示「已启用」不算 | `.rankup/integrations.md` | `cf-analytics-setup.mjs status <domain>` | 每轮 |
| IndexNow | 密钥文件正文逐字节等于密钥，首次推送已被接受并记下条数与 HTTP 状态 | `.rankup/integrations.md` | `indexnow-submit.mjs`。**密钥不可达时整批被丢弃而接口照样回 200** | 动了 URL |
| 两边 sitemap 已提交 | GSC 与 Bing 都提交过，记的是**快照日期**不是实时值；**记的是资源 ID 不是资源名字** | `.rankup/integrations.md` | `webmaster-sitemap.mjs <gsc\|bing> submit` | 动了 URL |
| 接入清单逐行有状态 | 每个平台标 ✅（证据+日期）/ ⬜ / ❌（裁决依据）；卡住的写明阻塞原因与需要用户做什么 | `.rankup/integrations.md` | 对照 SKILL.md「接入清单跟踪」的平台表 | 每轮 |
| 封板声明（分数接近满分时） | 剩余建议逐条判「不做」并写理由 | `.rankup/audit.md` | 不封板，团队会持续消耗在零边际收益的项上，而真正的瓶颈动都不动 | 每轮 |

## 阶段 8 · SEO 与内容增长

说明见 [`seo-growth.md`](seo-growth.md)、[`lifecycle.md`](lifecycle.md) 阶段 8。

| 检查项 | 客观通过条件 | 证据落点 | 怎么做 | 复查 |
|---|---|---|---|---|
| 线上技术信号已核实 | 改了什么就在线上核过什么，不是本地看着对 | `.rankup/audit.md` | `seo-audit.mjs --sitemap <url>` | 每轮 |
| 本轮改过的旧 URL 跳转正确 | 每个被改/被删的旧 URL 都 301 到新址，**不是 302，也不是软 404 落回首页** | `.rankup/audit.md` | `curl -sIL <旧 URL>`，见 [`seo-box.md`](seo-box.md) 二 | 动了 URL |
| 目标词首页复看 | 本轮动过的目标词，在 Google 与 Bing 各重看一次首页：自己的页面进没进、AI 答案引用名单变没变、盘面有没有新进入者 | `.rankup/experiments.md` | 同 [`demand-sources.md`](demand-sources.md) 第一·五节的七样，只记变化 | 每轮 |
| 实验有基线、目标指标、回看日期 | 三样齐全。**没有观察窗口就没有结论** | `.rankup/experiments.md` | `is-agentic.mjs diff` + `pagespeed.mjs plan --strategy both` 出链接后重读网页版（**不是单跑 Lighthouse**，那只有实验室一半） | 每轮 |
| AI 搜索合规项已检查 | Back Button、FAQ schema 现状、非大众化内容审计三项都查过并记录 | `.rankup/audit.md` | 对照 [`seo-growth.md`](seo-growth.md) 三-B | 每轮 |
| 没有承诺未经观察窗口的结果 | 结论都带观察窗口；排名没稳（连续 5 天不动）之前只做加法 | `.rankup/iterations.md` | 自查，判据见 [`webcafe-experiences.md`](experiences/webcafe-experiences.md) 十七~十九 | 每轮 |

## 阶段 9 · 分发与外链

说明见 [`lifecycle.md`](lifecycle.md) 阶段 9、[`webcafe-topics.md`](experiences/webcafe-topics.md) 五，执行在 `backlink` Skill。

| 检查项 | 客观通过条件 | 证据落点 | 怎么做 | 复查 |
|---|---|---|---|---|
| 每项分发有结果 URL 或明确审核状态 | **表单提交成功、成功关键词命中、待付费页面都不算已获得外链** | `.rankup/integrations.md` | backlink 的 `ledger.mjs`，submitted/public/indexed 每级都要证据 | 每轮 |
| 链接预算没被无理由拆分 | 集中投给预算内排最前的目标词；若拆分，`plan.md` 里有拆分理由 | `.rankup/plan.md` | 对照 keywords.md 的链接预算 | 每轮 |
| 两条零成本渠道已做掉 | 公开仓库 README（**外链全 nofollow，买的是收录加速不是权重**）与产品发布平台各有记录；README 与线上 sitemap 逐条 diff 过 | `.rankup/integrations.md` | 仓库 CLI + git；发布平台见 [`product-launch.md`](product-launch.md) | 动了 URL |

## 阶段 10 · 监控、学习与迭代

说明见 [`lifecycle.md`](lifecycle.md) 阶段 10、[`evolution.md`](evolution.md)。

| 检查项 | 客观通过条件 | 证据落点 | 怎么做 | 复查 |
|---|---|---|---|---|
| 指标更新到明确时间点 | 每个数字都带日期和来源 | `.rankup/baseline.md` | 各平台读数 | 每轮 |
| 异常有归因或验证计划 | 定位到具体版本、页面、渠道、环境或集成，**不是只看聚合指标** | `.rankup/iterations.md` | 手写 | 每轮 |
| 本轮迭代已记录 | 做了什么、判据、结果、下一轮唯一改进。**失败轮次写清被证伪的假设** | `.rankup/iterations.md` | 手写 | 每轮 |
| 回流内容已剥离项目信息 | 不含站名、域名、流量数字、property ID；证据与数字留在项目侧 | `.rankup/experience.md` | 回流后跑 `validate-rankup.mjs` | 每轮 |
| 跨项目登记表已刷新 | 本轮新增的可复用脚本已被扫到 | `registry.md` | `registry.mjs scan --roots <目录>` | 每轮 |

---

## 缺 check 的时候

发现某个环节有该做、而本文件里没有的动作时，**先补进这里，再去做**——顺序反了，
这一条就只会存在于那次对话里。补的时候：

1. **只写判据，不写教程。** 「怎么做」一列给一句话加一个指路，操作说明写进对应的 md。
2. 只对当前项目成立的写进项目侧 `.rankup/`，跨项目成立的才进这里
   （晋升门见 [`evolution.md`](evolution.md)）。
3. 定复查口径。**拿不准就写「每轮」**——多跑一次的成本远小于漏跑一次。
