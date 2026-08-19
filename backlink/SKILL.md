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

## Map of this Skill

Two things live here and they answer different questions. **The data files are
the asset; the references are how to use them and how not to fool yourself.**

```
backlink/
├── SKILL.md              ← you are here: routing + the two workflows below
├── CONTRIBUTING.md       ← how to submit a PR, the data model, the evidence rule
│
├── data/                 ← THE DATABASE. Machine-readable, PR-able, CI-checked.
│   ├── free-channels.json     places that publish a link at no cost
│   ├── submission-targets.json  routes that ACCEPT a submission — first-pass library
│   ├── paid-platforms.json    platforms observed carrying purchased placements
│   ├── index-submission.json  engines that take a URL and publish NO link
│   └── schema/                JSON Schema for the files above
│
├── scripts/              ← run these; do not re-derive their knowledge by hand
│   ├── validate-data.mjs           PR gate. CI runs exactly this. Must exit 0.
│   ├── paid-platform-registry.mjs  merge a harvest into the paid registry
│   ├── health.mjs                  run before ANY browser task
│   ├── inspect-page.mjs            dump one target's form / login / CAPTCHA state
│   ├── safe-fill.mjs               fill a reviewed payload, never submit
│   ├── release-submit-guard.mjs    only after explicit per-submission approval
│   ├── ledger.mjs                  candidate → … → indexed → rel_verified
│   ├── discovery-queue.mjs         recursive competitor/commenter expansion
│   ├── harvest-commenters.mjs      pull commenter domains off an article
│   ├── third-party-list-ingest.mjs someone else's list → screened leads + diff
│   ├── probe-submission-targets.mjs leads → reachability, route, gate, price
│   ├── merge-submission-targets.mjs fold a probe run into the two data files
│   ├── targets-select.mjs          pick ONE batch: --cohort open | captcha | …
│   ├── harvest-*.{sh,mjs,js}       bulk table extraction from logged-in dashboards
│   └── similarweb-query.mjs        repeatable domain query (needs your own env)
│
└── references/           ← method, traps, and why the rules are the rules
    ├── instant-publish.md     ★ free channels: how each class behaves, what kills them
    ├── paid-platforms.md      ★ paid: tiers, why a burst is not a purchase
    ├── index-submission.md      index-only channels; why `indexed` must name an engine
    ├── batch-campaign.md         ★ 100+ rows: queue, idempotency, resume, reporting
    ├── field-notes.md           what actually blocks submissions in practice
    ├── harvest.md               scraping failures that look like success
    ├── safety-policy.md         read before any fill / submit / logged-in action
    ├── discovery-loop.md        finding new candidates
    ├── link-quality-rubric.md   scoring, toxicity, disavow
    ├── analysis-templates.md    report shapes (they do not fetch data)
    ├── outreach-templates.md    email frameworks; sending needs approval each time
    ├── authorized-data-sources.md · backlinkdirs.md · prompts.md
    └── LICENSE-analysis-templates-Apache-2.0
```

### Which door do I go through?

| The ask | Start at |
| --- | --- |
| "Somewhere I can post **without registering**" | `data/free-channels.json`, filtered to `account: "none"` and `status: "live"` — then [instant-publish.md](references/instant-publish.md) for the mechanics of that class |
| "What **paid** options exist / where did this competitor buy its links" | [paid-platforms.md](references/paid-platforms.md), then `data/paid-platforms.json` sorted by how many independent sites were observed using each |
| "Find me **new** opportunities" | [discovery-loop.md](references/discovery-loop.md) — and merge whatever you harvest back into the registry |
| "Where can I **submit** this site" (any site, any niche) | `node scripts/targets-select.mjs --stats`, then run one cohort at a time |
| "Give me the ones I can do **without a CAPTCHA**" · "now the account ones" | `node scripts/targets-select.mjs --cohort open` / `--cohort account` — see "Run one cohort at a time" below |
| "Is this link profile any good" | [link-quality-rubric.md](references/link-quality-rubric.md) |
| "Get these numbers out of a dashboard with no API" | [harvest.md](references/harvest.md) |
| "Here are **300 directories**, submit to them" · a campaign that must survive being interrupted | [batch-campaign.md](references/batch-campaign.md) — the single-target loop below does not scale as-is |
| "Someone published a **list** of backlink sites, is it useful" | `scripts/third-party-list-ingest.mjs` to normalise and diff it, then the "Reading a third-party list" section of [instant-publish.md](references/instant-publish.md) |
| "Submit our pages to **Brave / another engine**" · "why is our index count low on X" | [index-submission.md](references/index-submission.md) — it publishes no link, so it never enters the placement ledger |

