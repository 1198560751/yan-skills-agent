# Authorized backlink data sources

Use this reference for logged-in research surfaces.

## Tools Share dashboard

Entry point, hardcoded because it is a public URL and every owner of this Skill
lands on their **own** account there:

```
https://dash.3ue.co/zh-Hans/#/page/m/home
```

`TOOLS_SHARE_DASHBOARD_URL` still overrides it, for anyone on a different panel.
There is nothing secret in the URL — the account lives in the browser session,
so a reader of this file gains nothing without the owner's logged-in Chrome.

Tools Share is a **shared-account proxy**: it holds one paid subscription and
lends it out through its own origins. As measured 2026-08-19 the panel carried
two SEO cards, and the card labels describe the *plan*, not the product:

| Card label on the panel | What it actually launches | Origin |
| --- | --- | --- |
| `🔖 PRO 全球版` | Similarweb PRO | `https://sim.3ue.co` |
| `🔖 GURU 地区数据库` | Semrush GURU | `https://sem.3ue.co` |

So the mapping is not guessable from the label — verify the landed origin
rather than trusting the card text, which is what `tools-share-open.mjs` does.

### Use the script, not hand-driven clicks

```bash
node scripts/tools-share-open.mjs --tool semrush
node scripts/tools-share-open.mjs --tool similarweb
node scripts/tools-share-open.mjs --tool semrush \
  --goto '/analytics/backlinks/referring-domains/?q=example.com&searchType=domain'
```

It opens the panel in a named background OpenCLI session, picks the card by
matching its label, clicks `打开`, polls until the expected origin appears, and
prints the subscription expiry and today's quota. It **never types a password**:
a logged-out panel is an error telling the owner to sign in themselves.

### 节点：会挂，而且必须在点「打开」之前选

每张卡片上有一个**节点选择器**（`节点1`…`节点N`），面板是 Angular + Nebular，
结构是 `<nb-select>` 里一个 `button.select-button` 触发，选项是 `<nb-option>`。

```bash
node scripts/tools-share-open.mjs --tool similarweb --node 5
```

四条实测规则：

1. **节点会挂，而且挂的样子很像脚本坏了。** 挂掉的节点点「打开」之后，工具页落到一个
   空白页或者长时间不渲染（`bodyText` 为空、标题却是对的）。这时**先换节点**，
   不要去调选择器、加等待、怀疑登录态——那些都不是原因。
2. **选节点必须在点「打开」之前。** 点完「打开」标签页就跳到工具域了，
   那边一个 `nb-select` 都没有。（这个顺序错误的症状是 `Seen: []`，
   读起来像「面板上没有节点选择器」，实际是你已经不在面板上了。）
3. **倍率越高，配额消耗越快**（面板自己的提示原文）。没有特别理由就用 `X 1` 的节点。
4. **卡片上的产品名是 logo 图片，没有文字。** 想按卡片文案定位卡片会失败；
   产品名真正出现在节点选择器自己的文案里（`节点3 倍率 X 1 🔖 PRO 全球版`），
   所以直接在 `nb-select` 列表里按 label 挑。

### 会话会停在工具 origin 上

点过一次「打开」之后，这个 OpenCLI 会话的标签页就留在 `sim`/`sem` 那边了。
**再 `open` 面板不保证把它导航回来**，`close` + 重新 `open` 实测也可能救不回来。
脚本已经在 `open` 之后核对当前 host，两次都不对就直接报错并指路，
而不是带着一个读不到面板的会话继续跑。

会话名之间的隔离本身是好的——三个不同 session 名实测拿到三个不同的 `page` id，
互不干扰。所以遇到这种情况，**换一个 `--session` 名重跑**是最省事的解法，
或者干脆在所有者的 Chrome 里手工走一遍：打开面板 → 在那张卡上选节点 → 点「打开」→
在落地的那个标签页里继续操作。

### Three things that will waste an hour if you do not know them

**The launcher is what mints the session.** Navigating straight to
`https://sem.3ue.co/analytics/...` before clicking `打开` lands on
**`about:blank`** — not an error page, not a redirect to a login, just blank.
Launch first, then navigate inside the established session (`--goto` does
exactly this). A blank page here means "no session yet", not "the tool is down".

