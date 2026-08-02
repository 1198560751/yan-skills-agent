# Authorized backlink data sources

Use this reference for logged-in research surfaces.

## Tools Share dashboard

Entry point:

由 `TOOLS_SHARE_DASHBOARD_URL` 提供(使用者自备的授权第三方面板入口，不随 Skill 分发)

The authenticated dashboard currently exposes two SEO tools:

- Similarweb, identified by `assets/svg/similarweb.svg`
- Semrush, identified by `assets/svg/semrush.svg`

Each card has a node selector, language selector, quota indicator, and an
`打开` launcher. The dashboard subscription and quotas are time-sensitive.

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