Query the data directly rather than reading the JSON by eye:

```bash
# live channels that need no account
node -e 'const d=require("./data/free-channels.json");console.log(d.channels.filter(c=>c.account==="none"&&c.status==="live").map(c=>`${c.id}	${c.kind}	${(c.relObserved||["?"]).join("|")||"dofollow"}`).join("
"))'

# paid platforms ranked by how many independent sites were seen using them
node scripts/paid-platform-registry.mjs list --min-sites 2
```

### Before you trust a row, and before you add one

Records carry `lastVerifiedAt` because **this genre dies faster than it
changes**. A channel that worked three months ago may be gone, gated, or
`noindex` today. Re-verify before a campaign; the validator warns on anything
`live` and older than 180 days.

And when you find that a row is wrong — dead host, new account wall, new
CAPTCHA, changed `rel` — **fixing it is the most valuable contribution there
is**, more than adding a new channel. See [CONTRIBUTING.md](CONTRIBUTING.md).
The evidence rule in one line: *record what you observed, never what you
assume*; a real entry rejected is a small loss, an unverified entry accepted is
a large one.

### The two tables are not the same claim

`free-channels.json` and `submission-targets.json` look similar and mean very
different things. Confusing them is the one way to destroy both.

| | `free-channels.json` | `submission-targets.json` |
| --- | --- | --- |
| What was observed | **a published link on a live page** | **a submission route that exists** |
| Answers `relObserved` / `anchorRendered` | yes, required | **never** — the validator rejects those fields here |
| What it is for | round two: post here again, you know what happens | round one: the screening pass, and the cross-site asset it produces |
| How a row gets in | somebody published and read the anchor | somebody reached the route and read the gate |

A target **graduates** from the second table into the first the moment an actual
anchor is observed. Until then it makes no promise about `rel`, anchor text, or
indexability, and the report must not imply one.

This split exists because of the doctrine below: the first round's *failures are
the asset*. A directory that turned out to need an account is not a wasted probe,
it is a row that saves the next campaign — and the next **site**. That library is
reusable across every site the owner ever builds, which is why it lives in the
Skill and not in any one project.

### Run one cohort at a time

Every target carries **all** the gates observed on it in `gates`, and a `cohort`
derived from that set. The cohort is the batch it belongs in, because the
cohorts cost different things:

| Cohort | What the run needs |
| --- | --- |
| `open` | nobody. This is the only cohort that can run unattended. |
| `captcha` | a human at the keyboard for the whole run |
| `account` | credentials and an identity decision, made **before** the run |
| `account-captcha` | both of the above |
| `email-verify` | a mailbox watched while the run is going; tokens expire mid-batch |
| `reciprocal` | a change to the owner's own site — their decision, never yours |
| `personal-contact` | real name / phone / company email — also the owner's decision |

**Mixing cohorts in one run is what makes a batch stall.** The open rows finish
in minutes and then everything waits on a person nobody told to be there. So:
pick one cohort, run it to the end, then pick the next.

```bash
node scripts/targets-select.mjs --stats                     # cohort x payment matrix
node scripts/targets-select.mjs --unattended --free-only    # the run needing nobody
node scripts/targets-select.mjs --cohort captcha --limit 40 # the next session
node scripts/targets-select.mjs --cohort account --format urls
```

