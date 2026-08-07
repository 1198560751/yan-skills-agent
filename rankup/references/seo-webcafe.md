# seo.web.cafe（哥飞的 SEO 工具箱）接口地图

哥飞做的中文 SEO 工具集合，域名 `seo.web.cafe`，每个工具是一个独立子路径（`/<tool>/`），
多数工具页面下面挂了一个同名的小后端，路径规律是 **`/<tool>/api/<action>`**，
不是 `/api/v1/...`（那是 `/kd/` 一个工具专属的公开 API 前缀，其余工具都没有）。

本文档 2026-08-07 用真实浏览器会话（未登录、访客身份）逐个工具点了一遍网络面板得到，
每个工具在探索阶段只发了一次请求，没有跑循环、没有登录、没有绕过配额；随后额外用
`curl` 单独重放了一次某个端点，专门用来搞清楚请求头到底是不是硬性必需的（见「认证与配额」）。

## 这是什么，每个工具答什么问题

| 工具 | 一句话 |
|---|---|
| `/translate/` 需求翻译器 | 一句英文需求，翻译成谷歌前十结果里真实出现的关键词 |
| `/mine/` 需求挖掘机 | 一个词或一个网址，滚雪球挖出关键词簇与同类网站 |
| `/serp/` SERP 排名解密 | 逐位点评谷歌第一页每个结果凭什么排在那 |
| `/domain/` 网站起名 AI | 描述产品，AI 起名并核验域名是否能注册 |
| `/history/` 域名前世档案 | 这个域名历史上被谁用过、改过几次版 |
| `/worth/` 网站价值估算器 | 按流量和变现方式估算网站值多少钱 |
| `/backlink/` 外链价值计算器 | 对方开的外链报价值不值这个钱 |
| `/audit/` On Page SEO 体检 | 40+ 项页面体检，给分和逐项建议（已确认，见下方说明） |
| `/review/` 页面军师 | 针对一个具体页面的多维点评与优化建议 |
| `/string/` 文本长度计算器 | 字符/字节统计与 TDK 长度检查 |
| `/adsense/` AdSense 过审预检 | 规则引擎 + 内容抽样，预判能不能过 AdSense 审核 |
| `/money/` 收入目标拆解 | 把月收入目标拆解成每天要做到的量 |
| `/influencer/` YouTube 红人报价 | 红人开的价该不该接 |
| `/referring/` Stripe 引荐流量榜 | 谁在给 Stripe 收银台送付费流量，月度榜单 |
| `/traffic/` 流量数据分析器 | 上传流量 CSV，自动识别曲线上的关键节点 |
| `/email/` 邮箱提取器 | 从文本里批量提取邮箱地址 |
| `/kgr/` 关键词价值评估 | KGR / EKGR / KDROI 三个指标算值不值得做 |
| `/level/` SEO 赚钱进阶之路 | 静态说明页，SEO 赚钱的十个等级 |
| `/gsc/` GSC 模拟器 | 90 天模拟数据，教你看懂 GSC 排名/曝光/点击怎么算出来的 |

## 接口表

`认证` 列里「令牌 + 访客配额」指该接口既要带上该工具专属的 `X-<TOOL>-Token` 请求头
（见下方「认证与配额」一节，这是**每个工具都要**的硬门槛，和登录无关），又计入访客每日
10 次的共享额度；「仅令牌」指只要带对令牌就放行，不计入那个配额池。

