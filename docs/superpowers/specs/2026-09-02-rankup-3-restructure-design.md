# Rankup 3.0 重构方案（2026-09-02）

## 0. 为什么重构

- `SKILL.md` 979 行 / 116KB，每次 `/rankup` 全量进上下文，已有会话记录到被压缩截断。
- 纪律与红线占 44%，路由入口只占 19%；四张路由表互相重叠；五处自相矛盾；五段与 references 逐字重复。
- 用户的真实用法（会话记录统计）只有五类：A 调研（给词根/帖子/域名问能不能做）、B 站的进度与体检、C 开发时挂着当建站规范、D 维护 Skill、E 问功能。现有结构对 C 类没有入口。
- 用户口述的七段生命周期与现有 lifecycle 有多处直接冲突（域名顺序、多语言默认、词根扩树、社区验证必做、GitHub 缺失等）。

## 1. 用户画像与七段生命周期（本次的真相源）

用户是独立开发者：做产品，也做关键词流量站、AI 工具、桌面客户端上架商店、付费订阅。
共同点：靠 SEO + GEO 拿免费曝光导到自己平台。市场是全球，任何语种任何国家，有流量就做。

| 段 | 名称 | 用户硬规则 |
|---|---|---|
| 1 | 调研 | 用户给的任何词都是**词根**；先直接搜，再扩成树（面板相关词 + Google/Bing/DDG 下拉联想，叶子再扩，最多两层，有停止条件）；筛子：月量太低且 CPC 低 = 否，KD 低好上手；数据平台只有 28 天窗口，昨天火的看不到，所以**社区验证是必走的一条腿**（Reddit / X / YouTube / B 站，近 14 天讨论量）；最后用 SERP 页面类型核实**真实意图**（宠物诊断误判案例） |
| 2 | 立项与定位 | 第一目标是拿到流量并选定语种；某语种流量大竞争小就**只做单语站**，不做多语言；意图类型决定产品形态与变现方式 |
| 3 | 建站与开发 | **一律** shadcn monorepo 初始化命令，禁止其他脚手架；**GitHub 私有仓** + Cloudflare；不重复造轮子，优先接三方库/服务；域名做成**一处配置留位**，开发期不接正式域名；**任何页面不得出现占位链接/占位文案/占位图片**（Google 判垃圾站，红线）；邮箱一律 Cloudflare Email Routing 的 `hello@` |
| 4 | 上线前 SEO/GEO | 在预览域（noindex）上做完：每页目标词 + 密度（价格表等无关区块改客户端加载，让 SSR 只输出目标文案，并合并 Skill 已有的"首次交互后注入"更严做法）；每页独立 meta/OG 且必须有图；llms.txt / GEO；**每次页面改动全套检测重跑**（TDK、密度、seo.web.cafe audit、哥飞 AI） |
| 5 | 上线与接入 | 分两批：批 A 域名无关（GA4、Clarity、CF Web Analytics）在预览域接好并验证 → **域名定稿**（先过黑历史裁决闸门：seo.web.cafe `history`、Wayback、外链画像、`site:` 搜索；成人/赌博/被惩罚一律否）→ 绑域名 → 批 B 域名相关（GSC、Bing、Yandex、Naver、IndexNow、Ahrefs WA + Site Audit、Email Routing）→ 放开索引 → 首页请求编入索引。**一个不漏**（有站 80% 流量来自 Bing、有站几乎全部来自韩国），清单要有"其他能带流量的平台"兜底行 |
| 6 | 外链 | 路由到 `backlink` Skill，rankup 只判什么时候发、发多少 |
| 7 | 变现与监控 | Stripe + PayPal 先有；广告（AdSense/Adsterra）、订阅、商店上架后续沉淀；监控读数触发**回到段 1 开下一棵树** |

## 2. 目标结构