Two details that are easy to get backwards. `captcha-passive` does **not** put a
target in the `captcha` cohort — it clears itself in an ordinary browser and
costs the run nothing; treating it as a challenge pushes open targets into the
queue that needs a person. And `--free-only` keeps `payment: "optional"`,
because a free listing behind a three-month queue is still free — it drops only
`required`.

`gate` (singular) remains the single answer to "what stops me here first",
ranked by **cost**, not by DOM order: a demand for a phone number outranks an
account, which outranks a CAPTCHA. All four values — `gates`, `gate`, `cohort`,
and the ban on `usable` when a human gate exists — are derived in one place,
`scripts/lib-cohort.mjs`, and the validator recomputes them. Deriving a cohort
by hand in a report is how a target reads `account` in the data and `open` in
the plan, which is worse than having no label at all.

Build or extend it with:

```bash
# 1. someone's list → deduped leads
node scripts/third-party-list-ingest.mjs --input THEIR-LIST.md --out .backlink/leads.json

# 2. leads → reachability, real route, earliest gate, price on the page
node scripts/probe-submission-targets.mjs --input .backlink/leads.json \
  --out .backlink/probed.json --concurrency 12 --resume

# 3. fold in (paid rows route themselves into paid-platforms.json)
node scripts/merge-submission-targets.mjs --probe .backlink/probed.json \
  --source-list 'where this came from' --dry-run

# 4. pick a batch and run it
node scripts/targets-select.mjs --cohort open --free-only
```

Step 2 is anonymous HTTP, so it is honest only about what **is** present. Rows it
cannot resolve come out `unverified` and need a browser or a human before they
mean anything; the merge drops them rather than letting them pad a count.

## 术语：「数据面板」「数据勘测」= Similarweb + Semrush

**当用户说「数据面板」「数据勘测」「查一下数据」「用 Similarweb 看看」「Semrush 拉一下」，
指的都是同一件事：走那个共享账号的代理面板，用 Similarweb 或 Semrush 查。**
这两个产品是这里唯一的第三方数据源，没有别的候选，不需要反问用户指的是哪个平台。

分工固定，按问题类型选，不要两个都开：

| 问题 | 用哪个 | 拿得到什么 |
| --- | --- | --- |
| 这个站多大、流量从哪来、还有哪些同类站 | **Similarweb** | 总访问量（含直接/推荐，**不只是自然搜索**）、渠道构成、相似站、地理分布 |
| 这个词多少量、多难、谁在排、它的外链长什么样 | **Semrush** | 分国家搜索量与 KD、关键词全库导出、自然排名、主要页面、引荐域名与反链 |

**两边的「流量」不是一个口径，对不上很正常。** Semrush 的域名概览给的是**自然搜索流量估算**，
Similarweb 给的是**总访问量**。同一个站两边差三倍以上是常态，
写结论时必须标明是哪个口径，否则会得出「竞品比想象中弱」这种错误判断。

接入方式、面板卡片与产品的对应关系、订阅到期与配额、以及三个会浪费一小时的坑，
全部在 [authorized-data-sources.md](references/authorized-data-sources.md)。
**开工前先看订阅剩余天数**——这是短期订阅，脚本会打印，7 天内会告警。

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

### The session name is a tab claim — never hardcode a literal one

**Each `opencli browser <session>` name owns its own tab. Different names never
steal from, switch, or pollute each other.** So "another task stole my tab" is
never the CLI round-robining; it is always **two tasks that picked the same
session name**.

Measured 2026-08-19 on opencli 1.8.6:

```bash
opencli browser isoA --window background open https://example.com/
opencli browser isoB --window background open https://example.org/
opencli browser isoA --window background open https://example.net/
# isoA -> https://example.net/    isoB -> https://example.org/
# each session's `tab list` shows only its own single tab
```

`isoB` was untouched by `isoA`'s second navigation, and neither `tab list` could
see the other's tab.