**The launch URL carries a session token** as a `__gmitm=` query parameter.
Never log it, never paste it into a file, never commit it. Strip the query
string before printing any URL from these origins.

**The subscription is short-dated and the panel says so.** The instance measured
on 2026-08-19 had **2 days left** (expiry `2026-08-20 21:56`) with per-tool daily
quotas at 2% and 15%. Read `到期时间` / `剩余天数` / `API 今日配额` off the panel
before planning a campaign around this data source; the script returns all three
and warns at 7 days or fewer. Plan the pull around the expiry, not the other way
around.

### Similarweb role

Use Similarweb to:

- discover similar and competing domains;
- estimate traffic/channel mix;
- compare geographic and topical fit;
- prioritize which domains enter backlink research.

Do not treat estimated traffic as proof of link quality or causal SEO impact.

Use `scripts/similarweb-query.mjs` for repeatable domain research through this
owner-authorized session. It performs DOM-based navigation and readiness
polling; it does not use screen coordinates or expose session cookies.

```bash
node scripts/similarweb-query.mjs --domain example.com --report performance \
  --out .backlink/similarweb-example.com.json
```

The app can take 20–60 seconds to initialize. A completed report with N/A or no
similar sites is evidence of sparse Similarweb coverage, not a script failure.
Traffic, rank, channel, and competitive-site values remain directional and
time-sensitive.

### Semrush role

Use Semrush to:

- retrieve authorized backlink rows for a seed domain;
- inspect referring pages/domains and anchors;
- expand the recursive discovery queue;
- compare backlink gaps.

Respect plan quotas and exports. Never capture or print session secrets.

## Non-interruptive OpenCLI policy

The dashboard's `打开` controls may create or activate a browser window. Default
to a named OpenCLI browser session with `--window background`. Inspect the card
and launcher first. If a stable target URL or already-open tool tab is available,
open or bind that target directly instead of clicking the launcher.

Do not automate while the user is actively using the same Chrome window if the
site cannot remain backgrounded. Stop and report the limitation rather than
stealing foreground focus.

## Search Console role

Google Search Console is a verification and monitoring surface, not the primary
recursive discovery source. Keep these facts separate:

- performance clicks and queries;
- indexed/not-indexed page counts;
- link existence in a report;
- exact public anchor and `rel` attributes on the live referring page.

Authenticated access does not authorize account switching, property changes,
user management, removals, or other mutations.

## columbus.tools —— AI 工具站的外链榜（免费层可用）

`https://columbus.tools/ai-backlink-rank` 把「被 AI 工具站引用最多的外链来源域名」
按**出现频次**排好了，每行带 DR、月访问量、Dofollow/Nofollow、自然搜索占比。
这正是我们想要的「出现在多少个独立同行身上」信号，只不过它的样本池是 3,640 个 AI 站。

- **免费能拿到的**：默认排序前 100 名，无需登录。
- **要钱的**：翻页（共 126 页 / 6,254 个域名）、按 DR/流量/搜索占比筛选，
  以及 MCP 的 `list_backlink_domains` 等 6 个工具（只有 `list_model_releases` 免费）。
- **采集注意**：虚拟滚动 + Tab 分隔字段，做法见
  [harvest.md](harvest.md) 的「columbus.tools 免费层只给前 100 名」。

**2026-08-19 对账结果：前 100 名里我们已收录 22 个，78 个是新的。**
新增里判为可用 45 个、判为垃圾 33 个（短链农场与镜像站：`*-links-bhs.xyz` 系列、
`buzzshrink.website`、`anchorurl.cloud`、`urls-shortener.eu`、`shortenurls.eu`、
`bye.fyi`、`quero.party` 等，共同特征是 0 流量 + 0 自然搜索占比 + 短链形态）。
原始数据落在项目侧的 `<项目>/.backlink/columbus-top100.json`——**采集产物属于项目，不进本 Skill**。

> 这份榜是**平台层面的断言**，不是对某一条链的观测。
> 它的 Dofollow 列和第三方名单的 Dofollow 列性质一样——
> 按 [instant-publish.md](instant-publish.md) 的「Reading a third-party list」对待：
> 可以拿来排候选，不可以直接写进 ledger 当 `rel_verified`。

### 瞬时错误页：刷新即恢复，不是节点挂了（2026-08-21，站主口述 + 实测）