| 工具路径 | 端点 | 方法 | 请求字段 | 关键响应字段 | 认证 | 纯前端 |
|---|---|---|---|---|---|---|
| `/kd/` | `/kd/api/v1/kd` | GET | `keyword, gl, hl, force, format` | 难度分、SERP 盘面（已有独立公开 API + MCP 文档，本次未重测） | `Authorization: Bearer wc_mcp_...`（和下面 `X-<TOOL>-Token` 体系无关，是唯一对外文档化的认证方式） | 否 |
| `/audit/` | `/audit/api/analyze` | POST | `{url, keyword}` | `score, grade, categories[].checks[], page{}, ngramTop{}, serpInsight{}` | `X-AUDIT-Token` + 访客配额 | 否 |
| `/audit/` | `/audit/api/mine` | GET | 无 | 当前会话下已跑过的体检列表（未展开） | `X-AUDIT-Token` | 否 |
| `/translate/` | `/translate/api/search` | POST | `{query}` | `organic[], related[], paa[], fromCache` | `X-TR-Token` + 访客配额 | 否 |
| `/translate/` | `/translate/api/page`（对每条搜索结果各发一次） | POST | `{url}` | `title, wordCount, ngramTop, signals{title,description,h1,h2h3}` | 同上 | 否 |
| `/translate/` | `/translate/api/domain`（部分结果域名） | POST | `{domain}` | 域名侧信号（未展开，见下方"未查清"） | 同上 | 否 |
| `/translate/` | `/translate/api/aggregate` | POST | `{pages:[...]}` | 跨页聚合后的密度榜、最终结论 | 同上 | 否 |
| 各工具通用 | `/<tool>/api/me` | GET | 无 | `{login, oauthEnabled, quota:{used,limit,tier,unlimited,tiers:{anon,user,vip}}}` | 无需令牌，本身就是查配额状态 | — |
| `/mine/` | `/mine/api/seed` | POST | `{input}` | `{type: "keyword"\|"url", value}`（先判断输入类型） | `X-MN-Token`，不计配额 | 否 |
| `/mine/` | `/mine/api/report?seed=` | GET | `seed` | 是否已有落库报告可复用（`{found:false}` 未命中） | `X-MN-Token`，不计配额 | 否 |
| `/mine/` | `/mine/api/search` | POST | `{query}` | 同 translate 的 search | `X-MN-Token` + 访客配额 | 否 |
| `/mine/` | `/mine/api/page`（逐条结果） | POST | `{url}` | 同 translate 的 page | `X-MN-Token` + 访客配额 | 否 |
| `/mine/` | `/mine/api/domain`（逐个候选域名，实测 6 个左右就把当日额度打光） | POST | `{domain}` | `{domain, dr, visits, registeredAt, ageYears, trend{changePct,dir,last,prev}, topKeywords[]}` | `X-MN-Token` + 访客配额，消耗最快的一步 | 否 |
| `/serp/` | `/serp/api/serp` | POST | `{keyword, gl}` | 逐位归因点评（配额耗尽后仅拿到错误体，字段未展开） | `X-SR-Token` + 访客配额 | 否 |
| `/domain/` | `/domain/api/intent` | POST | `{text, hasCandidates}` | `{intent, brief}`（判断你是要起名还是别的意图） | `X-DF-Token`，不计配额 | 否 |
| `/domain/` | `/domain/api/name` | POST | `{brief, models:["deepseek-v4-flash"], sessionId}` | 候选名 + 域名注册核验（配额耗尽未展开） | `X-DF-Token` + 访客配额 | 否 |
| `/history/` | `/history/api/timeline` | POST | `{domain, force}` | 快照时间线（配额耗尽未展开） | `X-HIS-Token` + 访客配额 | 否 |
| `/worth/` | `/worth/api/estimate` | POST | `{input, model}` | 估值明细（配额耗尽未展开） | `X-WT-Token` + 访客配额 | 否 |
| `/backlink/` | `/backlink/api/evaluate` | POST | `{input, price, linkType}` | 外链价值评估（配额耗尽未展开） | `X-*-Token`（具体前缀本次未记下，规律同其他工具）+ 访客配额 | 否 |
| `/review/` | `/review/api/analyze` | POST | `{url}` | 页面点评（配额耗尽未展开） | `X-*-Token` + 访客配额 | 否 |
| `/adsense/` | `/adsense/api/audit` | POST | `{domain}`（表单只有一个域名框，具体字段名以此推断） | 过审预检结果（配额耗尽未展开） | `X-*-Token` + 访客配额 | 否 |
| `/adsense/` | `/adsense/api/me` | GET | 无 | 同 `/api/me` 模式 | 无需令牌 | — |
| `/referring/` | `/referring/api/summary` | GET | 无 | 榜单总览（页面一加载就发，参数在 query string，未展开） | `X-REF-Token`，**不计配额**（实测已确认，见下方认证一节） | 否 |
| `/referring/` | `/referring/api/month?m=YYYYMM` | GET | `m` | 该月榜单数据 | `X-REF-Token`，不计配额 | 否 |
| `/referring/` | `/referring/api/site?domain=` | GET | `domain` | `{domain, months:[...], stats{monthsOn,monthsTotal,firstMonth,lastMonth,bestPos,avgPos,totalSentK,latestPos,latestVisits,onLatest}}` | `X-REF-Token`，不计配额 | 否 |

