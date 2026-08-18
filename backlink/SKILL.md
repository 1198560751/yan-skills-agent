---
name: backlink
description: OpenCLI-first backlink discovery, profile analysis, opportunity qualification, safe browser-assisted form filling, evidence-based verification, and bulk data harvesting from logged-in dashboards. Use for backlinks, external links, competitor link research, blog-comment opportunities, directory submissions, Similarweb/Semrush/Ahrefs discovery, Search Console verification, anchor analysis, toxic-link review, disavow review, outreach templates, scraping SaaS report tables that have no API, or Chinese requests such as 反链、外链、找外链、发外链、评论外链、外链分析、抓后台数据、导出报表.
---

# Backlink

Maintain one business Skill for the complete backlink lifecycle. Do not split it
back apart, and do not create another browser-extension Skill. OpenCLI and its
Chrome extension are the connector underneath this Skill, not separate business
workflows.

Two former Skills were merged into this one on 2026-08-16 and deleted:

- `backlink-analyzer` — profile analysis, the toxicity rubric, and outreach
  templates. It shipped as prompt templates with no scripts and no browser
  access, so it could describe a link profile but never obtain one. Its content
  now lives in the three analysis references below, under its original
  Apache-2.0 license (see `references/LICENSE-analysis-templates-Apache-2.0`;
  upstream is `aaron-he-zhu/seo-geo-claude-skills`).
- `browser-harvest` — pulling report tables out of logged-in dashboards.
  See [harvest.md](references/harvest.md). Note the scope trade of the merge:
  that knowledge is general-purpose (ad platforms, e-commerce backends, any
  no-API SaaS report), but it now triggers under a backlink-named Skill. When a
  harvesting task has nothing to do with links, load this Skill anyway and read
  that one reference.

## Install and Update

