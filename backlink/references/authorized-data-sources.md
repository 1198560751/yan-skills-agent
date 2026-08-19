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
原始数据存 `toolpear/.backlink/columbus-top100.json`。

> 这份榜是**平台层面的断言**，不是对某一条链的观测。
> 它的 Dofollow 列和第三方名单的 Dofollow 列性质一样——
> 按 [instant-publish.md](instant-publish.md) 的「Reading a third-party list」对待：
> 可以拿来排候选，不可以直接写进 ledger 当 `rel_verified`。