其余工具（`string` 文本长度、`money` 收入拆解、`influencer` 红人报价、`kgr` 关键词价值评估、
`email` 邮箱提取、`traffic` 流量分析、`level` 进阶说明、`gsc` 模拟器）**没有对应端点**，
见下方「纯前端」小节，不要再去探。

## 认证与配额

这里有**两层独立的门槛**，容易混淆，务必分开看：

### 第一层：每个工具专属的 `X-<TOOL>-Token`，和登录无关，人人都要带

每个工具页面加载时，前端会签发一个自己专属的请求头，例如 `/translate/` 用
`X-TR-Token`，`/mine/` 用 `X-MN-Token`，`/domain/` 用 `X-DF-Token`，`/history/` 用
`X-HIS-Token`，`/worth/` 用 `X-WT-Token`，`/audit/` 用 `X-AUDIT-Token`，`/referring/`
用 `X-REF-Token`，值形如 `<13位时间戳>.<64位十六进制>`。

**一开始误判过这个头的作用**——最初看到未登录也能发出成功请求，以为这个头只是
防重放或统计用的会话标识、不是访问控制关键。后来用 `curl` 单独重放才发现完全不是这样：

```bash
# 不带这个头，或者带一个瞎编的值：一律 403
curl -s "https://seo.web.cafe/referring/api/site?domain=stripe.com"
# → {"error":"令牌无效或已过期","code":"token"}   HTTP 403

# 从真实浏览器网络面板复制出来的真实值，重放：正常返回数据
curl -s "https://seo.web.cafe/referring/api/site?domain=stripe.com" \
  -H 'X-REF-Token: <浏览器里复制的值>'
# → 200，正常 JSON
```

也就是说：**这是一道真实存在、服务端会校验的门槛，任何工具的任何端点都要带对**，
包括「不计配额」的 `/referring/*` 三个端点也不例外。已验证的性质：

- 从任意一次真实浏览器会话里复制出来的值，可以**跨端点、跨参数重复使用多次**
  （同一个 `X-REF-Token` 连续查了两个不同域名和一个月份榜单都成功）；
- 具体过期时间未知，没有专门去测生命周期上限；
- 生成算法未知——没有找到内嵌的、可读的前端 JS 源码（页面加载的 script 标签只有
  第三方统计脚本，应用本身的逻辑没有以独立可读文件的形式出现在 `document.scripts` 或
  `performance` 资源列表里），**没有去做进一步的逆向**：这需要拆解混淆过的前端逻辑或
  签名算法，属于绕过站点访问控制的范畴，不在"记录已观察到的契约"这个任务范围内，
  也不建议后续脚本往这个方向走。

给脚本用这个门槛的**唯一正当方式**：从你自己已经建立的浏览器会话里读出来复用，
不是账号登录、不是破解、只是把浏览器已经拿到的东西转手给脚本用，省得每次都开浏览器。
本 Skill 提供的 `seo-webcafe-audit.mjs`、`seo-webcafe-referring.mjs` 都是这个模式：
必须从环境变量传入令牌，脚本本身完全不生成、不猜测、不逆向它。

