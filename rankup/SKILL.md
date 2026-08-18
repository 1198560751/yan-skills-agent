---
name: rankup
description: 网站从零到一与长期增长的总控 Skill。用于新建网站、SaaS、工具站或内容站，规划或初始化 TanStack Start Monorepo，使用 Cloudflare Workers、D1、R2 部署全栈应用，接入支付，执行 SEO、内容、外链、上线验证和持续迭代；也负责 Google Trends 查询、关键词难度（KD）估算与选词工作流。用户提到 rankup、rankup init、建站、网站改版、搜索流量、GSC、排名、关键词、CTR、索引、网站增长，或提到 谷歌趋势、Google Trends、搜索热度、热度对比、搜索趋势、trending、"XX 和 YY 哪个更火"、"今天美国/日本在搜什么"、每日热搜、"这个词能不能做站"、"哪个市场/国家有机会"、帮我选 SEO 关键词、选词、选品调研、市场探测、关键词难度、KD、竞争度、SERP 分析、"这个词难不难做"、"做这个词要多少外链" 时使用。
metadata:
  version: "2.19.1"
---

# Rankup 2.0

`rankup` 是网站全生命周期的总控 Skill：恢复项目上下文，判断当前阶段，加载必要的专项能力，完成真实验证，并把项目事实、决策与经验写回 `.rankup/`。

它不重复实现 Wrangler、Stripe、趋势研究或外链工具；它负责把这些能力串成一条长期可维护的网站工作流。

## 安装、版本与自动更新