面板和工具页偶尔整页变成：

> **出错了**
> 别担心，我们已经发现了问题并正在处理。
> 请稍后重试。

**这是瞬时的，重载页面即恢复，多刷几次一定回来。**
不要因此换节点、改选择器、怀疑登录态——那些都不是原因。

**与「节点会挂」是两件事，症状可以区分：**

| | 瞬时错误页 | 节点挂了 |
|---|---|---|
| 页面长什么样 | **有明确错误文案**（上面那三行） | **白页 / 长时间不渲染**，`bodyText` 为空但标题是对的 |
| 怎么办 | **重载当前页**，重试几次 | **换 `--node`**，重载没用 |

`semrush-report.mjs` 已经按这条实现：命中错误文案就 `location.reload()` 重试，
默认 3 次（`--retries`），失败时的报错文案会把两种成因分开列。

### Semrush 的五张「没有导出按钮」的报告，以及会话复用的经济账

`semrush-overview.mjs` 只覆盖域名概览一张。真正做竞品勘测要的是另外四张，
全部由 `semrush-report.mjs` 覆盖：

| `--report` | 路由 | 拿得到什么 |
|---|---|---|
| `organic-overview` | `/analytics/organic/overview/` | 关键词数、自然流量、流量成本、分国家 |
| `organic-positions` | `/analytics/organic/positions/` | **全量排名词**（页面只显示 10 行，DOM 里是全部） |
| `organic-pages` | `/analytics/organic/pages/` | 哪些页在带流量、各自几个词、引荐域名数 |
| `backlinks-overview` | `/analytics/backlinks/overview/` | 引荐域名、反链、AS、月访问、**有没有 follow 反链** |
| `keyword` | `/analytics/keywordoverview/` | 量、KD、**要多少引荐域名**、CPC、分国家 |

**同一个 `--session` 贯穿整轮勘测，面板只启动一次。**
启动一次 20–40 秒并消耗一次登录，报告本身只要十几秒。
一轮读十几张报告，每张都重新启动等于把时间和配额乘以十几倍。
脚本会检测会话是否已停在工具 origin 上并跳过启动，输出里的 `sessionReused` 说明走了哪条。

**`backlinks-overview` 有一个别处拿不到的强信号**：全站一条 follow 反链都没有时，
Semrush 会直接写「找不到 Follow 反向链接」。脚本解析成 `noFollowBacklinks: true`。
它比 `AS = 0` 更明确——AS 0 也可能只是数据太新，而这句话是关于 rel 的断言。

### 两条走不通的路由，别再花一小时重新发现

- **批量关键词分析不能用 URL 驱动。** 把换行连接的关键词塞进 `?q=`，
  页面会落在「批量分析」标签页上、参数被丢弃、表格为空。**一次查一个词。**
- **Keyword Magic 的关键词表格渲染不出来。** 主题云会水合，行不会，
  于是采集「成功」但一个关键词都没有。**改用 `--report keyword` 逐词查。**

### `opencli eval` 返回裸字符串时没有 JSON 信封

`eval` 的返回值是字符串时，stdout 里就是那个裸字符串，`firstJson()` 会抛
`OpenCLI returned no JSON payload`。**所有 eval 表达式都用 `JSON.stringify(...)` 包一层**，
调用侧再兜一层 try。2026-08-21 有个一次性脚本因为这个在第一步直接崩掉，
现象是「OpenCLI 坏了」，实际是返回值形状。


### `backlinks-overview` 的「找不到 Follow 反向链接」不等于零（2026-08-21 实测）

概览页会在 Authority Score 旁边打一句「**找不到 Follow 反向链接**」。
**不要把它当成「一条 follow 都没有」的字面结论。** 同一个域名、同一时刻，
`backlinks-list` 报告顶部的卡片写着「最佳 **2** · 带 follow 属性的反向链接」，
而逐条到源页面用 `curl` 核实，**至少 7 个来源发的是无 `rel` 属性的 follow 链**。

三个数字都是 Semrush 自己给的，口径各不相同：概览那句大概率是**质量过滤后**的说法
（垃圾网络发的 follow 不计入它的权重模型），不是爬虫计数。