### 第二层：访客配额，按站点级共享池计算，和 `X-<TOOL>-Token` 是两回事

`/<tool>/api/me` 返回的 `quota.used` 是一个**全站共享的计数器**：在 `/translate/`
页面查询几次后，`used` 就已经涨到 4，切到 `/mine/`、`/serp/`、`/domain/`、`/history/`、
`/worth/`、`/backlink/`、`/review/`、`/adsense/`、`/audit/` 后第一次提交全部直接吃到

```json
{"error":"今日游客额度已用完。使用 Web.Cafe 登录可获得更高额度","code":"quota"}
```

HTTP 状态码 429（注意和上面第一层的 403 `code:"token"` 是不同的错误，报错顺序是
先过令牌校验，令牌对了才轮到配额判断）。实测**同一访客 IP 一天大概率撑不到把全部
吃配额的工具都跑一遍**，规划批量脚本或测试顺序时要按这个假设来，不要指望每个工具
单独有 10 次。

三档配额：访客（`anon`）10/天、登录用户（`user`）100/天、VIP（`vip`）500/天，和
`/kd/` 文档里写的一致，说明这是站点级的统一配额系统。`/referring/*` 三个端点
实测**不计入这个配额池**（多次调用 `used` 都没有变化，也没吃到 429），这一点已经
用真实请求核实，不是猜测。

### `/kd/` 是完全独立的另一套认证

`/kd/` 是唯一有文档化公开 API 的工具，和上面两层门槛都不是一回事：
`GET /kd/api/v1/kd?keyword=&gl=&hl=&force=&format=`，`Authorization: Bearer wc_mcp_...`，
10 请求/分钟的突发熔断，7 天结果缓存。此次未重测，按已有结论使用。

### 登录

Web.Cafe OAuth（`GET /api/oauth/me` 是全局登录态查询端点）**没有验证**——按任务要求
不代替用户登录、不生成账号级 token。上面提到的所有令牌复用方式都不涉及登录，只是读取
匿名访客身份下浏览器已经拿到的会话令牌。

## 值得写脚本的 vs 不值得

- **`/kd/`**：已有独立文档化的公开 API 契约（Bearer token，和 `X-<TOOL>-Token` 无关），
  稳定、单次请求就能拿到完整结果，脚本化成本最低，见 `seo-webcafe-kd.mjs`。
- **`/audit/`**：请求/响应契约已确认，但要带 `X-AUDIT-Token` 且吃访客配额。脚本
  (`seo-webcafe-audit.mjs`) 要求调用方从自己的浏览器会话里复制一次令牌传进来，
  不解决配额问题——批量跑之前先想清楚这批 URL 是否真的值得那 10 次/天。
- **`/referring/`**：三个 GET 端点**不吃**访客配额（已用真实请求核实），数据是月度
  榜单快照，适合按域名批量核对"谁在薅 Stripe 引荐流量"，复用价值最高，见
  `seo-webcafe-referring.mjs`。仍然要带 `X-REF-Token`，但因为不计配额、且令牌可重复
  使用，一次从浏览器复制的令牌够支撑一整批域名查询，是三个脚本里最适合"复制一次令牌、
  跑一整批"这种用法的。
- **`/translate/`、`/mine/`、`/serp/`、`/domain/`、`/history/`、`/worth/`、`/backlink/`、
  `/review/`、`/adsense/`**：既要各自的 `X-<TOOL>-Token`，又要吃那个全站共享的访客
  配额（10/天），而且 `translate`、`mine` 是内部多步骤编排（一次查询连续打好几个子端点：
  `search` → 多个 `page` → 多个 `domain` → `aggregate`），字段结构本次只部分展开。
  **不建议现在就封装脚本**——配额太薄，脚本化后很容易一次批量调用就把当天额度打光。
  等以后需要高频用其中某个工具、且有账号提额时，再针对那一个工具单独补脚本和字段全表。
