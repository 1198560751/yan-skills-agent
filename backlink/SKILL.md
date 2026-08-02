---
name: backlink
description: OpenCLI-first backlink discovery, profile analysis, opportunity qualification, safe browser-assisted form filling, and evidence-based verification. Use for backlinks, external links, competitor link research, blog-comment opportunities, directory submissions, Similarweb/Semrush/Ahrefs discovery, Search Console verification, anchor analysis, toxic-link review, or Chinese requests such as 反链、外链、找外链、发外链、评论外链.
---

# Backlink

Maintain one business Skill for the complete backlink lifecycle. Do not delegate
to `backlink-analyzer` or create another browser-extension Skill. OpenCLI and its
Chrome extension are the connector underneath this Skill, not separate business
workflows.

## Install and Update

Source: [Skills.sh](https://skills.sh/yan-labs/yan-skills)

```bash
# First global install, or reinstall if an update fails
npx skills add yan-labs/yan-skills --skill backlink -g -y

# Update the globally installed Skill
npx skills update backlink -g -y
```

For a project-level install, omit `-g`; update a project installation with `npx skills update backlink -p -y`.

Submit a website to 180+ free directory sites using bb-browser automation on the
Mac Mini. The user's local browser is never touched.

## Operating model

`$backlink → scripts and policy → OpenCLI → authorized Chrome session → website`

OpenCLI is preferred because it can reuse the owner's authenticated Chrome
sessions and expose page/network data without coordinate-based clicking. Use an
existing OpenCLI adapter first. When no adapter exists, use a named browser
session and DOM/network inspection.

All browser calls default to `--window background`. Never request foreground
mode unless the user explicitly wants to watch the operation. Avoid clicking
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

node scripts/similarweb-query.mjs \
  --domain example.com \
  --report performance \
  --out .backlink/similarweb-example.com.json
```

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

For BacklinkDirs-specific eligibility, read
[backlinkdirs.md](references/backlinkdirs.md). For ready-to-copy user prompts,
read [prompts.md](references/prompts.md).

## Output contract

Report:

1. data sources and authorization boundary;
2. candidates by type and reason for qualification/rejection;
3. current ledger state, never an inferred later state;
4. evidence links or local evidence files;
5. the next safe action and whether human review/submission is required.