This Skill caused the exact failure it warns about: `scripts/tools-share-open.mjs`
defaulted to the literal session `backlink-panel`. Two concurrent tasks each ran
it, shared one tab, and each read back pages the other had opened — which looks
identical to tab theft. The symptom is subtle and expensive: navigation reports
success, then `eval` returns someone else's document.

**Rules:**

- Never write a literal session name as a default. In JS, never hand-roll the
  suffix either — `scripts/opencli-core.mjs` exports `defaultSession(base)`,
  which applies it and validates the result:

  ```js
  const session = flags.session ? validateSession(flags.session) : defaultSession('backlink-work');
  ```

- The suffix resolves `OPENCLI_SESSION_SUFFIX` → `CLAUDE_CODE_SESSION_ID` →
  `CLAUDE_CODE_HOST_SESSION_ID` → pid. **Never key off the HOST id directly**:
  it is per desktop-app host and shared by every conversation running inside it,
  so it hands parallel tasks the same tab — the exact bug this guards against.
  `CLAUDE_CODE_SESSION_ID` is per conversation, which is the unit that actually
  runs concurrently.
- **Subagents inherit the parent's environment**, so several agents spawned
  inside one conversation resolve to the same default. When fanning browser work
  out across parallel agents, give each an explicit `--session` or a distinct
  `OPENCLI_SESSION_SUFFIX`.
- In shell, do the same: `SESSION="backlink-$$"`, never a bare constant.
- If `eval` returns a page you did not navigate to, suspect a name collision
  **before** suspecting the site or the CLI. Confirm with
  `opencli browser <session> tab list`.
- Release the lease with `opencli browser <session> close` when done.

### Background mode is not headless

Default every session to background mode. The flag sits **between the session
name and the subcommand** — `opencli browser <session> --window background
<command>`. Before it and after it both fail, one with `unknown command` and one
with `unknown option`, so a misplaced flag reads like a broken install rather
than a syntax error.

Background mode runs the owner's real, logged-in Chrome without raising the
window. It does **not** steal focus and it is **not** headless. Measured probes
inside a background session:

| Probe | Value |
|---|---|
| `navigator.webdriver` | `false` |
| UA contains `Headless` | no |
| `navigator.plugins.length` | 5 |
| `document.visibilityState` | `visible` (background windows are not throttled) |
| `window.outerWidth × outerHeight` | 1364 × 806 |

So "background mode will trip the site's bot defences" is not a real concern
here — every headless tell reads negative. There is never a reason to reach for
foreground to look more human. Request foreground only when the user explicitly
wants to watch. Avoid clicking launchers that open a new window: inspect the
target and open it directly in the background session when possible. If a site
cannot be operated without stealing focus, stop and report that constraint.

### If you reach for a different browser tool

`agent-browser` is the other CLI on this machine and it solves a different
problem: each `--session` is an isolated browser with its own cookies, default
headless. Use it only when the task needs **no** logged-in identity. Anything
touching the owner's authenticated sessions — the Tools Share panel, Search
Console, a logged-in community — stays on OpenCLI, because that identity is the
whole reason this Skill drives the owner's Chrome.

One trap worth knowing if you do use it: when several `agent-browser` sessions
share one Chrome (`--cdp <port>` or `--auto-connect`), `open` navigates the
**shared active tab** by default and the sessions collide. Pass `--pin-tab` on
each session's first command; the binding is sticky, and a closed bound tab then
fails with `tab_gone` instead of silently acting on someone else's tab.

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

# step 2 in bulk: feed an authorized referring-domains export straight in.
# --input takes a Semrush refdomains CSV, a JSON array, or one domain per line.
# Edges are typed `refdomain` — do NOT route these through import-commenters,
# which would record a commenter relationship nobody observed.
node scripts/discovery-queue.mjs import-refdomains --file .backlink/discovery.json \
  --source competitor.com --input .backlink/competitor-refdomains.csv