```
rankup/
  SKILL.md                         ≤ 300 行。身份 + 总路由表 + 七段各一节 + 红线速查 + 三命令 + 启动协议 + 安装
  references/
    discipline.md                  新。纪律/红线/事故复盘全部从 SKILL.md 搬来，修掉 5 处矛盾
    lifecycle.md                   按七段重排；域名移到段 5；接入拆两批；新增用户硬规则
    checklists.md                  与 lifecycle 同步；新增闸门（占位红线、每页独立 OG、域名黑历史、单语种决策、扩树停止、社区验证、意图核验、改动全套体检）
    monetization.md                新。Stripe / PayPal / 广告 / 订阅 / 商店，只写路由与判据
    playbooks/
      INDEX.md                     七段各指一条
      research.md                  重写为词根扩树模型；P2 与 P3 合并
      site-review.md               保留
    capability-map.md              降级为纯底账；删掉与 SKILL.md 重复的 backlink 表，改为一行指回
    其余 references                 只做与上表冲突处的最小修订
  scripts/demand/suggest.mjs       新。Google / Bing / DuckDuckGo 下拉联想，纯 HTTP，按语种带 hl / oe=utf-8
  scripts/validate-rankup.mjs      requiredReferences 加 discipline.md / monetization.md / playbooks/research.md
```

## 3. SKILL.md 的骨架（写作规范）

1. frontmatter：`name`、`description`（保留现有全部触发词，新增：词根、扩词树、占位、变现、PayPal、域名黑历史、单语种、hello@）、`metadata.version: "3.0.0"`。
2. `# Rankup 3.0`：三行身份（谁在用、干什么、市场是全球）。
3. `## 一句话落到哪一段`：一张总表，列 = 用户会说的话 / 段 / 入口文件。合并现有四张路由表，只保留最高频的 25 行以内。`rankup check` / `init` / `review` 三命令也在表里。
4. `## 七段生命周期`：`### 1 调研` … `### 7 变现与监控`。每节固定四块：**触发说法**（一行）/ **入口**（playbook 或 reference，一行）/ **硬规则**（3–6 条，每条带一句为什么）/ **闸门**（指向 checklists.md 的哪个阶段）。不写操作步骤。
5. `## 红线速查`：10 行以内的表，每行一句 + 指向 `discipline.md` 的节名。
6. `## 主线：维护 checklist，使用 checklist`（≤ 12 行）。
7. `## 命令`：`### rankup check` / `### rankup init` / `### rankup review`，各 ≤ 10 行，细节指向 `playbooks/site-review.md` 与 `project-memory.md`。
8. `## 启动协议`（≤ 8 行，含"三方对账门禁"四字）。
9. `## 经验库：规划与迭代之前先翻一遍`（≤ 5 行）。
10. `## 可复用操作必须落成脚本`、`## 跨项目资产登记表`（各 ≤ 6 行）。
11. `## 安装与版本`（保留验证器要求的命令原文）。
12. `## 令牌与项目中立`（保留验证器要求的四句原文）。

**必须原样保留的字符串**（`validate-rankup.mjs` requiredContent）：见该文件 32–56 行，共 23 条，一条不能少。
**必须链接的 references**：requiredReferences 的 15 个文件，加新增的三个。

写作风格：命令式、每条规则带"为什么"、少用全大写 MUST；表格优先；反面例子一句话。用户的会话里出现过的原话优先作为触发说法。

## 4. 各文件的具体改动

### 4.1 discipline.md（新，从 SKILL.md 搬）
搬入并去重：执行纪律（主线只调度 / 全量执行 / 人机验证 / 收尾不留尾巴）、红线判定顺序与取数优先级、配额前置检查、把请求发进浏览器、兄弟 Skill 可用清单、已证实高频错误、静默收尾动作、浏览器与取数四条、落盘规则、令牌 `.env`、完成标准。
修掉 5 处矛盾：
1. `research-checklist.md` 是验收单，不是入口；
2. Semrush / Similarweb 不传 `--session`（示例命令一并改正）；
3. 抓后台数据：有现成脚本先跑，没有才加载 backlink；
4. seo.web.cafe 档位以脚本打印为准，不写死"匿名 10 次/日"；
5. `rankup check` 轻量，命中升级条件时明确说"这已经不是 check，是 review"。
新增红线：占位链接/文案/图片（段 3）。