来源：[Skills.sh](https://skills.sh/yan-labs/yan-skills)

```bash
# 全局安装
npx skills add yan-labs/yan-skills --skill rankup -g -y

# 全局更新
npx skills update rankup -g -y

# 项目级更新
npx skills update rankup -p -y
```

本 Skill 的发布版本记录在同目录 `skill.json`。项目的启用时间、已安装版本和最近检查状态记录在 `.rankup/skill-state.json`。

每次激活 `rankup` 时，定位当前 `SKILL.md` 所在目录并执行：

```bash
node "<rankup-skill-dir>/scripts/check-version.mjs" \
  --project-root . \
  --apply
```

检查脚本默认最多每 24 小时访问一次远端清单。它只更新 `rankup` Skill，不修改业务代码、不部署网站，也不覆盖项目 `.rankup/`。

自动更新在两种情况下必须拒绝执行并报告原因：

- **源码检出**（`source-checkout`）：仓库根存在 `.skill-source` 标记，说明当前运行的就是 Skill 源码本身，通常还被全局技能目录符号链接过来。此时更新会覆盖未发布的改动，并把符号链接换回实体目录副本，重新变回双份维护。该标记只在仓库根，`skills add/update` 只复制单个 Skill 子目录，因此不会随安装副本分发，也不会误伤项目级安装。
- **工作区有未提交修改**（`dirty-skill-checkout`）。

若链接已被 `skills update` 换成实体目录，在仓库里运行 `node scripts/link-skills.mjs` 即可恢复；被替换掉的实体目录会先备份而不是删除。

`installedAt` 是当前项目第一次由 `rankup` 初始化或识别时记录的启用时间；Skills CLI 没有可靠的安装后钩子，不得把它描述成 CLI 精确复制文件的时间。

## 强制启动协议

每次使用必须按顺序执行：

1. 读取同目录 `skill.json`，运行上面的版本检查；网络失败时保留当前版本继续，不得伪称已经更新。
2. 读取项目 `.rankup/INDEX.md` 和 `.rankup/skill-state.json`；目录不存在时按 [`references/project-memory.md`](references/project-memory.md) 初始化。
3. 读取 `.rankup/PROJECT.md` 及当前任务相关文件，不要无差别加载整个日志目录。
4. **三方对账门禁**：在回答“接下来做什么”或宣称任何进度之前，必须交叉核对三个来源——`git log --oneline -25`、真实路由/页面清单、线上 `sitemap.xml` 的全量 `<loc>`。`.rankup/plan.md` 的勾选框、仓库根的 `progress.md`、autopilot 状态文件都是**滞后指标**，读到“未开始”要先去代码里验证。三方结果与记录不一致时，先回写 `.rankup/` 再继续，不能只在回复里口头更正。Cloudflare、GSC、Stripe、索引、外链等外部状态一律以当前查询结果为准，知识库只当线索不当证据。
5. 判断任务处于哪个生命周期阶段，只读取需要的参考文件和专项 Skill。若本轮需要某类可复用操作（导数据、查词、抓 SERP 等），先查跨项目资产登记表看别的项目有没有现成脚本，有就取用，不要重写。
6. 实施请求范围内的工作，执行与风险相称的测试，并验证真实目标环境。
7. 更新 `.rankup/` 中的事实、决策、计划、发布或日志；同步 `INDEX.md` 的更新时间和导航。

已有项目没有 `.rankup/` 时，只补建项目记忆，不得因此重新初始化技术栈。只有用户确实要求创建新站时才执行建站脚手架。

## 可复用操作必须落成脚本

**任何需要第二次执行的操作，第一次跑通时就必须固化成脚本，不允许下次重新摸索。** 浏览器操作是最主要的适用对象：切换 GSC property、导出效果报告、在关键词工具里查一批词、抓 SERP 前十结构——这些每次重新试探都在重复烧上下文，且每次的做法都不一样，结果不可比。

判定与动作：

1. **判定**：操作满足“会再做一次”或“换个站/换个词就要重跑”时，即为可复用操作。一次性排查不适用。
2. **固化**：跑通后立即写入 `<project>/.rankup/scripts/<动词-对象>.mjs`（如 `gsc-switch-property.mjs`、`gsc-export-queries.mjs`、`serp-top10.mjs`）。脚本必须参数化（property、日期范围、词、国家），不得把某一次的具体值写死。
3. **登记**：在 `.rankup/INDEX.md` 记一行——用途、参数、依赖的登录态、已验证日期。
4. **复用**：之后先执行脚本，不重新摸索 DOM。
5. **维护**：脚本失败时**修脚本**，不是绕过它手工再点一遍。页面改版属于正常损耗，修完更新已验证日期。失败原因写进脚本头部注释，下次少走一遍。

脚本与它依赖的登录态、property ID、账号配置都属于项目侧，只放 `<project>/.rankup/`，不进本 Skill。本 Skill 只描述方法，不携带任何具体站点的操作参数。

## 导出物落盘 SOP（强制）

**从浏览器、后台或第三方工具导出的任何数据文件，绝不允许留在浏览器默认下载目录。**

这不是整洁问题。默认下载目录是所有下载共用的垃圾场：文件会被随手清空、会被同名下载覆盖成
`xxx (1)`、跨轮次跨项目混在一起无法区分，而这些文件往往是**扣了额度或花了几十分钟才拿到、
且无法凭记忆重建**的一次性产物。丢了就得重抓。

### 首选：本地接收端，根本不走下载目录

页面 JS 没有文件系统，`<a download>` 只能落到浏览器默认目录 —— 这一步无法从页面内改道。
但可以**绕开整条下载链路**：在本机起一个只监听 `127.0.0.1` 的接收服务，
让页面把数据 `fetch(..., {method:'POST'})` 过去，服务端直接写进项目目录。

这是**首选方案**，因为它一次性消掉四个问题：不需要等文件落齐、不需要归并重名副本、
不受下载目录权限影响、也不占用对话上下文。实测被采集页面的 CSP 通常不拦截到
`127.0.0.1` 的请求（先用一个 `/ping` 端点验证连通再开跑）。

服务端要点：只绑 `127.0.0.1`；开 CORS（页面在 https 源上，属于跨源）；
对路径参数做白名单字符校验防目录穿越；落盘同时写 manifest 并回报行数。

**为什么这条要排在下载法前面**：浏览器默认下载目录在部分系统上受隐私保护，
终端与脚本可能**根本读不到**（实测 shell 与 Node 同时 `EPERM`），
而这种权限状态可能在任务中途才生效。届时所有已下载的数据都拿不回来。
接收端方案不依赖那个目录，因此不会中途失效。

### 退路：仍然走下载目录时

若无法起本地服务，则落盘必须由**项目侧的一个脚本**在抓取结束后立刻完成，
而不是靠事后想起来手工搬。

### 强制规则

1. **落到项目里**。每个项目在 `.rankup/` 之外维护自己的数据目录（例如
   `data/<主题>/raw/`、`data/<主题>/out/`），原始导出物与派生产物分开放。
2. **抓完立刻搬，不允许攒**。每一轮抓取结束就跑落盘脚本，中间不插入别的抓取。
   攒到最后搬的后果是无法分辨哪个文件属于哪一轮。
3. **搬走而非复制**。源文件必须从下载目录删除 —— 留一份在那里，问题就还在。
4. **规范文件名**，且必须自带足以区分轮次的信息：
   `<主题>__<类型>__<切片/参数>__<日期>.<扩展名>`。用参数拼名字，不要用「导出(3)」这种。
5. **等齐再搬**。Blob/异步下载的最后一个文件常晚几秒落盘，提前搬会**静默丢文件**
   而下游报告看起来完全正常。判据是「文件数达标 **且** 连续两次采样各文件大小不变」。
6. **归并重名副本**。浏览器对同名下载不覆盖，而是另存为 `xxx (1)`、`xxx (2)`，甚至丢掉扩展名，
   **且这些副本内容可能不同**（重试过的目标必然产生多份）。同一逻辑切片只保留数据行最多的那份，
   其余删除，不要让通配符把两份内容不同的文件都算进结果。
7. **落盘即校验并记 manifest**：每个文件的数据行数、字节数、落盘日期写进同目录的
   `manifest.json`。**行数为 0 的文件必须报错退出**，不能进入下一轮 —— 空文件是抓取失败的信号，
   静默通过会让最终报告缺一整块而无人察觉。
8. **脚本参数化**：主题、类型、期望文件数、超时都从命令行传，不写死。

落盘脚本本身属于可复用操作，按上一节固化进 `<project>/.rankup/scripts/` 并登记到 `INDEX.md`。
具体的表格采集技巧、反爬约束与踩坑清单见
[`references/integrations.md`](references/integrations.md) 的「登录态后台批量取数」一节。

## 跨项目资产登记表

各项目的 `.rankup/` 互不可见，默认是信息孤岛：A 项目已经写好的 GSC 导出脚本，在 B 项目里不会有人知道。登记表把这些资产索引到一处。

```bash
# 重建名单(扫描各项目 .rankup/,整表覆盖)
node "<rankup-skill-dir>/scripts/registry.mjs" scan --roots <存放项目的目录>

# 查看名单
node "<rankup-skill-dir>/scripts/registry.mjs" list
```

- **位置**：Skill 目录下的 `registry.md`，挨着 `SKILL.md`，用的时候一眼看得到（可用 `RANKUP_REGISTRY_PATH` 改道）。它必须写出项目名与绝对路径才有用，因此被 `rankup/.gitignore` 排除，并由 `scripts/validate-rankup.mjs` **断言绝不能被 git 追踪**——`.gitignore` 只是约定，一个 `git add -f` 就能绕过。名单也因此被豁免参与项目中立扫描，而这条豁免的唯一依据就是那条断言。
- **扫描根目录**：来自 `--roots`、环境变量 `RANKUP_PROJECT_ROOTS`，或 `~/.rankup/config.json` 的 `projectRoots`。绝不写死在脚本里。
- **生成而非手写**：每次 `scan` 整表重建，读到的永远是磁盘当前事实。手工维护的索引必然过期，这是已验证的反模式。
- **启动时读它**：本 Skill 激活后若发现当前任务需要某类可复用操作，先查名单看别的项目有没有现成的，有就去对应路径取，不要重写一遍。
- **只索引不复制**：名单不搬运内容。取用别的项目的脚本时连同参数约定一起看；登录态、property ID、账号配置不跨项目照抄。
- **回流信号**：某个脚本被第二个项目用上，说明它足够通用，考虑把**做法**提炼成规则回流本 Skill（仍然不带任何项目信息）。

## 命令

两个入口，覆盖「刚接手」和「回头看」，用户只说 `rankup init` / `rankup review` 即可，不必描述要做什么。

### `rankup init` — 把项目接入 rankup

适用于全新项目，也适用于**已经做了很久但还没有 `.rankup/`** 的项目。后者是常态，不得因为缺记忆就重建技术栈。

1. **摸清现状再写字**：读 `package.json`、路由/页面清单、部署配置、`git log`，确认框架、技术栈、部署目标与真实生产域名。已上线的再取 `sitemap.xml`、`robots.txt`、首页与关键页的线上响应。
2. **查外部系统**：域名是否解析、Cloudflare/托管方是否在跑、GSC 是否接入、是否有支付。**一律实时查询，不采信任何文档里的说法。**
3. **建目录**：按 [`references/project-memory.md`](references/project-memory.md) 创建 `.rankup/` 全套。已有事实直接填，取不到的写 `待确认`，**不要猜**。
4. **已运行项目补基线**：记一次当前流量、索引、性能与收入基线到 `baseline.md`，作为后续对比的起点；同时做一轮技术体检写入 `audit.md`。
5. **定方向**：`roadmap.md` 写阶段目标与放弃条件，`plan.md` 写 P0–P2 及完成判定。
6. **汇报**：填了什么、哪些是 `待确认`、哪些需要用户提供（账号授权、token、DNS 等）。凭据只登记名称与存放位置，真实值不入库。

已有 `.rankup/` 时 `init` 不覆盖，转为补齐缺失文件并提示用 `review`。

### `rankup review` — 回顾、筛选、补做

定期或阶段结束时执行。先跑体检脚本拿机械结论，再处理需要判断的部分。

```bash
node "<rankup-skill-dir>/scripts/review.mjs" --project-root . --days 30
```

脚本只读不改，给出：缺失文件、超期未更新的记录、脚本体检（有无已验证日期、是否参数化）、经验库信号（重复条目、候选回流 Skill 的条目）。

再挖会话记录——**最有价值的经验往往还留在对话里，从没进过 `.rankup/`**：

```bash
# 先看有哪些会话、各自还有多少没读
node "<rankup-skill-dir>/scripts/sessions.mjs" --project-root . --days 14 --new-only

# 输出浓缩对话（只留人说的话与结论，丢掉工具调用与系统注入）
node "<rankup-skill-dir>/scripts/sessions.mjs" --project-root . --days 14 --new-only --dump

# 全部消化完之后，才落水位线
node "<rankup-skill-dir>/scripts/sessions.mjs" --project-root . --days 14 --mark
```

**默认加 `--new-only`。** 水位线按字节偏移记在 `.rankup/review-state.json`：上次 review 读到哪，这次就从哪接着读；同一个会话后续续聊也只读新增那段。不加的话每次 review 都会把同样的对话重读一遍，纯属浪费。

`--mark` 是**独立一步，必须等信号真的提取完再执行**。中途失败或输出被预算截断时不落水位，下次仍会重读那一段——宁可重读，不可漏读。

覆盖当前项目的 Claude Code 与 Codex 会话，按记录里的 `cwd` 归属，worktree 与含空格的路径都能认。读浓缩稿时找四类东西：

- **用户的纠正**——「不对，应该是……」后面那句通常就是一条该沉淀的规则。
- **验证过的结论**——附了证据的判断；只有猜测没有验证的不要收。
- **踩过的坑与其根因**——尤其是排查花了很久的，写清判据让下次一眼认出。
- **已经推翻旧记录的事实**——`.rankup/` 里的对应条目要**修订**，不是并列再写一条。

在此之上完成：

1. **对账**：`plan.md` 的勾选是滞后指标，与 `git log`、路由清单、线上 `sitemap.xml` 三方交叉；不一致先回写再继续。
2. **筛信号**：`experience.md` 里合并重复、删除已过时、修订被证伪的条目——**修订原条目，不并列保留冲突结论**。未验证的猜测直接删。
3. **提炼回流**：剥离站点后仍成立的规则回流本 Skill，证据出处与数字留在项目侧。回流内容不得含站名、域名、流量数字、property ID。
4. **补脚本**：本轮有没有第二次重复的操作却没固化？脚本头部的已验证日期是否过期、还能不能跑？坏了就修，不绕过。
5. **补缺口**：`roadmap.md` 是否断更、`iterations.md` 是否漏记失败轮次（失败必须写清被证伪的假设）。
6. **刷新名单**：`node "<rankup-skill-dir>/scripts/registry.mjs" scan --roots <存放项目的目录>`。
7. **产出**：一页结论——修了什么、删了什么、回流了什么、下一轮唯一改进。能当场修的直接修，不要只列清单。

## 任务路由

| 请求 | 必读参考 | 专项能力 |
|---|---|---|
| 新站、SaaS、工具站、产品设计、架构 | [`lifecycle.md`](references/lifecycle.md)、[`cloudflare-stack.md`](references/cloudflare-stack.md)、[`project-memory.md`](references/project-memory.md) | 设计或开发相关 Skill |
| Cloudflare、Worker、数据库、存储、部署 | [`cloudflare-stack.md`](references/cloudflare-stack.md)、[`integrations.md`](references/integrations.md) | Wrangler、workers-best-practices |
| 支付、订阅、账单、Stripe | [`integrations.md`](references/integrations.md)、[`project-memory.md`](references/project-memory.md) | stripe-best-practices |
| SEO、GSC、排名、关键词、CTR、索引、内容 | [`seo-growth.md`](references/seo-growth.md)、[`trends.md`](references/trends.md)、[`project-memory.md`](references/project-memory.md) | SEO 或研究能力 |
| 关键词难度、SERP 盘面、页面体检、域名与外链估值 | [`seo-webcafe.md`](references/seo-webcafe.md) | `scripts/seo-webcafe.mjs`（一个脚本覆盖全部工具，零配置可跑） |
| 搜索热度对比、地区分布、相关飙升词、每日热搜、模糊方向扩词并收敛成可做站的词 | [`trends.md`](references/trends.md) | `scripts/gt.py`（首次运行自动建 venv 装 pytrends） |
| 从登录态后台批量取数（没有 API / API 收费 / 导出扣点数） | [`integrations.md`](references/integrations.md) | backlink（读 `references/harvest.md`） |
| 能力只有聊天网页形态（要登录、按条扣费、无 API），需反复提问并取回全文 | [`integrations.md`](references/integrations.md) 的「网页版 AI Chatbot 取答」 | `scripts/chatbot-drive.browser.js` |
| 外链、分发、竞品引用域 | [`integrations.md`](references/integrations.md)、[`seo-growth.md`](references/seo-growth.md) | backlink |
| 付费外链平台、「竞品在哪买的链接」、投放平台估价 | [`integrations.md`](references/integrations.md) 的「抓完竞品反链，必须回流到 `backlink` 的平台登记表」 | backlink（读 `references/paid-platforms.md`，喂 `data/paid-platforms.json`） |
| 复盘、经验沉淀、自我进化、规则升级 | [`evolution.md`](references/evolution.md)、[`project-memory.md`](references/project-memory.md) | 必要时使用独立 checker |
| 已有项目下一步、迭代、排障 | [`project-memory.md`](references/project-memory.md) 加任务相关参考 | 按缺口选择 |

找不到合适能力时，先按 [`integrations.md`](references/integrations.md) 使用 find-skills 搜索，不要先在 `rankup` 中复制一个新的专项 Skill。

## 网站生命周期

完整输入、动作、产出和完成门槛见 [`references/lifecycle.md`](references/lifecycle.md)。总流程为：

0. 恢复项目上下文并与真实状态对账。
1. 调研用户、需求、竞争、关键词和付费机会。
2. 定义产品、页面、数据模型、架构和实施计划。
3. 初始化或审计 Monorepo；新站使用批准的 TanStack Start 脚手架。
4. 建立 Cloudflare SSR、API、数据、存储、环境和 bindings。
5. 小步开发，完成类型、测试、构建和迁移验证。
6. 按需接入 Stripe、邮件、分析、搜索平台等专项能力。
7. 部署并验证真实域名、SSR、API、数据、上传、鉴权和回调。
8. 执行技术 SEO、内容、索引和转化优化。
9. 分析并执行合规的分发与外链工作。
10. 监控、实验、复盘、记录并进入下一轮。

已有网站从当前相关阶段进入，不要求从阶段 1 重走全部流程。

## 默认建站栈

新建项目默认使用：

```bash
pnpm dlx shadcn@latest init \
  --preset b1D0eCA4 \
  --template start \
  --monorepo \
  --rtl \
  --pointer
```

默认采用 Cloudflare-first：

- TanStack Start SSR、API 与服务端逻辑：Workers。
- 关系型和事务型数据：D1。
- 文件、图片、导出物和用户上传：R2。
- 缓存与读多写少配置：KV，不作为事务真源。
- 异步和多步骤任务：Queues / Workflows。
- 强一致协调与有状态实例：Durable Objects。
- 真实密钥：Worker Secrets、Cloudflare Secrets Store 或 CI Secrets。

资源必须按实际需求启用，不因“以后可能需要”提前创建。具体配置、环境隔离、迁移和线上验证见 [`references/cloudflare-stack.md`](references/cloudflare-stack.md)。

## `.rankup/` 项目记忆

`.rankup/` 是当前网站的长期项目日志和事实库，不是 Skill 发布目录。完整结构和模板见 [`references/project-memory.md`](references/project-memory.md)。

最低要求：

- `INDEX.md`：导航、推荐阅读顺序、最近更新时间。
- `PROJECT.md`：用户、定位、商业模式、目标和非目标。
- `architecture.md`：应用、数据、服务边界。
- `infrastructure.md`：环境、域名、Cloudflare 资源和非敏感 bindings。
- `integrations.md`：Stripe、邮件、分析和搜索平台状态。
- `secrets.md`：只记录名称、用途、环境、保管位置、负责人、访问与轮换状态。
- `skill-state.json`：本地版本、启用时间、检查与更新时间。
- `roadmap.md`：长期方向、阶段目标、各阶段的判定条件与放弃条件。跨会话可续，不随单轮任务改写。
- `iterations.md`：每轮迭代一段——做了什么、判据是什么、结果、下一轮唯一改进。失败轮次同样要记，且必须写清被证伪的假设。
- `scripts/`：可复用操作脚本（见「可复用操作必须落成脚本」）。
- `experience.md`：本站可复用结论的完整原文，含证据出处与数字。
- `baseline.md`、`keywords.md`、`decisions.md`、`audit.md`、`plan.md`、`experiments.md`、`releases.md`。
- `journal/`：按日期记录有复用价值的实施、运营、排障和增长过程。

**沉淀义务与是否调用本 Skill 无关。** 只要项目里存在 `.rankup/`，该项目中任何任务——不限于 SEO，包括功能开发、重构、排障、发版——完成后都必须回写可复用结论、裁决与长期规划。判据是“下次遇到同类问题能否少走一遍”，不是“这轮有没有走 rankup 流程”。用户没有显式要求也要写，写完在回复里提一句即可，不必请示。

严禁在 Skill、`.rankup/`、Git、测试或回复中保存真实密钥、token、密码、私钥、webhook secret、支付敏感数据或个人敏感信息。

## 令牌统一放 Skill 根目录的 `.env`

**本 Skill 依赖的第三方令牌，只有一份，放在 Skill 根目录的 `.env`，所有项目共用。**

```
<rankup-skill-dir>/.env      # KEY=value，每行一个；已被本仓库 .gitignore 排除
```

为什么是这里而不是各项目自己存：这些令牌属于**工具账号**（关键词难度、SERP、体检这类第三方服务），不属于任何一个站点。放进项目就会出现同一个令牌在 N 个项目里各存一份，过期时要改 N 处，而漏掉的那几处会以“配额用尽”“未授权”的面貌出现，排查方向完全错。放在 Skill 这一层，一处更新，全部项目立刻生效。

与项目侧 `secrets.md` 的分工不变，且不冲突：

| | 放什么 | 例子 |
|---|---|---|
| Skill 的 `.env` | **跨项目的工具账号令牌真实值** | 关键词/SERP 服务的 API 令牌 |
| 项目的 `secrets.md` | **本项目专属凭据的名称、用途、保管位置**，绝不写真实值 | 站点的部署密钥、支付密钥 |

规则：

1. **必须被 `.gitignore` 排除，且要断言。** 只写进 `.gitignore` 不够——一个 `git add -f` 就能绕过，所以由 `scripts/validate-rankup.mjs` 断言它不被 git 追踪，违反即构建失败。这与登记表 `registry.md` 用的是同一条防线。
2. **脚本读取顺序统一为：环境变量优先，再退到 Skill 的 `.env`。** 两处都读得到时以环境变量为准，便于临时覆盖。
3. **调用方脚本必须和驱动脚本用同一套解析。** 只看环境变量的调用方会在令牌明明配好的情况下判定“没有令牌”，退回匿名档并撞上配额，而报错却在教人去设一个已经设好的变量——这类误诊极难排查，属于必须避免的失败形态。
4. **令牌失效时更新这一个文件，不要在项目里另建副本。** 发现某处读不到，正确动作是修读取逻辑，不是再抄一份。
5. **真实值不出现在任何回复、日志、提交或落盘数据里。** 需要说明时只说键名与所在文件。

安装本 Skill 后 `.env` 不存在是正常状态：首次需要令牌时创建它，写入键值即可，无需其他配置。

## 完成标准

一次 `rankup` 工作只有同时满足以下条件才算完成：

1. 用户要求的产出已经存在。
2. 相关类型检查、测试、构建或迁移验证通过。
3. 若涉及发布，真实线上目标和关键路径已验证；上传成功或 Worker Ready 不能单独证明完成。
4. 相关 `.rankup/` 文件已更新，过时的交叉引用已一并修正。
5. 说明完成内容、验证证据、仍存在的风险和需要用户处理的外部事项。

## 经验回流与版本升级

详细的失败分类、证据阶梯、适应性重试、规则晋升和淘汰流程见 [`references/evolution.md`](references/evolution.md)。

- 只对当前项目成立的事实、数字和排障过程写入项目 `.rankup/`。
- 换一个项目仍成立且经过验证的规则，才可回流本 Skill 的相关参考文件。
- **本 Skill 必须保持项目中立与机器中立**：站点名、域名、流量数字、证据出处、account/property ID、本机路径与代理、凭据位置一律不进 Skill。回流一条经验时只带走剥离站点后仍成立的规则，证据留在项目侧的 `experience.md`。此约束由 `scripts/validate-rankup.mjs` 断言，违反即构建失败。
- 不记录未验证猜测；若旧经验被证伪，应修订原条目而不是并列保留冲突结论。
- patch：文字、兼容性修复和小经验补充。
- minor：向后兼容的新工作流、集成或模板。
- major：目录协议、核心行为或兼容性发生破坏性变化。
- 发布新版本时，同时更新 `SKILL.md` 的 `metadata.version`、`skill.json`、验证脚本预期和 README。