**规矩：`rel` 只有一个可信来源——源页面上那个 `<a>` 标签本身。**
任何第三方面板的 follow/nofollow 列都只能用来排候选，不能写进 ledger 的 `rel_verified`。
这与「Reading a third-party list」里对 Dofollow 列的处置是同一条。

### 排名页全落在裸根域名时，解析器会静默吐空（2026-08-21 实战测试）

`semrush-report.mjs --report organic-positions` 的 URL 行匹配器曾经写成
`/^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S/i`——**斜杠后面必须还有一个非空白字符**。
于是每一条排名页是裸根（`snapgen.ai/`，斜杠后面什么都没有）的行都被丢掉，
既不报错，也不留痕迹。

这不是边缘情况，是这个人群的**中位数情况**：新上线的 SaaS / AI 工具站，
自然流量基本全压在 `/` 上。2026-08-21 实测一批榜单站，**五个域名无一幸免**：

| 域名 | 修复前解析出 | 修复后 | 丢失 |
|---|---|---|---|
| snapgen.ai | 2 | 93 | 91 |
| ezmaker.ai | 51 | 100 | 49 |
| logomotion.design | 2 | 22 | 20 |
| foziscribe.ai | 8 | 14 | 6 |
| agenton.me | 2 | 5 | 3 |

危险的地方在 `ezmaker.ai` 那一行：51 行看着完全正常，没有任何理由去怀疑它。
测试者当场只发现了 snapgen.ai 一个，并且据 `logomotion.design` 那 2 行写下
「这个站几乎没有自然排名」——**结论是错的，而他不知道**。

已修（斜杠后不再要求字符）。留在这里是因为它示范了一类比选择器写错更难发现的
故障：**页面完全就绪、渲染完整、脚本退出码 0，错的是解析器自己的正则。**
Skill 里原有的四个坑全都是「页面还没好就去读」，这一个不是，所以四条老经验
一条都拦不住它。

推论，写给下一个写解析器的人：**行数是可以被证伪的。** 拿 `rawText` 里符合
「一行一条记录」特征的行数，和 `parsed.rows.length` 对一次，差额就是你正则的
盲区。这个自查比任何就绪判定都便宜。

### 会话复用之后，配额读数就消失了（2026-08-21 实战测试）

`lib-tools-share.mjs` 只在面板/仪表盘页面上刮 `API 今日配额` 那段文字。
复用会话跳过启动器——也就是本文件明确推荐、用来省时间省配额的那条路——
页面不会重新渲染那段文字，所以**后续每一次 `semrush-report.mjs` /
`semrush-keyword.mjs` 调用都不再打印配额**。

后果很具体：「配额过 80% 就停」这类预算纪律，在推荐工作流下**无法在中途执行**。
实测一轮 5 份域名报表 + 13 个关键词查询，全程只有最开始那一次启动打印过
`["3%", "33%"]`，跑完拿不到第二个读数。

所以：**按启动时那一个读数给整轮 recon 做预算**，别指望中途还能看到。
真要中途复核，只能额外付一次启动的钱（20–40 秒），值不值自己权衡。

### 行数对不上的两种原因，别混为一谈（2026-08-21 复跑）

上一节的自查——「拿 `rawText` 的记录行数和 `parsed.rows.length` 对一次」——
在复跑里当场抓到了问题，也当场制造了一次假警报。差额有两个来源，方向相反：

| 比较 | 差额说明什么 | 该怎么办 |
|---|---|---|
| `rawText` 的记录行 **>** `parsed.rows.length` | **正则有盲区**，行到手了被你丢了 | 修解析器 |
| 页面自报的总数（`自然搜索排名: N`）**>** `rawText` 里的行 | 行**根本没到你手上**：这些表是虚拟滚动，一次只挂载一部分 | 已知天花板，要全量只能走导出，而导出计入配额 |

复跑同一批域名，两种同时出现：`foziscribe.ai` 14/14、`logomotion.design` 22/22、
`agenton.me` 5/5 与页面自报完全吻合（证明解析器是对的），而 `ezmaker.ai`
解析出 91 行、页面自报 430——那是第二种，`semrush-report.mjs:288` 的注释里
早就写着「页面只渲染前 10 行……想要全量必须走导出」。

**报告时必须说清是哪一种。** 把虚拟滚动写成「解析器修好了」，
等于承诺了一份你并没有拿到的全量数据。