### 4.2 lifecycle.md + checklists.md（同一个人改）
- 顶部加一张"旧阶段号 → 新七段"映射表，让项目里旧 `checks.md` 对得上。
- 域名接入从阶段 4 移到段 5，并加"黑历史裁决"闸门与"域名做成一处配置留位"步骤。
- 阶段 7.5 拆成段 4（上线前，预览域 noindex）与段 5（两批接入）。
- 段 2 新增：流量第一、语种决策方法（引 trends.md W1）、单语种裁定、意图类型 → 产品形态 → 变现方式。
- 段 3 新增：shadcn 命令改为强制措辞、GitHub 私有仓（`gh repo create --private`）、三方库/服务优先、无占位红线、`hello@` 唯一约定。
- 段 4 新增：每页独立 OG 含图、无关区块客户端加载并合并 seo-growth 已有的更严做法、改动即全套体检（含 seo.web.cafe audit 与哥飞 AI）。
- 段 5 接入清单：加 Ahrefs Site Audit 行、兜底行、两条理由；GA4 加接入步骤指向 analytics-platforms.md。
- 段 7：监控读数触发回段 1。
- `checklists.md` 里那条项目专属的"真实链接回归集"（含 `pnpm --filter web test:live`、"有视频/无视频"）改写成项目中立的"真实输入回归集"。
- 修掉 `lifecycle.md:763`"每轮只重跑第 4、6 行"，与"全套重跑"对齐。

### 4.3 playbooks/research.md（重写）
分流只按输入：词根（默认，含用户说"关键词"的情况）/ 别人的域名（P4）/ 什么都没有（P1）。P2 与 P3 合并成"P2 词根调研"：
0 定国家与语种 → 1 亲眼看 SERP（Google / Bing / 本地引擎，记页面类型 = 意图核验第一遍）→ 2 扩树（本地词根库 + `suggest.mjs` 三引擎 + 面板相关词；最多两层；叶子月量 < 阈值或 KD > 阈值不再扩）→ 3 取量 / KD / CPC（面板串行）→ 4 筛子 → 5 社区验证（必做；Reddit / X / YouTube / B 站；近 14 天；走 `reddit-wishes` 与 `/agent-reach`）→ 6 意图核验（与 lifecycle 6.2 同名）→ 7 折成钱 → 收尾写 `.rankup/research/`。
明写 28 天窗口盲区。`research-checklist.md` 顶部与正文对齐为验收单；`trends.md` 补上被引用却不存在的"月搜 < 500 直接否"或删掉引用。

### 4.4 monetization.md（新）+ integrations.md + capability-map.md
- monetization.md：Stripe（指 integrations.md）、PayPal（接入路径、与 Stripe 的备份关系）、广告（指 webcafe-experiences 二十二）、订阅（宽限期事故）、商店上架（App Store / Mac App Store / Chrome Web Store 的最小清单）。只写路由与判据。
- integrations.md：加 PayPal 一节；加"三方库/服务优先"一节。
- capability-map.md：删掉与 SKILL.md 重复的两张 backlink 表，改为一行指回；加 `suggest.mjs` 一行。
- analytics-platforms.md：补 GA4 接入步骤。
- seo-growth.md：把"无关区块（价格表）客户端加载"与已有"首次交互后注入"合并成一节。

### 4.5 suggest.mjs（新脚本）
`node scripts/demand/suggest.mjs <词根> --engine google,bing,ddg --hl ja --gl jp --json --out`。纯 HTTP，零依赖，Node 20+。每引擎独立请求，失败把 `{engine,url,status,body}` 落 manifest，0 条不等于没词。只采集不判读。配一个离线测试（解析函数）。

## 5. 验收

1. `node scripts/validate-rankup.mjs` 通过；`node --test tests/*.test.mjs` 全绿。
2. `wc -l SKILL.md` ≤ 300。
3. 路由抽检：让一个不带上下文的 agent 只读新 SKILL.md，对 8 句用户原话说出落哪一段、读哪个文件；8 句全部命中。
4. `skill.json`、`SKILL.md` frontmatter、仓库 `README.md` 版本同步为 3.0.0。
5. 直接提交 main。
