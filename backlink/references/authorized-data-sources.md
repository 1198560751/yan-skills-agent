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