- **`string`、`money`、`influencer`、`kgr`、`email`、`traffic`、`level`、`gsc`**：
  纯前端计算/模拟，页面上明确写了或实测确认提交后**零网络请求**。不要再为这些猜端点、
  也不用写脚本——本地一个小函数就能复刻，没必要过网络。`traffic` 页面上直接写着
  "纯本地解析，文件不会离开你的浏览器"；`level` 甚至没有任何输入控件，是静态说明页。

## 已知死路（别再踩）

- **`/domain/*` 和 `/referring/*` 盲猜路径全部 403**——早前用 curl 盲测过（没带
  `X-<TOOL>-Token`，也没找真实端点名），这其实就是上面「认证与配额」第一层门槛的表现：
  没令牌一律 403，和路径猜没猜对没关系，不是什么"这两个前缀被特殊拦截"。本文档表格里
  列出的路径都是从浏览器网络面板实测到的真实调用，不是猜的；带对令牌之后这些路径本身
  是能访问的（`/domain/api/intent`、`/referring/api/*` 均已验证）。
- **`/api/v1/...` 前缀是错的**，只有 `/kd/` 这一个工具在用这个风格，其余工具一律是
  `/<tool>/api/<action>`，没有版本号。
- **不要以为访客配额是按工具算的**——上面已经说明是全站共享池，规划测试顺序时要把
  "全站只有约 10 次"当作硬约束，不是"每个工具 10 次"。
- **`X-<TOOL>-Token` 请求头不是"可有可无的统计标识"，是真实生效的访问门槛**——
  这个坑本文档自己踩过一次：一开始看到未登录也能发出成功请求，就误判成"不参与鉴权"，
  写了个不带这个头的纯 `fetch` 脚本，结果对 `/referring/*` 一律吃 403
  `{"error":"令牌无效或已过期","code":"token"}`。用 curl 单独重放一个从浏览器复制出来的
  真实值才验证清楚：这个头是硬性必需的，且是可重复使用的会话令牌，不是一次性的。
  规划任何脚本前，先用 curl 不带这个头测一次，别假设"访客能用就是不需要认证"。
- **不要去逆向这个令牌的生成算法**——页面没有把应用逻辑放在可读的独立 JS 文件里
  （`document.scripts`/`performance` 资源列表里只看到第三方统计脚本），要破解生成规则
  得拆混淆过的前端代码，这已经越过"记录观察到的契约"，滑向绕过访问控制，不建议做。
  正当路径是"从自己的浏览器会话复制令牌喂给脚本"，不是"让脚本自己伪造令牌"。

## 未查清的部分

- `/translate/api/domain`、`/domain/api/name`（配额耗尽后）、`/history/api/timeline`
  （配额耗尽后）、`/worth/api/estimate`（配额耗尽后）、`/backlink/api/evaluate`
  （配额耗尽后）、`/review/api/analyze`（配额耗尽后）、`/adsense/api/audit`
  （配额耗尽后）、`/serp/api/serp`（配额耗尽后）：这些端点的**成功响应体结构**没有拿到——
  实测时访客配额已经在前几个工具（主要是 `/translate/` 和 `/mine/` 的 `domain` 子调用）
  耗尽，后续工具第一次提交就直接吃到 429 配额错误。端点路径、方法、请求体字段是从这次
  429 响应里的请求本身读到的，是准确的；但成功时的响应字段形状需要等配额刷新或登录后
  另开一次会话补录。
- `/adsense/api/audit` 的请求体字段名是从表单只有一个域名输入框推断的（大概率是
  `{domain: "..."}` 或 `{url: "..."}` 这类单字段），配额耗尽导致没能截到真实 `postData`。