Source: [Skills.sh](https://skills.sh/yan-labs/yan-skills)

```bash
# First global install, or reinstall if an update fails
npx skills add yan-labs/yan-skills --skill backlink -g -y

# Update the globally installed Skill
npx skills update backlink -g -y
```

For a project-level install, omit `-g`; update a project installation with `npx skills update backlink -p -y`.

## Operating model

`$backlink → scripts and policy → OpenCLI → authorized Chrome session → website`

Every script here shells out to the `opencli` binary, which drives the owner's
own Chrome through the OpenCLI extension. There is no separate automation
runtime: no bb-browser, no Playwright, no headless instance, and nothing that
runs on a remote machine by default. It is the owner's logged-in local Chrome,
which is exactly why the session reuse works and exactly why the safety policy
below matters.

OpenCLI is preferred because it can reuse the owner's authenticated Chrome
sessions and expose page/network data without coordinate-based clicking. Use an
existing OpenCLI adapter first. When no adapter exists, use a named browser
session and DOM/network inspection.

Default every session to background mode. The flag sits **between the session
name and the subcommand** — `opencli browser <session> --window background
<command>`. Before it and after it both fail, one with `unknown command` and one
with `unknown option`, so a misplaced flag reads like a broken install rather
than a syntax error. Never request foreground mode unless the user explicitly
wants to watch the operation. Avoid clicking
launchers that open a new window: inspect the target and open it directly in the
background session when possible. If a site cannot be operated without stealing
focus, stop and report that constraint.

Resolve all paths below relative to this `SKILL.md`.

## Start every browser task

Run the health check before browser work:

```bash
node scripts/health.mjs
```

Use `--check-update` only when the user asks about versions. An available update
is informational; do not upgrade OpenCLI without a separate request.

Read [safety-policy.md](references/safety-policy.md) before any fill,
submission, account, or logged-in operation.

## Choose one workflow

### Discover

Use when the user wants new opportunities. Read
[discovery-loop.md](references/discovery-loop.md).

The core idea retained from the Web.Cafe post is recursive discovery:

1. Seed relevant competitors or known-good sites.
2. Get their backlink rows from an authorized Semrush/Ahrefs export or logged-in
   browser, and use Similarweb for traffic and similar-site expansion.
3. Classify source URLs into editorial, resource, directory, profile, comment,
   login wall, paid, CAPTCHA, and rejected.
4. On real article pages, harvest commenter website domains.
5. Feed those domains back into the queue, fetch their backlinks, and repeat to
   a bounded depth.
6. Rank candidates by topical fit, page quality, moderation, public visibility,
   and referral potential. Low-quality comment volume is auxiliary, not the goal.

Queue commands:

```bash
node scripts/discovery-queue.mjs seed --file .backlink/discovery.json --domain competitor.com
node scripts/harvest-commenters.mjs --session backlink-discovery --url https://example.com/article --out .backlink/commenters.json
node scripts/discovery-queue.mjs import-commenters --file .backlink/discovery.json --input .backlink/commenters.json
node scripts/discovery-queue.mjs next --file .backlink/discovery.json --limit 10
```

For the user's available Similarweb and Semrush access, follow
[authorized-data-sources.md](references/authorized-data-sources.md). These
metrics help discover and prioritize candidates; they do not prove a backlink
is public, indexed, followable, or causally producing traffic.

Run a repeatable Similarweb domain query instead of retyping browser commands.
The dashboard entry point is your own account configuration, so it is supplied
through the environment and never ships with this Skill:

```bash
export TOOLS_SHARE_DASHBOARD_URL="https://<your-authorized-dashboard>"
export TOOLS_SHARE_APP_ORIGIN="https://<origin-the-dashboard-launches-into>"

node scripts/similarweb-query.mjs \
  --domain example.com \
  --report performance \
  --out .backlink/similarweb-example.com.json
```

Both variables are account configuration and neither ships with this Skill. The
launched application sits on a different host from the dashboard entry point, so
the second one cannot be derived from the first.

`--report` accepts `performance` or `similar-sites`. The script opens the
authorized dashboard, launches Similarweb, waits for the slow app startup,
navigates by stable DOM attributes, and saves both derived metrics and the
bounded source text. Sparse results are valid results for small sites. The
script fails fast with a clear message when `TOOLS_SHARE_DASHBOARD_URL` is
unset, rather than guessing an entry point.

### Inspect or prepare

Inspect every target independently. Never infer a form from a sibling site.

```bash
node scripts/inspect-page.mjs \
  --session backlink-work \
  --mode comment \
  --url https://example.com/article \
  --out .backlink/scan.json
```

Modes are `comment`, `directory`, or `auto`. A page is fillable only when there
is one unambiguous qualifying form and no detected CAPTCHA/login wall.

Create a reviewed JSON payload with truthful values:

```json
{
  "url": "https://owned.example/relevant-page",
  "name": "Real owner or product name",
  "email": "owner@example.com",
  "description": "A page-specific, useful comment or truthful listing description"
}
```

For comment mode, `description` is the comment body. Then fill without submit:

```bash
node scripts/safe-fill.mjs \
  --session backlink-work \
  --scan .backlink/scan.json \
  --payload .backlink/payload.json
```

The fill script revalidates the URL, form identity, field semantics, login
state, and CAPTCHA state. It installs a submit guard and never submits.

The human reviews the rendered page and performs final submission. Only after
the user explicitly authorizes one exact reviewed submission may the agent run
`release-submit-guard.mjs`; releasing the guard still does not click Submit.

### Analyze

Use this mode for exported backlink CSV/XLSX data or an existing backlink list.
Analyze in this single Skill:

- referring-domain quality and topical relevance;
- suspicious networks, sitewide links, and toxic patterns;
- anchor and target-page diversity;
- follow/nofollow/UGC/sponsored distribution when observed;
- competitor gaps and prioritized next opportunities.

Do not disavow links, contact site owners, or change production sites unless the
user separately asks. Treat third-party authority and traffic estimates as
directional, time-sensitive measurements.

Three references carry the analysis detail, merged from the former
`backlink-analyzer` Skill:

- [link-quality-rubric.md](references/link-quality-rubric.md) — the scoring
  matrix, toxic-link criteria, benchmarks, and disavow guidance.
- [analysis-templates.md](references/analysis-templates.md) — compact output
  templates for the profile overview, quality breakdown, toxicity list,
  competitor comparison, opportunity list, and change tracking.
- [outreach-templates.md](references/outreach-templates.md) — outreach
  frameworks, subject lines, response benchmarks, and follow-up sequences.
  Sending anything still requires the user's explicit approval per message.

These templates assume you already have the data. They do not fetch it: get the
rows from an authorized export, the Ahrefs/Semrush tools, or the harvest
workflow below, then fill the template. A report built from templates alone,
with no observed rows behind it, is fabrication.

### Harvest

Use when the numbers you need are visible in a logged-in dashboard that has no
API, charges for the API, or bills per exported row. Read
[harvest.md](references/harvest.md) before writing any scraping loop — it
documents failures that produce **plausible, silently wrong output**: virtual
scroll tables that are not `<table>` and drop rows without erroring, long URLs
that make whole rows vanish, execution-channel timeouts that look like failure
while the page loop is still running, and Chrome's intensive throttling that
stretches a four-second loop into twenty-five minutes.

```bash
sh scripts/harvest-collect.sh          # wait for downloads to settle, then collect
node scripts/harvest-merge.mjs         # merge by field shape, refuse duplicate files
```

`scripts/harvest.browser.js` is the in-page collector. Its output arrives via a
Blob download rather than a return value, because the execution channel
truncates at roughly 1 KB.

### Verify

Use exact evidence for each state:

`candidate → qualified → drafted → filled → submitted → public → indexed → rel_verified`

Create and update the ledger:

```bash
node scripts/ledger.mjs upsert --file .backlink/ledger.json --url https://target.example/page
node scripts/ledger.mjs transition --file .backlink/ledger.json \
  --url https://target.example/page --state public \
  --evidence "Observed the exact public anchor on 2026-07-30"
```

`submitted`, `public`, `indexed`, and `rel_verified` require an evidence note.
Never promote a record based on a filled form, a pending notice, or a historical
assumption. Search Console may provide supplementary link/index evidence, but
verify the exact live URL and anchor where possible.

## Non-negotiable rules

- No coordinate-based “human-like” clicking.
- No CAPTCHA, Turnstile, login, paywall, quota, or account-scope bypass.
- No generic praise, fake identity, invented metrics, or irrelevant comments.
- No link farms, spam generators, adult/malware surfaces, hidden reciprocal
  links, temporary eligibility pages, or cloaking.
- Do not record a submission as a backlink.
- Do not record `follow`, `nofollow`, `ugc`, `sponsored`, or `indexed` without
  observing it for the exact URL.
- Do not automatically resubmit an unconfirmed target.
- Keep raw cookies, tokens, authorization headers, and credentials out of logs.
- Prefer a documented HTTP endpoint over an MCP server whenever both exist and
  serve the same data from the same quota: the MCP adds a connection and a
  process without adding capability, and a failure there is harder to tell apart
  from the service being down. Keep using MCP where it is the only authorized
  channel — paid data sources such as Ahrefs and Semrush have no direct HTTP
  endpoint here, and dropping them removes capability rather than relocating it.
  Never retire a working path before the replacement has run successfully once.

For BacklinkDirs-specific eligibility, read
[backlinkdirs.md](references/backlinkdirs.md). For ready-to-copy user prompts,
read [prompts.md](references/prompts.md).

Before a first submission campaign, read
[field-notes.md](references/field-notes.md): what actually blocks submissions
(personal-contact requirements outrank CAPTCHAs), why landing-page CAPTCHA scans
give false negatives, how reciprocal-badge flows are inherently two-pass, the
browser-automation traps, and what to expect from mining a competitor's
backlinks.

When the question is about **paid** placement — what platforms exist, what they
cost, which ones are actually used, or "where did this competitor buy its
links" — read [paid-platforms.md](references/paid-platforms.md). It documents
the accumulating registry at `data/paid-platforms.json`, how placements are
detected, why a burst count is not a purchase count, and the tier vocabulary
that separates a real paid directory from a link package from a spam net.
Merge every new competitor harvest into it — the registry's value comes from
repetition across independent subjects, so it is only as good as what has been
fed in.

When the ask is "somewhere I can post without registering", read
[instant-publish.md](references/instant-publish.md) **first**. Directory
submission does not satisfy that request and burning a campaign discovering this
is the common failure. That reference carries the rule for telling the two
classes apart, per-platform verified behaviour including which ones emit no
anchor at all, the editor-API traps that make a filled form submit empty, and
why campaign results must be reported by observed `rel` rather than by
"published successfully".

## Output contract

Report:

1. data sources and authorization boundary;
2. candidates by type and reason for qualification/rejection;
3. current ledger state, never an inferred later state;
4. evidence links or local evidence files;
5. the next safe action and whether human review/submission is required.