node scripts/harvest-commenters.mjs --session backlink-discovery --url https://example.com/article --out .backlink/commenters.json
node scripts/discovery-queue.mjs import-commenters --file .backlink/discovery.json --input .backlink/commenters.json
node scripts/discovery-queue.mjs next --file .backlink/discovery.json --limit 10
```

For the user's available Similarweb and Semrush access, follow
[authorized-data-sources.md](references/authorized-data-sources.md). Both live
behind one shared-account panel; open either with:

```bash
node scripts/tools-share-open.mjs --tool semrush
```

Launching through the panel is mandatory — a deep link into the tool origin
before the launcher runs lands on `about:blank`, and the panel's subscription is
short-dated, so check the expiry the script prints before planning around it. These
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

**`indexed` must name the engine** — write `indexed@google`, `indexed@brave`.
An unqualified "indexed" is a claim about the whole web built from one crawler's
opinion, and every promotion so far has in fact come from Google or Bing. The
engines with their own crawlers, what reaches them, and what does not, are in
[index-submission.md](references/index-submission.md).

## Non-negotiable rules

- No coordinate-based “human-like” clicking.
- No CAPTCHA, Turnstile, login, paywall, quota, or account-scope bypass.
- No generic praise, fake identity, invented metrics, or a comment body that
  ignores the article it sits under. A host site on a different topic is fine —
  relevance and DR rank candidates, they never gate them, and `nofollow` is an
  observation to record rather than a reason to skip. Read
  [acquisition-doctrine.md](references/acquisition-doctrine.md) before rejecting
  any target on quality grounds.
- No link farms, spam generators, adult/malware surfaces, hidden reciprocal
  links, temporary eligibility pages, or cloaking.
- Do not record a submission as a backlink. This includes handing a URL to a
  search engine: that is an index-submission channel, it publishes no link, and
  it belongs in `data/index-submission.json` rather than the placement ledger.
- Do not record `follow`, `nofollow`, `ugc`, `sponsored`, or `indexed` without
  observing it for the exact URL.
- Do not automatically resubmit an unconfirmed target. **Never retry an
  ambiguous final action** — one where the submit happened and the result was not
  observed. Check the account backend, then the mailbox, then the public page.
  That state is `outcome-unknown`, and it is not a failure.
- Anchor text is the brand, the product name, or the naked canonical URL. Never
  request dofollow treatment, never repeat a commercial exact-match anchor across
  a campaign, and treat a paid or incentivised placement that publishes as a
  plain follow link as **noncompliant** rather than as a win.
- A click, a completed registration, a saved draft, a form that cleared itself,
  or a generic thank-you URL is **not** evidence of a submission. Those record
  what you did; the ledger records what the site did.
- Never invent a product fact to fill a field — founder, pricing, address, launch
  date, user count, ownership, legal, or contact. Leave optional unknowns blank
  and stop a row whose required field is unknown.
- Records carry aliases and evidence IDs. Passwords, OTPs, recovery codes,
  cookies, OAuth parameters, magic links, raw session IDs, raw email addresses,
  and phone numbers belong in none of them.
- A third-party traffic figure without `source · metric · month · geography ·
  device · date verified` is not a number. Store all six or store none.
- Keep raw cookies, tokens, authorization headers, and credentials out of logs.
- Prefer a documented HTTP endpoint over an MCP server whenever both exist and
  serve the same data from the same quota: the MCP adds a connection and a
  process without adding capability, and a failure there is harder to tell apart
  from the service being down. Keep using MCP where it is the only authorized
  channel — paid data sources such as Ahrefs and Semrush have no direct HTTP
  endpoint here, and dropping them removes capability rather than relocating it.
  Never retire a working path before the replacement has run successfully once.

When the question is **"should we post here at all"** — a target on a different
topic, a low-DR host, a platform known to emit `nofollow`, or a first round that
mostly bounced into moderation — read
[acquisition-doctrine.md](references/acquisition-doctrine.md) **before** rejecting
anything. It carries the site owner's standing ruling, sourced to a practitioner's
own posts: relevance and authority rank candidates but never gate them, `nofollow`
is recorded rather than avoided, and a first campaign is a screening pass whose
"failures" are the asset. It also fixes the evidence bar for `indexed` (a `site:`
query on the host page, never a third-party crawler's count).

For BacklinkDirs-specific eligibility, read
[backlinkdirs.md](references/backlinkdirs.md). For ready-to-copy user prompts,
read [prompts.md](references/prompts.md).

When the campaign is **large** — a supplied list of a hundred rows or more,
anything that has to survive being interrupted, or anything where the report will
be a count — read [batch-campaign.md](references/batch-campaign.md) before
opening a browser. The single-target loop above is correct per target and wrong
per campaign: it deduplicates too late, stalls the whole run behind the first
CAPTCHA, cannot tell an interrupted row from an unstarted one, and produces a
number that counts forms instead of links.

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

When someone hands you **a list of places to get backlinks** — a tiered table with
a Dofollow column, a competitor's "we got 200 links here" post, or another Skill's
directory list — read the "Reading a third-party list" section of
[instant-publish.md](references/instant-publish.md) before acting on any row of it.
Those lists are worth harvesting and worthless to trust: the Dofollow column is an
assertion about a platform, never an observation of a link, and the sweep that
produced that section found a listed site that publishes your URL as plain text
with no anchor at all, plus one whose domain now redirects to an unrelated product
while still answering 200.

When the ask is about **getting pages into an index** rather than getting a link
— submitting URLs to an engine, a low `site:` count somewhere that is not Google,
or optimising for AI answers — read
[index-submission.md](references/index-submission.md). It carries the reason a
second index matters (an independent index is a grounding source for AI answers,
so a page missing from it is missing from every answer built on it), the rule
that keeps these channels out of `free-channels.json`, the baseline-then-recheck
measurement that makes such a campaign judgeable, and the per-engine traps —
including a form where a synthesised `click()` silently does nothing because the
passive check demands a trusted event.

When the ask is "somewhere I can post without registering", read
[instant-publish.md](references/instant-publish.md) **first**. Directory
submission does not satisfy that request and burning a campaign discovering this
is the common failure. That reference carries the rule for telling the two
classes apart, per-platform verified behaviour including which ones emit no
anchor at all, the editor-API traps that make a filled form submit empty, and
why campaign results must be reported by observed `rel` rather than by
"published successfully".

## Credits

This Skill absorbs work from other people. Their rules are marked where they are
used; this is the full list.

- **[flaqai/backlink_skills](https://github.com/flaqai/backlink_skills)** (MIT,
  Flaq AI) — the campaign-operations layer in
  [batch-campaign.md](references/batch-campaign.md): idempotency keys, execution
  shards, the verification-first pipeline that keeps one CAPTCHA from stalling a
  run, per-action authorization, resumable state, the anchor-text policy, and the
  reporting discipline that separates published listings from submitted forms.
  Their `Free-backlink-list.md` (743 entries) is also the largest third-party
  lead list this Skill has been tested against — see
  [instant-publish.md](references/instant-publish.md#reading-a-third-party-places-to-get-a-backlink-list).
  Their two Skills carry no channel list of their own and expect user-supplied
  URLs, so the list and the workflow are separate assets in that repo too.
- **[aaron-he-zhu/seo-geo-claude-skills](https://github.com/aaron-he-zhu/seo-geo-claude-skills)**
  (Apache-2.0) — the analysis templates, quality rubric, and outreach frameworks
  in [analysis-templates.md](references/analysis-templates.md),
  [link-quality-rubric.md](references/link-quality-rubric.md), and
  [outreach-templates.md](references/outreach-templates.md). Licence text is kept
  at `references/LICENSE-analysis-templates-Apache-2.0`.

## Output contract

Report:

1. data sources and authorization boundary;
2. candidates by type and reason for qualification/rejection;
3. current ledger state, never an inferred later state;
4. evidence links or local evidence files;
5. the next safe action and whether human review/submission is required.
