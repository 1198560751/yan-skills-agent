---
name: backlink
description: OpenCLI-first backlink discovery, profile analysis, opportunity qualification, safe browser-assisted form filling, evidence-based verification, and bulk data harvesting from logged-in dashboards. Use for backlinks, external links, competitor link research, blog-comment opportunities, directory submissions, Similarweb/Semrush/Ahrefs discovery, Search Console verification, anchor analysis, toxic-link review, disavow review, outreach templates, scraping SaaS report tables that have no API, driving the owner's logged-in Chrome from a script, or Chinese requests such as 反链、外链、找外链、发外链、评论外链、外链分析、抓后台数据、导出报表、数据面板、数据勘测.
---

<skill name="backlink" version="3.3" body-format="xml">

<why-xml>
The frontmatter above stays YAML because the Skill loader reads it for
discovery. Everything below is XML because this Skill is mostly laws and
routing, and a law that is easy to skim past is a law that gets broken. Tagged
blocks make "which rule did I just violate" answerable by name.
</why-xml>

<mission>
One business Skill for the complete backlink lifecycle. Do not split it back
apart, and do not create another browser-extension Skill — OpenCLI and its
Chrome extension are the connector underneath this Skill, never a separate
business workflow.

Two former Skills were merged in on 2026-08-16 and deleted: `backlink-analyzer`
(analysis templates, toxicity rubric, outreach — now in three references under
its original Apache-2.0 licence) and `browser-harvest` (pulling tables out of
logged-in dashboards — now <ref file="references/harvest.md"/>). The harvest
knowledge is general-purpose: ad platforms, e-commerce backends, any no-API
SaaS report. When a harvesting task has nothing to do with links, load this
Skill anyway and read that one reference.
</mission>

<map>
<summary>
Two things live here and they answer different questions. **The data files are
the asset; the references are how to use them and how not to fool yourself.**
</summary>
<tree><![CDATA[
backlink/
├── SKILL.md              ← you are here: laws + routing + workflow entry points
├── CONTRIBUTING.md       ← how to submit a PR, the data model, the evidence rule
│
├── data/                 ← THE DATABASE. Machine-readable, PR-able, CI-checked.
│   ├── free-channels.json       places that publish a link at no cost
│   ├── submission-targets.json  routes that ACCEPT a submission — first-pass library
│   ├── paid-platforms.json      platforms observed carrying purchased placements
│   ├── network-fingerprints.json known automation/PBN families; negative evidence, never placements
│   ├── index-submission.json    engines that take a URL and publish NO link
│   └── schema/                  JSON Schema for the files above
│
├── scripts/              ← run these; do not re-derive their knowledge by hand
│   ├── validate-data.mjs           PR gate. CI runs exactly this. Must exit 0.
│   ├── validate-skill-xml.mjs      the OTHER gate: SKILL.md body well-formed + every
│   │                               <ref>/<law-ref> resolves. A bare <tag> in prose
│   │                               silently unbalances the doc from that line on.
│   ├── self-test.mjs               end-to-end smoke over the core scripts
│   ├── health.mjs                  run before ANY browser task
│   ├── opencli-core.mjs            ★ defaultSession(), batchBrowser(), openAndEval(), run(), closeSession()
│   ├── lib-tools-share.mjs         ★ the ONE panel launcher
│   ├── tools-share-open.mjs        launch a tool by name; --goto for a deep link
│   ├── tools-share-node.mjs        `list` a tool's nodes (read-only) or `probe` them one by
│   │                               one — each node is a DIFFERENT shared account, so a node
│   │                               capped on its daily report quota is fixed by switching node,
│   │                               not by retrying
│   ├── similarweb-query.mjs        performance | channels | similar-sites | audience-geo | site-keywords
│   ├── similarweb-keywords.mjs     seed keyword → thousands of related keywords.
│   │                               The keyword-research entry point the pipeline was missing.
│   │                               Column-major DOM table; parsing lives in lib-similarweb.mjs
│   ├── similarweb-batch.mjs        bulk traffic screen — one login, N domains, resumable
│   ├── semrush-batch.mjs           same, on the other card's quota (organic traffic)
│   ├── semrush-overview.mjs        AS / organic traffic / ref-domains / keywords
│   ├── semrush-keyword.mjs         global keyword detail plus one-session multi-country bulk plans
│   ├── semrush-report.mjs          the OTHER five no-export reports (incl. referring-domains,
│   │                               --rollup aggregates the rows THIS run fetched); reuses one
│   │                               session; table reports paginate — pass --all-pages or it warns
│   ├── semrush-traffic.mjs         Traffic & Market (.Trends) TOTAL visits — the only
│   │                               Semrush number comparable with Similarweb. Runs
│   │                               **foreground by default**, alone in this Skill:
│   │                               the summary never hydrates if it *loads* hidden.
│   │                               But "empty" has two unrelated causes with opposite
│   │                               remedies — not hydrated vs never had a table — and
│   │                               only the first is worth re-reading.
│   │                               See <law-ref id="hidden-tabs-do-not-hydrate"/>
│   ├── traffic-crosscheck.mjs      offline: eats one semrush-traffic.mjs JSON and one
│   │                               similarweb-query.mjs JSON and reports whether the two
│   │                               platforms agree; never touches a page itself
│   ├── tools-share-evidence.mjs    rendered, redacted evidence bundle for one report
│   ├── page-read.mjs               render a public page → text, prices, paywall shape
│   ├── apply-traffic-screen.mjs    write verdicts back into submission-targets.json
│   ├── inspect-page.mjs            dump one target's form / login / CAPTCHA state
│   ├── safe-fill.mjs               fill a reviewed payload, never submit
│   ├── lib-deep-dom.mjs           ★ the ONE shadow-DOM-piercing traversal. EVERY counting
│   │                               probe goes through it. Measured 2026-08-29 on one page,
│   │                               one instant: body.innerText 59 chars / deep text
│   │                               1,605,054 / 44 shadow roots. innerText and
│   │                               querySelectorAll both stop at the shadow boundary, so
│   │                               every table / cell / text count taken before this file
│   │                               existed measured a sliver of the page. Emits the LIGHT
│   │                               reading beside the deep one - the gap is the diagnostic.
│   │                               Also holds the segmented-scroll capability (default off).
│   │                               See <law-ref id="readiness-must-bind-to-this-query"/>
│   ├── lib-report-readiness.mjs    ★ the report-route criteria, and the HARD GATE that runs
│   │                               BEFORE any classification: landed path == requested
│   │                               route, header domain == requested target, content region
│   │                               non-empty. Any one failing ⇒ `inconclusive`, never
│   │                               `no-table` and never `empty`.
│   ├── lib-submit-outcome.mjs      ★ the ONE "did this submission get accepted" criterion.
│   │                               Paired on purpose: acceptance evidence must sit OUTSIDE
│   │                               every form, and no rejection marker may be present — a
│   │                               form that silently redraws itself with our own URL echoed
│   │                               back into its input satisfies "our URL is on the page"
│   │                               while nothing was accepted.
│   │                               See <law-ref id="readiness-must-bind-to-this-query"/>
│   ├── release-submit-guard.mjs    only after explicit per-submission approval
│   ├── submit-directory.mjs        the single-target driver; one session per staged site
│   ├── adapter-phpld.mjs           ★ reference implementation of one-session-per-site
│   ├── adapter-phpld-submit.mjs    Lane A submit for that family. SEPARATE ON PURPOSE —
│   │                               staging is safe family-wide, pressing submit is not,
│   │                               and the two must never share a flag. Re-checks for a
│   │                               challenge that appeared since staging, and refuses.
│   ├── ledger.mjs                  candidate → … → indexed → rel_verified; stats + remaining
│   ├── discovery-queue.mjs         recursive competitor/commenter expansion
│   ├── harvest-commenters.mjs      pull commenter domains off an article
│   ├── third-party-list-ingest.mjs someone else's list → screened leads + diff
│   ├── fingerprint-forms.mjs       ★ cluster targets by FORM SHAPE, not by site. Field
│   │                               names are stable across every install of a family,
│   │                               so one adapter covers twenty sites. This is what makes
│   │                               batch cheaper than walking 150 forms by hand.
│   ├── probe-submission-targets.mjs leads → reachability, route, gate, price
│   ├── merge-submission-targets.mjs fold a probe run into the two data files
│   ├── lib-cohort.mjs              ★ the shared cohort/gate vocabulary — targets-select,
│   │                               validate-data, probe and merge all read it. Change a
│   │                               cohort name here, not in four places.
│   ├── targets-select.mjs          pick ONE batch: --cohort open | captcha | … ; --ledger excludes submitted
│   ├── paid-platform-registry.mjs  merge a harvest into the paid registry
│   ├── harvest-*.{sh,mjs}          bulk table extraction from logged-in dashboards
│   └── harvest.browser.js          ★ generic virtual-scroll table extractor: rebuilds rows
│                                   by Y-coordinate clustering, adapts to column drift.
│                                   NOTE the dot — the harvest-* glob above does NOT match it.
│
└── references/           ← method, traps, and why the rules are the rules
    ├── browser-runtime.md     ★★ READ FIRST for any browser work. The laws + measurements.
    ├── traffic-screen.md      ★ the qualifying gate, and why it runs before the form
    ├── submission-lanes.md    ★ lanes, cohorts, the three guards, staged queues
    ├── instant-publish.md     ★ free channels: how each class behaves, what kills them
    ├── paid-platforms.md      ★ paid: tiers, why a burst is not a purchase
    ├── batch-campaign.md      ★ 100+ rows: queue, idempotency, resume, reporting
    ├── directory-run-playbook.md ★ what a real run hits: hidden free tiers, already-listed sites, stale ledger rows
    ├── index-submission.md      index-only channels; why `indexed` must name an engine
    ├── authorized-data-sources.md  the panel, the cards, quota, expiry, the traps
    ├── field-notes.md           what actually blocks submissions in practice
    ├── harvest.md               scraping failures that look like success
    ├── safety-policy.md         read before any fill / submit / logged-in action
    ├── acquisition-doctrine.md  the standing ruling on what is worth pursuing
    ├── discovery-loop.md · link-quality-rubric.md · analysis-templates.md
    ├── outreach-templates.md · backlinkdirs.md · prompts.md · credits.md
    └── LICENSE-analysis-templates-Apache-2.0
]]></tree>
<path-rule>Resolve every path in this file relative to this SKILL.md.</path-rule>
</map>

<routing>
<summary>Match the ask to a starting point. When two rows fit, take the lower one — it is more specific.</summary>
<route ask="Somewhere I can post without registering">
  `data/free-channels.json` filtered to `account: "none"` and `status: "live"`,
  then <ref file="references/instant-publish.md"/> for that class's mechanics.
  Directory submission does NOT satisfy this ask; burning a campaign discovering
  that is the common failure.
</route>
<route ask="What paid options exist / where did this competitor buy its links">
  <ref file="references/paid-platforms.md"/>, then `data/paid-platforms.json`
  sorted by how many independent sites were observed using each.
</route>
<route ask="Find me new opportunities">
  <ref file="references/discovery-loop.md"/> — merge whatever you harvest back
  into the registry.
</route>
<route ask="Where can I submit this site">
  `node scripts/targets-select.mjs --stats`, then one cohort at a time per
  <ref file="references/submission-lanes.md"/>.
</route>
<route ask="Is this link profile any good">
  <ref file="references/link-quality-rubric.md"/>
</route>
<route ask="Get these numbers out of a dashboard with no API">
  <ref file="references/harvest.md"/>
</route>
<route ask="Here are 300 directories, submit to them / a campaign that must survive interruption">
  <ref file="references/batch-campaign.md"/>. The single-target loop is correct
  per target and wrong per campaign.
</route>
<route ask="Someone published a list of backlink sites, is it useful">
  `scripts/third-party-list-ingest.mjs --blocklist data/network-fingerprints.json`
  to normalise, diff, and preserve known network-family exclusions, then the
  "Reading a third-party list" section of
  <ref file="references/instant-publish.md"/>.
</route>
<route ask="Submit our pages to Brave / another engine, why is our index count low">
  <ref file="references/index-submission.md"/>. It publishes no link, so it never
  enters the placement ledger.
</route>
<route ask="Should we post here at all — off-topic host, low DR, known nofollow">
  <ref file="references/acquisition-doctrine.md"/> BEFORE rejecting anything.
</route>
<route ask="Just open this page and tell me what is on it">
  <workflow-ref id="explore"/> — still OpenCLI, still a script.
</route>
<query-the-data>
Query the data rather than reading JSON by eye.
<cmd><![CDATA[
node -e 'const d=require("./data/free-channels.json");console.log(d.channels.filter(c=>c.account==="none"&&c.status==="live").map(c=>`${c.id}\t${c.kind}`).join("\n"))'
node scripts/paid-platform-registry.mjs list --min-sites 2
]]></cmd>
</query-the-data>
</routing>

<browser-runtime>
<summary>
`$backlink → scripts and policy → OpenCLI → the owner's authorized Chrome → website`

Every script here shells out to the `opencli` binary, which drives the owner's
own logged-in Chrome through the OpenCLI extension. No Playwright, no headless
instance, no remote runtime. That identity is the entire reason this Skill
exists, and it is why the laws below matter.

**Read <ref file="references/browser-runtime.md"/> before any browser work.** The
detailed laws, the measurements behind them, the two other drivers and what they
cost, and the ordered checklist for diagnosing "something stole my tab" now live in
the `opencli` Skill — that file points at the exact reference for each, and keeps the
backlink-specific residue (`scripts/opencli-core.mjs`, subagent session fan-out).
Load `/opencli` when you need the detail: `npx skills add yan-labs/yan-skills --skill opencli -g -y`.
</summary>

<default-driver>
OpenCLI is the default for **everything**, including a quick ad-hoc look at one
page. It reaches the owner's Chrome through an extension plus a local daemon,
and because it is a CLI, any agent runtime that can run a shell command gets the
identical capability — Claude Code, Codex, anything else. Work done through a
runtime-specific tool cannot be replayed from a script or from another agent
later, which defeats the reason this Skill has scripts.

Use an existing OpenCLI adapter first. When no adapter exists, use a named
browser session with DOM/network inspection.
</default-driver>

<law id="one-session-one-tab" weight="load-bearing">
<statement>
`opencli browser &lt;session&gt;` is a one-page abstraction. **A session name owns
exactly one tab.** Different names never steal from, switch, or pollute each
other. So N pages need N session names.
</statement>
<why>
This inverts the intuition most people arrive with, which is why it is stated
first. Measured 2026-08-21 under three concurrent agents: distinct session names
produced **zero** cross-agent thefts across 4 rounds × 3 pages; three agents
sharing the name `work` produced 3, 12, and 2 thefts, one of them missing on
every check it made. Re-confirmed the same day against this Skill as written:
three agents told only to follow it scored **36/36 clean with zero leaked
tabs**.
</why>
<correct><![CDATA[
opencli browser recon-sw-notion open "https://..."
opencli browser recon-sw-figma  open "https://..."
opencli browser recon-sem-rival open "https://..."
]]></correct>
</law>

<law id="tools-share-is-a-global-mutex" weight="load-bearing">
<statement>
Unique session names buy you concurrent **tabs**, not concurrent **Tools Share
work**. Every script that goes through `lib-tools-share.mjs` first takes
`yan-tools-share-&lt;tool&gt;.lock` — a **machine-wide mutex, one per tool, shared
across every Claude session on the box**. So at any moment exactly one process
on this machine can drive Semrush, and exactly one can drive Similarweb.
**Dispatching N agents at the same tool does not parallelise it. It builds a
queue with a 600-second timeout at the end.**
</statement>
<why>
Measured 2026-08-28. Three Semrush agents were dispatched in parallel on the
assumption that distinct session names made them independent. They did not run
concurrently: one of them sat waiting **56 minutes** and produced nothing, while
a second machine-local Claude session — working in a different repo entirely —
competed for the same lock. The lock itself is correct and should stay: Tools
Share meters concurrency per account, and a real Chrome is not a real human's
pacing. What was missing is that its **scheduling consequence** lived only in a
code comment, where a planner never reads it.
</why>
<correct><![CDATA[
There are TWO separate limits, and hitting either one looks like "the page is
just sitting there". Respect both.

  (1) This lock — one process per tool per machine, account-level concurrency.
  (2) Tab-load concurrency — measured 2026-08-28: roughly THREE Semrush tabs
      loading at once is enough to break it. That one is not this lock's job.

For (2) the opencli Skill prescribes the opposite of unique session names:
a quota site gets ONE fixed session name with no per-agent suffix, e.g.

  semrush-nav        similarweb-nav

Ten agents handed the same name get queued by the daemon, and the site only
ever sees a single tab paging through. See the opencli Skill's
"配额站：法律 1 的唯一例外". Unique names remain correct everywhere else.

Then serialise the work itself, one agent at a time per tool:
  agent A -> Semrush routes      (holds the semrush lock, start to finish)
  agent B -> Similarweb features (different lock, may still queue behind others)
  agent C -> offline work        (parsers, fixtures, docs — no lock at all)

Before dispatching, check who holds it:
  cat "$TMPDIR"/yan-tools-share-semrush.lock/owner.json   # {"pid":...,"startedAt":...}
  ps -p <pid> -o etime=,command=                          # dead pid = stale lock
]]></correct>
<wrong><![CDATA[
Three agents each told "use session name sweep-1 / sweep-2 / sweep-3, go".
On a quota site the names are NOT fine — distinct names set the concurrency to
the agent count, which is how 19 tm-* tabs ended up loading the same Semrush
report at once on 2026-08-28. And the lock is not fine either: two agents burn
their budget waiting, while a retry loop that re-attempts every 30s makes the
contention worse. The first move when you hit the ceiling is `close`, not
`sleep` — retrying just opens another tab.
]]></wrong>
</law>

<law id="no-multi-tab-api" weight="load-bearing">
<statement>
Do not use `tab new`, `tab select`, or `open --tab` to hold several pages under
one session. All three fail, and every one fails **silently** — the command
reports success and the next read returns the wrong page.
</statement>
<why>
Measured 2026-08-21 on opencli 1.8.6: a session tracks only its newest tab, so
earlier ids drop out of `tab list`; `tab select` returns success with no effect
on reads; `open --tab &lt;id&gt;` opens a **new** tab and leaves the named one
untouched; and `get` does not accept `--tab` at all, so a run using `get url` to
confirm its position cannot be right about it. One three-agent run took the
owner's Chrome from 11 tabs to 30 orphans.
</why>
<instead>
`--tab` works on `open`, `state`, `extract`, `find`, and `click`. When a read
must name its target, use `state --tab &lt;id&gt;`.

**Read this next sentence before you over-correct.** Under
<law-ref id="one-session-one-tab"/> a session owns exactly one page, so there is
nothing to disambiguate and **plain `get url` is safe and is the simplest
confirmation read**. The objection above is only about sessions holding several
pages. Three testers each flagged this as the passage most likely to be
misread — one of them nearly threaded a `--tab` id through the whole job to
obey a rule that did not apply.

<confirm-identity>
The canonical check after every navigation, and the one Law 4 exists to make
possible:
<cmd><![CDATA[
opencli browser "$S" get url    # one page per session: safe
opencli browser "$S" state      # same, plus title + elements (AX snapshot by default)
]]></cmd>
</confirm-identity>
</instead>
</law>

<law id="no-literal-session-name">
<statement>
Never write a literal session name as a default. In JS use
`defaultSession(base)` from `scripts/opencli-core.mjs`; in shell use a
**descriptive constant** (`backlink-probe-cn`, `bing-check-mysite`) — NOT
`$$`. Measured 2026-08-28: in Claude Code's Bash tool every call is a new
process, so `$$` differs each time; one probe produced 14 distinct sessions
and 14 tabs, each abandoning the page the last one opened. `$$` is safe only
inside a single Node process that runs start to finish.

The one exception is a **quota site** (see the quota-site rule below): there
the fixed literal IS the answer, because the session name is what caps
concurrency. `resolveSession(flags, base, siteKey)` handles both cases.
</statement>
<why>
"Another task stole my tab" is never the CLI round-robining — it is always two
tasks that picked the same name. The commonest source is documentation:
`opencli browser --help` opens with `opencli browser work open https://x.com`,
so every agent copying the example lands on `work`. This Skill caused the same
failure itself when `tools-share-open.mjs` defaulted to `backlink-panel`.
</why>
<code><![CDATA[
const session = flags.session ? validateSession(flags.session) : defaultSession('backlink-work');
]]></code>
<subagent-trap>
Subagents inherit the parent's environment, so several agents spawned inside one
conversation resolve to the same default. When fanning browser work across
parallel agents, give each an explicit `--session` or a distinct
`OPENCLI_SESSION_SUFFIX`.
</subagent-trap>
<naming>
Make names **describe the work**: `backlink-probe-&lt;suffix&gt;` beats `bl-1`. The
session name is the primary identifier. With the custom extension build
(PR #2316), the Chrome tab group now shows active session names
(`OpenCLI: session-a, session-b`), making groups distinguishable.
On the stock Web Store extension the group title is still the fixed
`"OpenCLI Browser"`.

**A name needs two distinguishing parts, and it is easy to ship only one.** The
suffix makes your task unique against *other* agents. It does nothing to
separate your own pages from each other, and by
<law-ref id="one-session-one-tab"/> a three-page job needs three names. So one
name reused for all three pages obeys this law's letter and breaks Law 1.
Vary both: `backlink-probe-p1`, `-p2`, `-p3`, each carrying the same
per-task suffix — from `defaultSession()` in JS, or from
`oc_session &lt;base&gt;` in the opencli Skill's own `session.sh` helper in shell.
Both refuse a name ending in 3-6 digits, because that is the shape `$$`
expands to and the failure is otherwise silent: the agent just sees a blank
page every time and retries.
</naming>
<help-text-bait>
`opencli browser --help` opens with `opencli browser work open https://x.com`.
That is the literal collision name this law exists to prevent, printed by the
tool itself, and an agent that consults `--help` for syntax after reading this
law will see the CLI modelling the anti-pattern. Trust the law. The same help
text also shows a trailing `--window background`, which does work but is now
redundant — see <law-ref id="background-by-default"/>.
</help-text-bait>
<cleanup>
Release the lease with `opencli browser &lt;session&gt; close` when done. A session
left open leaves a tab that looks exactly like live work somebody else is doing.

**Verify the close rather than trusting the message.** `close` prints
"Browser session tab lease released" whether or not the tab went with it, and
the native check costs one command — an empty `tab list` means the tab is
actually gone:
<cmd><![CDATA[
opencli browser "$S" close        # -> Browser session tab lease released
opencli browser "$S" tab list     # -> []   (anything else means it survived)
]]></cmd>
Counting tabs in Chrome from the outside cannot answer this while other tasks
are running, because their tabs are in the same count.
</cleanup>
</law>

<law id="claim-handles-first">
<statement>
Open every session you need up front and capture every handle, then start the
work loop. Do not interleave creation with use.
</statement>
<why>
Every driver tested shares one race window: the stretch between creating a page
and holding a stable handle to it. Two independent runs lost pages in exactly
that gap, because a bare `open` with no established handle resolves against
whatever "current" happens to mean at that instant.
</why>
</law>

<law id="background-by-default">
<statement>
Background is the default. Do not override it. `--window foreground` is for the
one case where the person has to finish something by hand; `--window isolated`
keeps automation in a window of its own. The flag, when you do pass one, sits
**between** the session name and the subcommand:
`opencli browser &lt;session&gt; --window isolated &lt;command&gt;`.

Requires the OpenCLI extension at **1.0.32 or newer** (`opencli doctor` prints
it). On older builds the default is foreground and every single command needs
`--window background` spelled out.
</statement>
<why>
Background mode runs the owner's real logged-in Chrome without raising the
window, and opens its tab in the window they are already using. It is **not**
headless — `navigator.webdriver` is `false`, the UA carries no `Headless`,
`plugins.length` is 5. So "background will trip the site's bot defences" is not
a real concern, and there is never a reason to reach for foreground to look more
human.

**Foreground does steal the person's attention, and an earlier version of this
law said otherwise.** That claim rested on one measurement axis — the frontmost
*application*, which foreground genuinely leaves alone. Re-measured 2026-08-23
on the axis that was missing: under `--window foreground` the owner's **active
tab** jumps away mid-task; under background it never moves and the tab count
returns to baseline after `close`. A law that checks one axis and concludes
"no harm" is worse than no law, because it licenses the harm.

If a person reports the screen "jumping around" while everything ran in
background, the cause is several tasks writing to one shared page — that is
<law-ref id="one-session-one-tab"/> being violated.
</why>
<misplaced-flag>
Before the session name it fails with `unknown command: &lt;yoursession&gt;`, which
reads like a broken install rather than a syntax error — check flag position
before reinstalling anything.

**After the subcommand it works.** Re-measured 2026-08-21: `opencli browser s
open URL --window background` succeeds identically to the between form, and the
CLI's own `--help` prints that trailing form as its second example. An earlier
version of this law claimed both positions fail; a tester falsified it in one
command. Prefer the between form for consistency with the rest of this Skill,
and do not treat the trailing form as an error when you meet it in someone
else's script.
</misplaced-flag>
<exception>
Request foreground only when the user explicitly wants to watch, or when the
report itself never hydrates when it loads in a hidden tab — one such report is
measured and named in <law-ref id="hidden-tabs-do-not-hydrate"/>. If a site cannot be
operated without stealing focus, stop and report that constraint.
</exception>
</law>

<law id="hidden-tabs-do-not-hydrate" weight="load-bearing">
<statement>
Visibility gates a report's **first hydration**, not later reads of it. Some
reports render their labels and column headers while hidden but **never fill in
the values** — so a page that was hidden at the moment it loaded stays
structurally complete and value-empty. Once it has hydrated, it keeps its values
in the background: a hidden tab is not by itself a reason to distrust a read.
So: ask for a visible load, but **verify** it by reading
`document.visibilityState` **inside the page at the moment you read the data** —
asking is not getting (see the correction below).
Never trust the `--window` / `windowMode` you passed — it is intent, not fact.
And never report an empty first read as "this domain has no data".

**CORRECTION 2026-08-28: visibility is not a quantity this side controls.** An
earlier version of this law gave a three-step "reproducible recipe" whose third
step — navigate with `location.href` and *keep* the visibility you bought — is
**false**. What was actually measured: a brand-new `launchTool({ ...,
window: 'foreground' })` does read `visible` at the instant it lands; **one
in-page navigation later the same tab reads `hidden`**; and ten minutes after
that it had flipped back to `visible` on its own, with nothing done to it.
Best guess at the mechanism: Chrome reports `hidden` for a window that is
**occluded by another window**, so the value tracks whatever is in front on the
owner's desktop. Nothing in the CLI reaches that.

**CORRECTION 2026-08-29: a foreground attach POISONS the instrument. After one
`--window foreground` attach, that tab's `document.visibilityState` is pinned to
`visible` forever** — losing focus does not change it, and switching to another
tab in the same window does not change it either. The proof is in `&lt;why&gt;`
(Experiment E): a single probe saw two tabs in **one** Chrome window both
reporting `visible` at the same instant, which no real window can do.

~~The consequence is the opposite of everything above: after any foreground
attach, **`vis === 'visible'` carries zero information about occlusion**. A tab
that is genuinely hidden gets recorded as a visible read, and every degradation
that hidden actually causes becomes **invisible to this protocol**.~~
⚠️ **The struck sentence above is the over-claim, corrected below on 2026-08-29
by Experiment F. The pinning is real; "a genuinely hidden tab gets recorded as
visible" is not.** Text kept, not deleted — the wrong inference is part of the
record. What survives unchanged: after a foreground attach, `vis` stops being a
*measurement* of occlusion, so it cannot be used to sample occlusion. Note that
this runs *against* the two effects already on record (foreground cannot flip an
already-hidden tab back; declared `windowMode` has diverged from actual state in
both directions) — it is a third, separate failure of the same instrument.

**CORRECTION 2026-08-29 (later, Experiment F): the pinned tab is not lying about
being visible — it really IS scheduled as visible.** Three neutral sessions in
one Chrome window measured `requestAnimationFrame` frames over 1.5 seconds:

| tab | `vis` | `hasFocus()` | rAF frames / 1.5s |
|---|---|---|---|
| born foreground, since parked behind another tab | `visible` | false | **181** |
| born background | `hidden` | false | **0** |
| the currently active tab | `visible` | true | **181** |

So the pinned tab is animating at full rate. **Whatever it hydrated is real
data, and reads taken on it must not be voided as "contaminated".** The
frozen-looking content that suggested throttling was the *site* converging on
`hasFocus()` / `blur`, not Chrome throttling the tab.

**The criterion that makes both observations true — and it is NOT "is this
session in the foreground right now":**

> **Was this tab CREATED under `OPENCLI_WINDOW=foreground`?**

- **born foreground** → `visible` is pinned for life, **and the tab really is
  scheduled as visible** (181 frames). Its data is valid; only the *label*
  "this was a hidden read" is wrong.
- **born background** → honestly `hidden` for life (0 frames), and a later
  foreground navigation **does not rescue it** — measured, and consistent with
  the already-recorded "foreground cannot flip an already-hidden tab back".

That is why two agents reached opposite conclusions and both were right: one was
probing a tab that had itself been attached (hence two `visible` tabs in one
window), the other was hunting a hidden→visible flip on a born-background tab,
which is honest forever and so never pins. **They were measuring two different
birth cohorts.**

**METHODOLOGY, and it is this law's own principle applied to itself: do not read
the state the page REPORTS, read the behaviour the page PRODUCES.**
`visibilityState` is a **declaration**, and a declaration can be pinned.
An rAF frame count is a **behavioural fact** — 0 frames versus 181 frames cannot
be pinned by an attach. This is the same move as
<law-ref id="readiness-must-bind-to-this-query"/>'s "bind the positive verdict
to a cell the page actually produced": bind to the product, not to the label.
Prefer a behavioural probe wherever a declared field carries the verdict.

**INSTRUMENT CLEANLINESS, self-proving per read — not asserted afterwards.**
This repo has already been burned by its own disguise patch overwriting
`document.hasFocus`, so every visibility read must carry its own proof that the
instrument was clean at that instant:

- read `document.visibilityState` **and**, in the same eval, the native value via
  `Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState').get.call(document)`
  — this bypasses any instance-level override;
- check there is no own-property override on `document` itself;
- check `String(document.hasFocus)` still ends in `[native code]`.

Emit `visOverridden`, `focusNative`, `nativeVis` on **every** read. A read whose
`nativeVis !== vis`, or whose `focusNative` is false, is not a measurement.

**The cure is measured and is still a hard rule of the protocol: a hidden pass
must run on a session that has NEVER been foreground-attached. `closeSession`
and rebuild before every hidden pass, pure background, no exceptions.** After a
close-and-rebuild, `hidden` reads honestly again. **The reason is now the
narrower one:** a born-foreground tab cannot supply a *hidden sample* because it
is genuinely visible — not because its reads are corrupt.

⚠️ **What this does and does not void.** The discoverer voided three of their own
runs — 150 reads labelled `hidden` that were in fact visible reads. Under
Experiment F those reads are **mislabelled, not invalid**: they were real reads
off a really-visible tab, and **the data they collected stands**. They were
reclassified as visible reads and kept, which was the right handling. Do **not**
generalise this to the other voidings of the same week: the ones caused by
**early-stopping** and by **a target that never took effect** are untouched and
still stand. Only the "fake visible contamination" class narrows.

**So the strategy is not "make it visible", it is "only believe the reads taken
while it was visible".** The protocol that has been measured to work:

- **3 navigation rounds** per route, **200 seconds each, run to completion with
  no early stop**, **600 seconds** maximum per route — "patient mode", raised
  from 150s/round after the 100-second floor was falsified;
- a verdict of **`data`** is admissible when `filled > 0`. A verdict of
  **`empty`** is admissible only when three consecutive reads under
  `vis === 'visible'` came back empty **and** the page has emitted a positive
  **end-of-render signal** (paginator, row-count readout, loading indicator
  gone). **A duration is not that signal.** The 100-second floor that an earlier
  version of this law called mandatory was itself falsified on 2026-08-28 —
  five routes it had filed as empty produced data, two only on a second
  re-measure. The floor remains as a backstop on the round, not as grounds for a
  verdict. See <law-ref id="readiness-must-bind-to-this-query"/>, instances 5
  and 6;
- with no end-of-render signal, the verdict is **`inconclusive`** — **never**
  "empty";
- if `visible` never arrived in the whole budget, the verdict is
  **`inconclusive-hidden`** — **never** "empty";
- record `visibilityState` on **every** read, not just the last one;
- **a hidden pass runs on a virgin session.** Any tab **born** under
  `--window foreground` reports `visible` permanently — and is genuinely
  scheduled as visible (Experiment F) — so it cannot supply a hidden sample.
  `closeSession` first, rebuild pure background, then measure. A hidden/visible
  comparison run inside one session is not a comparison at all. **Classify by
  birth window mode, never by "is this session in front right now".**
- **when the verdict rests on visibility, take a behavioural reading too.**
  Count `requestAnimationFrame` frames over ~1.5s in the same eval: **0 frames
  = really throttled-hidden; ~180 frames = really scheduled as visible.** This
  survives the pinning that `visibilityState` does not. And carry the
  cleanliness fields (`nativeVis`, `visOverridden`, `focusNative`) on every
  read, so each read proves its own instrument rather than relying on a claim
  made after the fact.

Three things still do not flip an already-hidden tab back: not the env, not
`open --window foreground`, and least of all `tab select` (details below).
(There is also a read-only trick — redefine `document.visibilityState` to
`visible` inside the page and dispatch `visibilitychange`. Measured as barely
better than nothing; **it is not admissible as the basis of a verdict.** It also
turned out to contaminate a *different* measurement entirely — see the
instrument-contamination lesson in
<law-ref id="readiness-must-bind-to-this-query"/>.)

**And two kinds of empty coexist — do not merge them.** A visibility-induced
fake empty (proven only on `/analytics/traffic/top-pages/`) is cured by a
`visible` read. A **Class A** route appears to have no table at all: zero table
elements under three consecutive `visible` reads, charts only. This law's remedy
applies to the first and is wasted on the second. The table that separates them
is in `&lt;why&gt;`.

⚠️ **Class A was re-measured, and it survives only where a structural criterion
was actually assembled.** Every original Class A verdict was taken under the
same early-stopping criterion that instances 5 and 6 of
<law-ref id="readiness-must-bind-to-this-query"/> demolished. Its shape is
admittedly different — *no table element at all*, rather than a table with zero
rows — but as the operator put it: **"they behave differently, but that is not a
reason to exempt them from the test."** The patient re-run split the ten: four
now carry `no-table-structural` (the page finished, and there is still no table),
two hold strong evidence under an older protocol, and two came back with the
weak `no-table` and stay `pending` — one of them having rendered nothing at all.
The criterion and the verdict names are in
<law-ref id="readiness-must-bind-to-this-query"/>; the per-route split is in the
rankup provider-capabilities reference. **A Class A claim is only usable when it
names `no-table-structural`.**

**And a third kind of empty, found 2026-08-29: not empty at all.**
`/analytics/traffic/behavior/` has no `table` element and publishes its numbers
in lists and bar charts (`YouTube 71.8% 1.5亿 | Facebook 49.36% 1亿 | ...`).
Neither remedy above applies: a visibility retry is wasted on it and a
"no table, therefore no data" reading is simply false. Its verdict name is
**`data-not-in-table`**, defined in
<law-ref id="readiness-must-bind-to-this-query"/>.

**One boundary, because the structural criterion no longer gates on
`vis === 'visible'` and that is easy to over-read.** This law is untouched by
that change. Visibility gates whether **rows hydrate inside a table**
(`top-pages`: 0 cells hidden / 850 visible, three crossing measurements) — that
finding stands exactly as written. It has never been shown to gate whether the
**`table` element exists**, and for that question the page's own chart digits
and export controls are the direct evidence, so a signal that a foreground
attach pins to `visible` forever has no place in it. Structure and values are
two questions; only the second one is this law's.
</statement>
<why>
This is the most dangerous failure shape in this Skill, because it does not look
like a failure. The page "loaded". The structure is all there. Any readiness
check that looks for headings, labels, or "does the table exist" passes on it,
and the parser then honestly reports nulls for a page that simply had not
hydrated.

Two independent experiments, both 2026-08-28, are what pins the law to *first
hydration* rather than to reading:

**Experiment A — flip visibility on a tab that has not hydrated yet.** Controlled
to one variable: same tab, same lid, same node, **no resubmission**, only
`opencli browser &lt;session&gt; tab select` flipping the tab's `visibilityState`:

| tab state | `document.body.innerText` length | summary block |
|---|---|---|
| `hidden` | 549 | labels only, **zero values** |
| `visible` | 1957 | **every value present** |

**Experiment B — go to the background *after* hydration.** Same report line
(.Trends top-pages, canva.com, 2026-07), read once it had already filled in:
with `document.visibilityState === "hidden"` the page **still** yielded 850
non-empty cells. Hiding a hydrated page does not empty it.

Put together: the gate is on the initial fill, not on the read. Which is also
why an early observation of "0 rows on node 5, 850 cells on node 8" was
**retracted** — a later run read the same 850 cells on node 5. There was no node
difference; there was a page read before it hydrated (and, likely compounding
it, several processes contending for the same Semrush session — that run waited
~9 minutes on the global lock). The empty read really happened; it was just
never a fact about the domain.

**Experiment C — same route, controlled on visibility alone (2026-08-28,
reproduced 10 minutes later).** `/analytics/traffic/top-pages/`, node 5, same
session, same lid, same target domain, same month; the single variable is
`document.visibilityState` at the moment of the read:

| condition | `visibilityState` | non-empty cells | `innerText` |
|---|---|---|---|
| straight after a foreground **fresh launch** | `visible` | **850** | 6861 |
| **reused** an existing session, no relaunch | `hidden` | **0** | 328 |
| `close` the session → foreground **fresh launch** | `visible` | **850** | 6861 |

This is a harder control than Experiments A and B: one route, one session, one
variable.

**Experiment D — visibility flips by itself, in both directions (2026-08-28,
same agent, after Experiment C).** This is the observation that killed the old
recipe. Same session, nothing done to the tab between the reads:

| moment | `visibilityState` |
|---|---|
| the instant a fresh `window: 'foreground'` launch lands | `visible` |
| **after one in-page `location.href` navigation** | `hidden` |
| ~10 minutes later, untouched | `visible` again |

So `visible` is not a state you acquire and hold; it is a property of the
owner's desktop at that instant — most plausibly Chrome reporting `hidden` for
an **occluded** window. It follows that no sequence of CLI commands can
guarantee it, and any protocol that assumes it can is wrong. What *is* available
is the read's own `visibilityState`, sampled in the same eval as the data —
which is why the admissible-verdict rules in the statement are written around
waiting for a `visible` read rather than around producing one.

**Experiment E — one foreground attach pins `visibilityState` to `visible` for
the life of the tab (2026-08-29).** This is the one that undermines the whole
protocol above, so read the control first.

The control is not a time series, it is an **impossibility**: a single direct
probe of Chrome window `379229828` saw **two tabs in that same window both
reporting `visible` at the same instant** — `sw-vis-parker`
(`visible`, `focus=true`) and `similarweb-nav` (`visible`, `focus=false`).
**One window cannot have two active tabs, so at least one of those two
`visible` values is not a measurement.** The one with `focus=false` is the
poisoned one, and it had been foreground-attached earlier.

The trace behind it, same tab, nothing done to it except parking another tab in
front:

| read | vis | `hasFocus()` | what it means |
|---|---|---|---|
| #0 | visible | **true** | honest — the tab really was in front |
| #5–12 | visible | false | focus already lost, `vis` did not move |
| — | — | — | **parked**: `example.com` opened in front, same window |
| #13–39 | **visible** | false | 27 reads / ~18s, content frozen at `mainLen=47027` |

`hasFocus()` moved. `visibilityState` did not. It never moves again. So after a
foreground attach the field is a constant and stops being a measurement of
occlusion. ~~**Any degradation caused by being hidden is structurally invisible
to a protocol that gates on it** — the degraded read is filed as a `visible`
read and inherits its authority.~~ ⚠️ **Struck: that inference was falsified by
Experiment F below.** There was no degradation to hide — the pinned tab is
scheduled as visible for real. The "frozen content" in the last row above is
`example.com` sitting in front while the site itself converged on
`hasFocus()`/`blur`; it is not Chrome throttling the tab.

**Experiment F — the pinned tab is really visible, measured behaviourally
(2026-08-29, three neutral sessions, one Chrome window, `example.com`).** Every
read carried its own cleanliness proof rather than a claim made afterwards: it
sampled `document.visibilityState`, **and in the same eval** the native value
through
`Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState').get.call(document)`
(bypassing any instance-level override), checked `document` for an own-property
override, and checked `String(document.hasFocus)` for `[native code]`. All reads
came back `visOverridden:false`, `focusNative:true`, `nativeVis === vis`.

The phenomenon reproduced exactly as Experiment E had it: two tabs in the same
window both `visible`; the born-foreground tab held `visible` across **92
seconds** after losing tab activation while `hasFocus()` honestly read `false`;
Chrome's own tab metadata said `active:false` while the page said `visible`.

Then the behavioural probe — `requestAnimationFrame` frames over 1.5s:

| tab | vis | focus | rAF frames |
|---|---|---|---|
| born foreground, parked | visible | false | **181** |
| born background | hidden | false | **0** |
| currently active tab | visible | true | **181** |

**181 frames is full-rate scheduling.** The pinned tab is not misreporting its
class; it is in the visible class. The correction that follows is therefore not
"the instrument lies harder" but "the instrument reports a *sticky* class, and
the class it sticks to is the true one at birth":

- **born under `foreground`** → pinned `visible`, genuinely scheduled visible;
- **born under `background`** → honest `hidden`, 0 frames, and a later
  foreground navigation does **not** rescue it (measured; consistent with the
  three non-repairs listed further down).

**Why two agents disagreed.** The session that reported the pinning
(`sw-vis-parker`) had itself been foreground-attached, which is why it and
`similarweb-nav` were both `visible`. The session that could not reproduce it
was looking for a hidden→visible flip on a born-background tab, which never
pins. Both observations were sound; they were taken on different birth cohorts.
Two agents contradicting each other on an instrument question usually means an
uncontrolled variable, not that one of them is careless — find the variable.

**The transferable lesson: read behaviour, not self-report.** `visibilityState`
is a **declaration** that an attach can pin. An rAF frame count is a
**behavioural fact** that it cannot. This is the same principle
<law-ref id="readiness-must-bind-to-this-query"/> states for readiness — bind the
verdict to something the page actually **produced** (a non-empty cell, a frame),
never to something it merely **says** about itself.

Note how this sits against the two effects already recorded above: foreground
**cannot** flip an already-hidden tab back to visible, and the declared
`windowMode` has disagreed with the real state in **both** directions. This
third effect points the other way again — foreground does not change the tab, it
changes the *reporting*. Three separate ways for the same instrument to lie;
none of them cancels the others.

**Cure, measured:** `closeSession`, then reopen the tab **pure background**,
never foreground-attached. `hidden` reads honestly again. This is why the
statement's protocol now requires a virgin session for every hidden pass.

**Consequence for work already filed.** The discoverer voided **three of their
own runs on this basis — 150 reads labelled `hidden` that were really visible
reads.** They were **reclassified as visible reads, not deleted**; a voided
observation with its reason attached is evidence about the instrument, and
erasing it would hide exactly the failure this entry exists to record.
⚠️ **Narrowed 2026-08-29 by Experiment F: the reclassification was right, the
word "void" was too strong.** Those 150 reads came off a tab that was really
being scheduled as visible, so **the data they captured is valid**; only the
`hidden` label on them was false. Re-label, keep the numbers, and do not re-run
them as if they had measured nothing. This narrowing is **specific to the
fake-visible class** — voidings caused by early-stopping
(<law-ref id="readiness-must-bind-to-this-query"/>, instances 5 and 6) and by a
target that never took effect are unaffected and still stand.

**The mechanism, finally named.** Clicking a panel card is what raises Chrome to
the foreground. `scripts/lib-tools-share.mjs` `launchTool` has a fast path that
**reuses a session already parked on the tool origin** — and that path does not
click a card, so it never raises the window. The tab stays `hidden`, and every
report opened from it afterwards hydrates half-way. Which is why
`DEFAULT_WINDOW = 'foreground'` in `scripts/semrush-traffic.mjs` is **not enough
on its own**: it only takes effect when the full launch flow runs, and the reuse
fast path walks around it. The fast path now samples `document.visibilityState`
in the same eval it was already doing, and when a `foreground` caller finds a
`hidden` tab it closes the session and takes the full launch instead
(`reuseDecision` / `attemptToolSessionReuse`, covered by
`tests/tools-share-reuse-visibility.test.mjs`).

**Three things that were measured and do NOT work — do not retry them:**

- `OPENCLI_WINDOW=foreground` in the environment **cannot** flip an
  already-hidden tab back to visible.
- `opencli browser &lt;s&gt; open &lt;url&gt; --window foreground` **cannot** either: the
  re-read came back `visibility=hidden`, `len=59` — emptier than before.
- `opencli browser &lt;s&gt; tab select` is not merely useless here; it is the
  **prime suspect for turning a visible tab hidden**. See opencli SKILL.md law 2,
  "`tab select` silently fails".

These three are the durable half of the old recipe: they have not flipped back
under any re-measurement, and they are the reason "just ask for foreground
again" is not a repair. Re-running any of them is wasted time.

**Two different kinds of empty coexist here. Do not merge them.** An earlier
version of this law (and of the rankup Skill's provider-capabilities reference)
implied every empty or missing table might be a hydration artefact. Measurement 2026-08-28 says there are two
distinct phenomena with different judgements:

| phenomenon | test that separates them | what was measured |
|---|---|---|
| **visibility-induced fake empty** | same route reads 0 while `hidden` and full while `visible` | only on the **table-heavy** page `/analytics/traffic/top-pages/`: **0 cells hidden / 850 cells visible**, cross-checked three times |
| **Class A — there was never a table** | three consecutive reads under `visible` still find **zero table elements** | `referral` / `organic-search` / `paid-search` / `organic-social`: 50–57 `svg` nodes, **0 table elements**, `innerText` 1094–1310 chars — **identical** to what the same routes gave while `hidden` |

**Class A was believed not to be a hydration cross-section — that belief is back
under test.** There was a hypothesis on record: "the charts render first and the
table hydrates after, so a hidden tab is frozen mid-way and just happens to look
like Class A". It was marked falsified because three consecutive `visible` reads
returned the same chart-only shape. **That refutation used the early-stopping
criterion**, so it is worth exactly what the eight `empty-silent` verdicts turned
out to be worth. The ten Class A routes are being re-measured under patient mode
(`referral` / `organic-search` / `paid-search` / `organic-social` /
`socioeconomics` first). **Read everything below about Class A as provisional
until that returns.**

These four routes simply **serve charts, not tables**, and the charts carry real
canva.com magnitudes (organic-search axis to 150M, referral 60M, organic-social
30M, paid-search 1.5M). **The data exists; the extraction shape is a chart, not
a table.** So a Class A route needs a chart reader — never a "no data" verdict,
and never a visibility retry loop either, because visibility is not what is
wrong with it.

**And do not trust the mode name you passed.** The `windowMode` a script hands
to opencli and the tab's actual `visibilityState` **disagree in practice**: in
these runs the invocation labelled `background` read `visible`, and the one
labelled `foreground` read `hidden`. The mode is an intent; the only admissible
record is `document.visibilityState` sampled inside the page at read time. Any
conclusion filed under "this was a background run" is unsound until re-measured
that way.

The parsing layer was never at fault: feeding the foreground `innerText` into
`semrush-traffic.mjs`'s own `parseTrafficSummary` produced all 15 fields with
zero tolerance (visits 790000000, desktop 84.26 + mobile 15.74 = 100.00, `↓`
correctly negative, `11:02` → 662s). Only the driver layer was broken, and it
was broken by a **default** — `launchTool` defaults to background, the script
passed `window: flags.window`, and with no `--window` that resolved to
`undefined` → background. So the script's default invocation asked for the
report to load out of sight, which is exactly the moment that matters.

`DEFAULT_WINDOW = 'foreground'` in `scripts/semrush-traffic.mjs` **remains the
right fix** and should not be reverted. Read it for what it now is: it buys
visibility *at the instant of first hydration*, not for the lifetime of the
read. It is also a request, not a guarantee — see the `windowMode` caveat above —
which is why the check below samples `visibilityState` from inside the page
instead of trusting the flag.
</why>
<scope>
**Read this range statement before you invoke the law — or before you use it as
an excuse.** The visibility-induced fake empty is a **Semrush Traffic &amp; Market
(.Trends) heavy-table** phenomenon. It is **confirmed absent on the Similarweb
panel** (positive control, below): that SPA hydrates in hidden tabs, so on
Similarweb "I read empty" may **not** be explained away as a visibility
artefact. Every other surface is **unmeasured** — neither affected nor exempt.
Measure it and write the result here; do not extend the law by analogy, and do
not dismiss it by analogy either.

**Confirmed affected — first hydration only:** the Semrush Traffic &amp; Market
(.Trends) traffic-overview summary block, when it *loads* while hidden.
`scripts/semrush-traffic.mjs` therefore defaults to `--window foreground`; that
is a per-report property, not a global one, and it protects the load, not the
read.

**Confirmed affected — the reuse fast path in `scripts/lib-tools-share.mjs`.**
It hands back a `hidden` tab to a caller that explicitly asked for
`foreground`, which is Experiment C's middle row. Fixed by probing visibility
inside the existing reuse eval and declining the reuse; the decline costs at
most one extra `close` + launch, happens at most once per `launchTool` call, and
does not recurse.

**Confirmed affected — `/analytics/traffic/top-pages/`.** The one route where
the visibility-induced fake empty is proven: 0 non-empty cells while `hidden`,
850 while `visible`, three crossing measurements. Treat an empty read there as
`inconclusive-hidden` until a `visible` read confirms it.

**Provisionally NOT affected — the Class A routes, re-measure pending.**
`referral`, `organic-search`, `paid-search`, `organic-social` returned **zero
table elements under `visible`, three reads running**, byte-for-byte the same
shape they return while `hidden` — but those reads were taken under the
early-stopping criterion, so the finding is **not confirmed**. All ten Class A
routes are being re-run under patient mode. The working reading stays "they
publish charts only, and the numbers are in the chart", and it is not yet a fact
to file conclusions against.

**Confirmed NOT affected — the whole Similarweb panel (positive control,
2026-08-28).** This is the first *experiment* on the question rather than an
inference. Control route `#/digitalsuite/websiteanalysis/home` was read under
`vis=hidden` across **4 runs and 900+ reads** and returned **complete content
every single time** — `mainLen=445 / bodyLen=745`, stable, no degraded variant.
**This SPA renders hidden tabs exactly like visible ones.** The consequence is
the useful half: on Similarweb an empty read has to be judged on its own
evidence, because the hidden-tab excuse is not available there. This supersedes
in strength — it does not merely repeat — the older negative evidence that the
Similarweb query script "has been getting numbers in background mode for as long
as it has existed"; absence of trouble is weaker than a measured control.

**Confirmed NOT affected — Similarweb's HEAVY-TABLE pages, upgraded from
panel-level on 2026-08-29.** The gap the control above left open — "the control
page was light; the heavy tables were never paired" — is now closed for **three
page types**, measured as **5 hidden/visible pairs** across 3 page types × 2
domains (one large, one small), ~160 honest hidden reads and ~130 visible reads.
Every pair matched **byte for byte**, save one 34-character relative timestamp
of the "x minutes ago" kind; identical table counts, column counts and row
counts throughout:

| page | domain | hidden | visible |
|---|---|---|---|
| keyword research `website-keyword-v2` | canva.com | `12546 / 1 table / 19 cols / 100 rows` | **identical** |
| keyword research | creem.io | `13518 / 1 table / 19 cols / 100 rows` | **identical** |
| backlinks `backlinks/table/999` | canva.com | `46993 / 2 tables / 8 cols / 100 rows` | `47027` — timestamp only |
| backlinks | creem.io | `18144 / 2 tables / 8 cols / 100 rows` | `18178` — timestamp only |
| site ranking `mapping/...` | canva.com | `7170 / 3 tables / 12 cols / 12 rows` | **identical** |

**What makes this stronger than the original control, precisely:** the original
control had **no paired visible read at all**, so its `mainLen=445` was never
shown to be a *complete* page — only a *stable* one, and stability is not
completion (that is the whole of
<law-ref id="readiness-must-bind-to-this-query"/>). These 5 pairs supply the
missing half.

⚠️ **Do not widen this to "all Similarweb heavy tables".** It covers **the three
page types actually measured**. The **10,000-domain / 14-column league table was
never found**, so it was never tested: `ranking`, `websites`, `topsites` and
`leaders` all silently redirect to `#/digitalsuite/ai-brand-visibility/home`.

**Pending re-check, NOT a conclusion — the `445` coincidence.** The original
control recorded `mainLen=445`; the unknown-route fallback page
`#/digitalsuite/ai-brand-visibility/home` measures `bodyLen=445`. **Different
metrics, so this is not evidence**, and the observer said so themselves. But
before `445` is trusted as "the complete website-analysis home page", it is
worth one look at whether that original measurement was taken on the redirect
fallback. **This does not touch the upgrade above**, which rests on its own 5
pairs and does not depend on `445`.

**Confirmed NOT affected:** reads of an *already hydrated* .Trends page — the
same top-pages report handed back 850 non-empty cells with
`visibilityState === "hidden"`. And `scripts/semrush-report.mjs` and
`scripts/similarweb-query.mjs` have been pulling real numbers in background mode
for as long as they have existed. So do **not** change the shared default in
`scripts/lib-tools-share.mjs` — that would send every script racing for the
foreground window and steal the owner's active tab, which is exactly what
<law-ref id="background-by-default"/> exists to prevent.

**Confirmed NOT affected — page LOAD itself, on a tab measured at 0 rAF frames
(2026-08-29, Experiment F).** A `-b` (pure background) launch **completed its
page load** while the tab was scheduled at **zero animation frames**. That is an
independent line of evidence for "hidden can hydrate", resting on nothing the
Similarweb 5 pairs rest on: it is a behavioural measurement of the tab itself
rather than a hidden/visible content comparison, so the two do not share a
failure mode. It also sets the boundary from the other side — throttled-hidden
still loads, so "0 frames" is a fact about scheduling, not a licence to write
"the page never loaded".

**Unmeasured:** whether visibility can be *made* deterministic at all from this
side — the flip-flop of Experiment D was observed, not explained, and the
occlusion mechanism is a guess. Also unmeasured: whether any *other* report shares the .Trends behaviour; and how
often `windowMode` diverges from the real `visibilityState`, since both
directions of that mismatch have now been seen but the mechanism has not been
traced. Also unmeasured: how much of a stale empty read is hydration versus
contention when several processes hold the same Semrush session (one such run
waited ~9 minutes on the global lock). Treat a new empty-but-structured report
as a candidate, measure it, record the sampled `visibilityState` alongside the
result, and write the finding here rather than assuming either way.
</scope>
<correct><![CDATA[
# 1. the value-bearing region is empty — do not conclude "no data" yet.
#    sample visibility FROM THE PAGE; the --window you passed is not evidence.
opencli browser "$S" eval '(() => JSON.stringify({
  visibility: document.visibilityState,
  len: (document.body.innerText || "").length,
  // instrument cleanliness, proven PER READ, not asserted afterwards:
  nativeVis: Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState")
               .get.call(document),
  visOverridden: Object.prototype.hasOwnProperty.call(document, "visibilityState"),
  focusNative: /\[native code\]/.test(String(document.hasFocus)),
  focus: document.hasFocus(),
}))()'
# -> {"visibility":"hidden","len":549,"nativeVis":"hidden",
#     "visOverridden":false,"focusNative":true,"focus":false}
# nativeVis !== visibility, or focusNative false => NOT a measurement. Discard.

# 1b. When the verdict hangs on visibility, add the BEHAVIOURAL probe. A
#     foreground attach pins `visibilityState` for the life of the tab, so the
#     field is a declaration; the frame rate is a fact.
opencli browser "$S" eval '(async () => { let n = 0; const t0 = performance.now();
  await new Promise(r => { const f = () => { n++;
    performance.now() - t0 < 1500 ? requestAnimationFrame(f) : r(); };
    requestAnimationFrame(f); setTimeout(r, 2500); });
  return JSON.stringify({ frames: n, vis: document.visibilityState }); })()'
# -> ~180 frames => genuinely scheduled visible (even if focus is false)
# ->    0 frames => genuinely throttled-hidden
# Classify by the tab's BIRTH window mode, never by "is this session in front
# right now": born foreground => pinned visible AND really visible; born
# background => honestly hidden forever, and a later foreground nav does not
# rescue it.

# 2. hidden AND empty -> you have NO verdict yet. Keep re-reading (<=3 nav
#    rounds x 100s of polling) until either filled>0, or three consecutive
#    reads under visibility==="visible" agree it is empty. You cannot force
#    "visible" - you can only wait for it and record which reads had it.
#
# 2b. POLL EVERY 600-700ms INSIDE THE ROUND. Not 6 seconds. Measured 2026-08-28
#    on Similarweb: across 1400+ reads only SIX came back "visible", because
#    another agent's tab held Chrome's active tab for the whole run (one run was
#    worse - the session was closed out from under it and the log shows
#    "No active session"). "visible" arrives as a ~3-SECOND PULSE, so a 6s poll
#    misses it almost every time and the route lands on "inconclusive-hidden"
#    for a reason that has nothing to do with the route. 600-700ms is the only
#    cadence measured to actually capture visible reads. It does not shorten the
#    round or license an earlier verdict - it samples the same wait more densely.
#    Corollary for the "three consecutive visible reads" rule: at 600-700ms a
#    single ~3s pulse can hold all three, which is what makes that rule
#    reachable at all. Three visible reads taken in three DIFFERENT pulses (or
#    three different sessions) are cross-window evidence and do NOT satisfy it.
node scripts/semrush-traffic.mjs --domain canva.com --window foreground
# -> a read that came back visible with len 1957 and all 15 fields => real data
# -> never saw "visible" in the budget => status "inconclusive-hidden"
# -> three visible reads AND >=100s elapsed, still empty => admissible "empty".
#    Three visible reads in 18s is NOT admissible: the table renders last.

# 3. empty under THREE consecutive visible reads, with 0 table elements and
#    only svg? That is Class A: the route serves charts, not tables. Read the
#    chart. Do not retry for visibility, and do not write "no data".
]]></correct>
<wrong><![CDATA[
# readiness judged by structure only: passes on a page with no values in it
const ready = /摘要|Summary/.test(bodyText) && document.querySelector('table');

# and then the empty read gets written down as a fact about the domain
{ "visits": null, "status": "unavailable",
  "note": "canva.com has no .Trends data" }   # FALSE — the tab was hidden

# throwing away good numbers because the tab's `visible` was pinned
if (sessionWasForegroundAttached) discard(readings);   // FALSE
# The tab was born foreground: it is pinned visible AND really scheduled visible
# (181 rAF frames). The readings are valid; only the "hidden read" LABEL is
# wrong. Re-label them, keep the data. (Voidings from early-stopping or from a
# target that never took effect are a different class and still stand.)

# deciding hidden-vs-visible from what the page SAYS instead of what it DOES
const reallyHidden = (document.visibilityState === 'hidden');   // pinnable
# and deciding it from the session's current foreground-ness, which is not the
# variable either — the variable is the window mode the tab was BORN under.

# treating a chart-only route as a hydration problem and retrying forever
for (let i = 0; i < 20; i++) await relaunchForeground('/analytics/traffic/referral/');
# FALSE — three visible reads already agreed: 0 table elements. It has no table.
]]></wrong>
</law>
<law id="readiness-must-bind-to-this-query" weight="load-bearing">
<statement>
A readiness check and a target check must bind to **something this query
produced**. Any criterion of the shape "the page contains X" is unsound until
you have answered one question about it: **could X have been supplied by
something other than this query?** Marketing copy, decorative chrome, a
neighbouring tool's widget docked at the bottom of the panel, and a saved-list
picker full of account history are all "on the page", and none of them is your
result.

The criterion that has survived every instance so far is **"a table on this page
holds at least one non-empty cell"** — `filledCells > 0`. Skeleton rows, column
headers, prose and svg cannot satisfy it.

**CORRECTION 2026-08-29 — that criterion is sound in one direction only, and it
was being read in both.** `filledCells > 0` proves data arrived.
`filledCells === 0` proves **nothing about data**; the most it can ever support
is the much narrower claim **"no table-shaped data"**. The assumption nobody
wrote down was **"data means a table"**, and one route falsifies it outright:
`/analytics/traffic/behavior/` has **no `table` element anywhere**, and the
numbers are sitting in the DOM text regardless —

> `YouTube 71.8% 1.5亿 | Facebook 49.36% 1亿 | Instagram 48.61% | Reddit 33.71% | TikTok 28.06%`

— plus interest and device splits, presented as **lists and bar charts**. Scored
by non-empty cells it reads **0**, and the correct verdict is emphatically not
"no data". So a third verdict name joins the two in the table below:
**`data-not-in-table`**.

**The supplement is NOT "there are digits on the page".** That is instance 1
verbatim — it matched a neighbouring widget's `axa.fr / 42 / 758 / 15%` — and
re-adopting it to cover this blind spot would trade a false negative for the
worst false positive on record. Nor is there a safe *generic* repair, and the
reason is worth stating precisely: what makes a filled `td` trustworthy is that
`td` is a **structural membership claim** — the cell is part of a table, and the
report region owns its tables. A `div` holding `71.8%` makes no such claim; in
the DOM it is indistinguishable from a foreign widget's `div` holding `15%`.
**The anchor a table supplies for free has to be supplied by hand for every
other presentation shape.**

So the honest conclusion is the narrow one: **there is no safe general positive
criterion for non-table data. Each route must declare its presentation shape and
its own anchor labels before anyone can read it.** The check's *shape*
generalises; its *anchors* never do:

- record **`presentationShape`** per route — `table` / `list` / `bar-chart` /
  `card` — as a measured field, never a guess;
- a non-table route must also declare **the dimension labels it owns** (for
  `behavior`: 社交媒体 / 兴趣度 / 设备). Those come from the route's own
  navigation, decided *before* the read — not harvested from the page you are
  about to judge, which would be the same circularity as instance 2;
- the positive read is then **a value inside the subtree of a declared label**,
  never a value found "on the page". Every foreign widget is outside every one
  of those subtrees, which is exactly the property the body-wide scan threw away;
- `anchoredValues > 0` is admissible exactly as `filledCells > 0` is — and
  `anchoredValues === 0` is admissible exactly as little. Absence still has to
  be proven the structural way, below.

A **target** check needs both halves: a positive condition (the target's own
identifier is present) **and** a negative one (no marker of the empty-state
landing page — e.g. a "create a new list" control). The positive half alone is
satisfiable by the very picker that lists your target as a *previously saved*
item.

**The same question applies to a negative verdict, and there it is harder to
see.** "I read empty N times in a row, so it is empty" is the same mistake
wearing repetition as a disguise: a region that has not begun rendering yet is
*perfectly* stable. **Stable is not finished.**

**And the first repair for that was itself wrong, in exactly the same shape.**
Bolting a minimum elapsed-time floor under the stability check — 100 seconds,
written into this law on 2026-08-28 — was falsified the same day: five routes
that the floor had filed as empty all produced data once the wait grew, and two
of them only on a **second** re-measure. The floor is not the fix, because **a
floor is not a criterion, it is a bet on a threshold**, and the threshold moves
with the page, the target and the machine load. Every rule of the shape *waited
long enough and still empty, therefore empty* is that same bet at a different
number. 600 seconds is today's number; it is an operating value, not a
guarantee, and the next slow table will retire it too.

So the rule is not a bigger number. It is:

- **"Empty" is provisional by default**, and elapsed time never promotes it.
- An empty verdict is admissible only when it is bound to a **positive "this
  page has finished rendering" signal** — a paginator, a row-count readout, a
  loading indicator that has *gone away*, any control that exists only once the
  data has landed. Such a signal is a product of this query in the same way a
  filled cell is; a duration is not.
- **With no such signal available, the verdict is `inconclusive`, never
  `empty`.** Those two words mean entirely different things to everything
  downstream, and this repo's standing rule is to fail explicitly rather than
  quietly.
- **Time floors stay — as a backstop, not as a criterion.** They bound how long
  a round is allowed to run and stop an early read from being believed. They
  never license a verdict on their own.

**There is one absence that *can* be proven, and it is proven the same way.**
"This route has no table at all" is a different claim from "this table is
empty", and it has a sound criterion — first run in anger on 2026-08-29, written
out in full in `&lt;correct&gt;`. Its shape: **the rest of the page is demonstrably
finished, and there is still no table element in it.** Four conditions, all
four, on two consecutive reads. Condition one on its own — no `table` element
anywhere — **proves nothing whatsoever**, because a page that has not started
rendering has no table element either. The load-bearing conditions are the ones
that supply *independent evidence that the rest of the page finished*: hydrated
chart text and the section's own export controls. Only with those in hand does
"no table" stop being a snapshot and become a fact.

**Name the strong verdict and the weak one differently, and never let the weak
one be read as a result.**

| verdict | what it means | admissible |
|---|---|---|
| `no-table-structural` | all conditions held, twice running | **yes** — this route has no table |
| `data-not-in-table` | no table, but values were read under the route's own declared anchors | **yes** — this route has data, in another shape |
| `no-table` | the whole patience budget ran out with no table, structural conditions never assembled | **no** — file it `pending`, it is `inconclusive` wearing a better name |

**`no-table-structural` and `data-not-in-table` are not alternatives to check in
order — check the second one first.** "This route has no table" and "this route
has no data" are different sentences, and the only route that has ever needed
the distinction, `behavior`, is the one where getting it backwards costs a real
capability.

The two routes that landed in the weak tier are the argument for the split:
`paid-search` finished with `chart=0 / exp=6` (the chart numbers never
rendered), and `behavior` with `chart=0 / exp=0` — **nothing on that page
rendered at all**, which is to say nothing was measured. Filing either as
"this route serves charts, not tables" would have been the old mistake with a
new label.

**CORRECTION 2026-08-29, same day, later — the structural criterion had a fifth
condition, `vis === 'visible'`, and it is removed.** It was inherited from
<law-ref id="hidden-tabs-do-not-hydrate"/>, where visibility is a genuine
confounder on *value fill*. It does not belong here, for two independent
reasons.

1. **It is not bound to anything this query produced** — this law's own test, and
   the same test that retired the 100-second floor. `document.visibilityState`
   is a fact about the owner's desktop. `chartHydrated >= 3` and
   `exportBtns >= 1` are facts about *the page*, and they measure the very thing
   visibility was standing in for: whether the render pipeline finished.
   **When the effect is directly observable, the proxy adds nothing.** Here it
   adds less than nothing, because these routes render summary → charts →
   table with **the table last**: hydrated chart digits witness that the
   pipeline reached *the stage immediately before the table*, which is precisely
   the evidence a "no table" claim needs. `visible` never carried that and
   cannot be made to.
2. **The signal lies, and it lies in the direction that grants authority.**
   Experiment E: one foreground attach pins `visibilityState` to `visible` for
   the life of the tab. So on any foreground-attached session the condition is
   **vacuously true** — it filters nothing while looking like the strictest term
   in the conjunction — and on an honest, never-foregrounded session it can be
   **false while the page is fully rendered**, throwing away a sound structural
   verdict. A predicate that is automatically true wherever it is a lie and
   sometimes false wherever it is honest is worse than no predicate at all. This
   one managed to be both lax and over-strict, each in the wrong place.

**What is kept — and why the other half of condition 4 is not open to the same
argument.** `onTarget` — the target's own identifier present **and** no
empty-state marker — is a fact this query produced, and instance 4 is what
happens without it: a silent fallback to the empty-state landing page read
`0 rows / no table / innerText 353`, a flawless `noTable === true`. **Condition 1
is satisfied most perfectly by a page that is not your report at all.**
`onTarget` therefore stays mandatory, and so does recording `listPickerVisible`
and the account initial beside it.

**`vis` keeps being recorded and stops being a gate.** Write
`visibilityStateAtVerdict` next to every structural verdict — with `hasFocus()`
beside it as the independent cross-check — as evidence *about the instrument*.
Never let a verdict turn on it.

**What this changes for work already filed. Three separate things; do not merge
them.**

- The **four `no-table-structural` routes** (`organic-social` 30/5,
  `paid-social` 34/5, `email` 23/4, `display-ads` 29/4) were confirmed with a
  `vis` that may well have been a poisoned constant. Under the revised criterion
  `vis` was never load-bearing, so **those four verdicts survive intact** —
  they rest on chart digits and export controls, which are page output.
- The **`strong-but-different-protocol` pair** — `referral` at 98 `visible`
  reads, `organic-search` at 96 — is the case this reprieve is most likely to be
  misread as covering. `scripts/semrush-traffic.mjs` carries
  `DEFAULT_WINDOW = 'foreground'`, so all 194 of those `visible` labels are
  suspect and **as evidence about visibility they are void**. But they were
  never evidence about visibility: they are 194 observations of **zero table
  elements**, and that is a DOM fact the poisoning does not reach. Their status
  therefore neither improves nor worsens — still inadmissible, for the reason
  already on their record (**`chartHydrated` and `exportBtns` were never
  sampled**) and no longer for any visibility reason. Re-measure the two
  structural fields; do not re-measure the visibility.
- The **`v4-visible-gated` protocol** was visibility-gated end to end, and its
  *empty* verdicts stay void on instance 6's grounds. Dropping `vis` from the
  structural criterion rehabilitates **not one** `empty-silent` verdict.

**CORRECTION 2026-08-29, later still — four unwritten assumptions inside this
law's own criteria, two of them in its load-bearing conditions.** The criteria
now live as executable, testable code in
<ref file="scripts/lib-report-readiness.mjs"/>; the block below is the same code,
and the tests in `tests/report-readiness.test.mjs` go red if either is repaired
without the other.

1. **`exportBtns >= 1` was never bound to this report section**, and neither was
   **`chartHydrated >= 3`**. Both scan everything under `main`. That is
   instances 1 and 2 in the load-bearing conditions of the criterion written to
   prevent instances 1 and 2. The counter-example is in this Skill's own notes:
   `daily-trends` renders **one 导出 control per channel name** in the body, so
   an export button may belong to the global toolbar or to a neighbouring
   section and carries no necessary claim about *this* section. And the axa.fr
   widget is `42 / 758 / 15%` — **three digits, the whole threshold, from a
   foreign tool** — if it happens to be drawn as svg.
   **The repair is to bind both to the report region's own subtree, and where
   that subtree's root is has never been measured.** So this round changes
   nothing but the shape: the scope root is now a **parameter**, its default is
   still `main`, and every probe output carries `scopeSelector`,
   `scopeResolved` and **`scopeIsUnverifiedDefault`**. Read the last one as
   *this verdict was taken under an assumption, not under a measurement*.
   ⚠️ **`main` is a DOM convention, not a finding. Do not swap in a guessed
   selector** — that is how the previous unverified debt was incurred. What to
   collect on the live page is listed in `&lt;scope&gt;` below.
2. **`spinnerGone` is retired as a gate.** `!root.querySelector('[class*="skeleton" i],
   [class*="spinner" i]')` is a **negative criterion built on guessed vendor
   class names**: rename the class and it is permanently true, so a page that
   never began rendering reports "the loading indicator has gone away". That is
   an **unfalsifiable positive signal** — precisely what this law forbids where
   it demands a positive end-of-render signal — and it is the same shape as the
   `vis === 'visible'` condition removed hours earlier: automatically true
   wherever it lies, and capable of being false wherever it is honest (one
   decorative `class="spinner-icon"` elsewhere on a finished page would block a
   sound verdict forever). It is split: **`[aria-busy="true"]` is a standard
   ARIA attribute — the page asserting about itself — and survives as a VETO
   only** (busy ⇒ not finished; not-busy proves nothing). The two class-name
   guesses become **recorded evidence that gates nothing**, alongside `vis`.
3. **The negative half of `onTarget` was a Chinese string literal.** One shared
   account, an English UI on some node, and `Create a new list` does not match
   `创建新列表`: `ok` is `true` **on the empty-state landing page**, which is
   instance 4 reproduced with no changes at all. Listing both languages is only
   one fewer trip over the same wire, because the deeper fault is that **"marker
   absent" was read as "not the empty state"** — an unfalsifiable negative, the
   very disease. So markers are **declared per locale**, the page's own locale is
   read from `&lt;html lang&gt;` or from the vendor's own path segment
   (`dash.3ue.co/zh-Hans/` — both are page output, neither is a guessed
   selector), and the verdict is three-valued: `yes` / `no` / **`unknown`**.
   A locale we hold no markers for yields `unknown` and `ok: false`. The way
   into a new locale is **to measure its empty-state page and add its marker**,
   never to let the criterion pass by default.
   **A purely structural empty-state marker would be better and does not yet
   exist** — nobody has recorded the empty-state page's DOM. That, too, is in
   the collection list below.

**CORRECTION 2026-08-29, last and deepest — the whole probe family was
structurally blind to shadow DOM, and that is the root cause under all four
corrections above.** One page, one instant, read-only live:

| measurement | value |
|---|---|
| `document.body.innerText.length` | **59** |
| deep text length, piercing shadow DOM | **1,605,054** |
| shadow roots in the document | **44** |

Semrush renders its shell **and its report widgets** inside those 44 roots.
`innerText` does not cross a shadow boundary and neither does
`querySelectorAll`. **So every `table` / cell / `innerText` count this Skill has
ever taken measured a sliver of the page.** Piercing the same page moved `svg`
32 → 45, 3 → 16, 49 → 62.

⚠️ **This repo had already paid for this lesson once.** The Semrush sidebar is
also in shadow DOM; the verdict at the time was "the sidebar is invisible" until
`document.querySelectorAll('snav-sidebar-ribbon-item, snav-sidebar-list-item')`
plus `el.shadowRoot.querySelector('a')` produced 15 extra pages. **That repair
was made in one place and never generalised to the data probes.** The traversal
now lives in <ref file="scripts/lib-deep-dom.mjs"/> and every counting probe goes
through it — and it emits the **light reading beside the deep one**, because the
gap is itself the diagnostic ("how much of this page is hidden behind shadow
DOM").

**Three things this overturns, none of them small.**

1. **`exportBtns` and `chartHydrated` are retired as criteria.** `daily-trends`
   measured `exportBtns: 12` — **byte-identical to the `exp=12` on its record** —
   with a **blank content area**. All twelve matches live in the navigation shell
   inside shadow DOM, in no report at all. That is exactly the shape this law
   describes, and it is flawless: no seam to notice. Meanwhile `chartHydrated`
   read **0 on all three routes probed**, including the one whose record says
   `chart=122`. A quantity that reads 122 and 0 on the same page **is not
   evidence of anything**. Both keep being measured and recorded; neither may
   enter a verdict. "It is page output" was never sufficient — a signal must also
   be **bound to this report section**, and that section's root has still never
   been measured.
2. **The control group destroys the classification's discriminating power.**
   `top-pages` — the route whose record reads **850 filled cells** — now reads
   `tables:0, grids:0, cells:0, innerText:59` for 150 seconds. **A route known to
   carry data is indistinguishable from the nine filed "no table".** Any scheme
   that separated them was separating noise.
3. **A wrong deep-link host walks silently onto a sales page.**
   `www.semrush.com/analytics/traffic/...` is **not the authorised base**
   (`sem.3ue.co` is — see <ref file="references/authorized-data-sources.md"/>).
   It does not error: skeleton → bounce to `/analytics/traffic/` (the **public
   marketing page**: `innerText` 514, 10 images, title
   `Traffic Analytics: Estimate Any Website's Traffic | Semrush`) → bounce again
   to overview. **A scanner will happily record "no table, has svg, has export
   buttons" off a sales page.** And after the bounces the tab was sitting on
   **`mmradar.gg`**'s domain overview (23 filled cells, AS 22, organic 23.9K) —
   any probe reading `cells > 0` at that moment files mmradar.gg's numbers under
   canva.com.

**Hence a HARD GATE that runs BEFORE any classification**
(`classifyAdmissibility` in <ref file="scripts/lib-report-readiness.mjs"/>).
Three assertions; any one failing yields **`inconclusive`**, never `no-table`
and never `empty`:

| gate | what it asserts | the instance it stops |
|---|---|---|
| 1 | landed URL's path **==** the requested route | the silent bounce to the sales page |
| 2 | the header's domain **==** the requested target | mmradar.gg's cells filed under canva.com |
| 3 | the content region is non-empty, **after piercing** | `innerText:59` for 150 seconds |

Plus two preconditions of the same rank, because without them the three are
self-deception: the reading must come from the **piercing** traversal
(`deepProbe`), and the report region's root must be **measured**, not the `main`
convention. **Today's entire sweep should have been `inconclusive` throughout.**

⚠️ **On gate 3's threshold, since this repo has already lost once to a threshold
bet (instance 5 → 6).** The load-bearing half is **positive and region-bound**:
a filled cell, or a value-shaped number, or **the page's own rendered empty
state** — that last one on purpose, so a genuinely empty report does not become
permanently `inconclusive`. The character floor (**60**, one more than the
59-character shell measured today) is a **backstop, subordinate to the positive
half**: it never runs when positive evidence exists, it can only ever push a
verdict toward `inconclusive`, and its only job is to tell "never read the
content region at all" apart from "read it, nothing there to recognise". Used the
other way round — "text too short, therefore empty" — it would be instance 6
again with a smaller number.

**Scrolling: the capability is added, the default is off, and the observation
has a limit that must be stated.** Today's routes measured
`body.scrollHeight === window.innerHeight` (772), `scrollY` unmoved across 8
scrolls, every number frozen for 350 seconds. **But the module rendered blank** —
a page that rendered nothing has nothing below the fold, so that observation
proves neither that this site needs scrolling nor that it does not. Turning it on
by default would write an unmeasured assumption into default behaviour, which is
the move that produced everything above. So: **segmented scroll with a per-segment
wait, one flag away, default off**, and the probe now reports
`scrollContainers` every round. Second limit, sharper: on a page whose shell sits
in 44 shadow roots **the real scroller is very likely not `window`** — "scrolled
8 times, `scrollY` never moved" and "there is nothing to scroll" are the same
reading.

⚠️ **None of this softens <law-ref id="hidden-tabs-do-not-hydrate"/> by a word.**
The two claims are about different objects:

| the question | is visibility load-bearing? | evidence |
|---|---|---|
| **does a `table` element exist on this route?** | **no** — chart digits and export controls witness the render directly | the Class A routes returned byte-for-byte the same chart-only shape hidden and visible |
| **will the rows inside a table hydrate?** | **yes, decisively** | `top-pages`: 0 non-empty cells hidden / 850 visible, three crossing measurements |

Element existence is a question about the page's **structure**; row hydration is
a question about its **values**. Visibility gates the second and has never been
shown to gate the first. Anyone who reads "visibility does not matter" out of
this has merged the two rows of that table.

And write down the raw evidence the verdict rests on — the filled-cell count,
the elapsed time and read count behind an empty verdict, the
`listPickerVisible` flag, the account initial in the page header — so the next
reader can tell a verdict from a coincidence.
</statement>
<why>
This is not hypothetical. **The same shape appeared six times in a single day
(2026-08-28)** — the sixth being the *repair* written for the fifth — and each
time it came within one step of turning a failed read into a business
conclusion. All six are worth reading in full, because in isolation every one of
these criteria looks reasonable.

**The measured mechanism behind the last two, stated once:** these Semrush
流量与市场 (Traffic & Market) routes render in a fixed order — **summary block,
then charts, then the table, and the table is always last**. A populated summary
sitting above a zero-row table is a **normal intermediate state, not an empty
report**. And this is precisely the state that a `captureStable`-style
"read it twice, take it if the two agree" rule cannot see through: **a
not-yet-started table is perfectly stable at zero rows**, so agreement arrives
instantly and means nothing.

**The intermediate state was then caught in the act, on a different vendor
(2026-08-29) — this is the positive example the structural criterion was written
for.** On Similarweb, `kw-canva-hidden`'s **first** read was
`tables=1, th=0, rows=0`: the table element exists, and it has neither headers
nor rows. **The very next round read `th=19, rows=100`.** The same transient
appeared on `bl-canva-hidden4` and on `bl-creem-hidden`. So "a table element is
present with zero rows" is a real, reproducible, **self-resolving** mid-render
state, and not a rare one.

Two things follow. First, **under the old "waited long enough, still empty ⇒
empty" rule every one of these would have been filed as an empty table** — the
rule's failure is not theoretical, it is one polling round wide. Second, it is
the reason condition one of the structural criterion (*no `table` element
anywhere*) proves nothing on its own and the finished-rendering conditions carry
the whole verdict: the interesting cases are precisely the ones where the table
element is already there and still holds nothing.

**Instance 1 — "ready = digits appear anywhere on the page".** The check
scanned the whole document for numbers. It matched **another tool's widget
docked at the bottom of the panel** — a local-visibility comparison card
carrying `axa.fr`, `42`, `758`, `15%`. Those are someone else's numbers about
someone else's domain. Trusting that gate would have filed `axa.fr`'s figures
under the queried domain.

**Instance 2 — "ready = the word 访问量 (visits) is present".** It is present —
inside marketing copy: 通过访问量、跳出率和参与度对多个域名进行基准测试
("benchmark several domains on visits, bounce rate and engagement"). A sentence
advertising the feature satisfied the check that the feature had produced data.

**Instance 3 — "ready = the page has a chart (an `svg` element)".** The
**empty-state landing page ships decorative svg of its own**. The criterion was
therefore satisfied exactly on the page that carries no report at all.

**Instance 4 — "the target took effect = the body text contains
`canva.com`".** After a node switch the old `lid=` was not recognised by the new
account, and the page **silently fell back to the empty-state landing page**.
That landing page carries a saved-lists picker — and `canva.com` happened to be
one of the saved lists listed inside it. The criterion passed. The target had
never taken effect. `top-pages` then read **0 rows, no table, `innerText` length
353**, one step away from being written down as "node 8 is empty too" — which
would have manufactured a node difference of exactly the kind that had already
been measured, retracted and documented once
(see <law-ref id="hidden-tabs-do-not-hydrate"/>).

**Instance 5 — "ready to call it empty = three consecutive reads under
`visible` all came back empty".** This one is the subtlest, because the
criterion is the remedy prescribed by <law-ref id="hidden-tabs-do-not-hydrate"/>
and it is not wrong — it was just missing a floor. The reads were 6 seconds
apart, so **the verdict could land 18 seconds after arrival**. These pages
render in layers — **summary block, then charts, then the table last** — so
during those 18 seconds the table region is reliably, reproducibly, stably
empty. It has not begun.

The counter-evidence is hard: on node 8, `page-groups` produced **20 filled
cells** and `geographical-regions` produced **198** (sample row: `北美 | 20.69%
| 1.6亿 | 4752.6万 | 82.63% | 5.3 | 12:05 | 32.98%`). And going back to the node
5 records for those same two routes, **the summary block was fully populated**
(`访问量 7.9亿 ↑4.53% | 唯一身份访问量 2.1亿 ↑2.92% | 购买转化率 0.21% ↑28.17%`)
while the table read 0 rows. The page was working. The criterion simply did not
wait for it, and filed a slow table as an absent one.

The repair written at the time: an empty verdict requires **both** three
`visible` reads **and** at least 100 seconds elapsed in that round, rounds capped
at 150 seconds, at most 3 of them — protocol id `v5-visible-gated-min100s`.
**That repair is instance 6.**

**Instance 6 — "ready to call it empty = three `visible` reads AND 100 seconds
elapsed".** The floor did not hold either. Re-run under patient mode, **all
eight** routes previously filed `empty-silent` produced data. Not five of eight,
not seven — **eight of eight**:

| route | filled cells | first cells |
|---|---|---|
| `page-groups` | 20 | `美国 / 18.73%·1.5亿 / 81.88% / 18.12% / 巴西` |
| `demographics` | 20 | `美国 / 18.73%·1.5亿 / 81.88% / 18.12% / 巴西` |
| `business-regions` | 36 | `APAC / 34.96% / 2.8亿 / 6769.9万 / 85.84%` |
| `geographical-regions` | 198 | `北美 / 20.69% / 1.6亿 / 4752.6万 / 82.63%` |
| `audience-overlap` | 204 | `chatgpt.com / 无类别 / 8.5亿 / 6.4亿 / 12.25%·1亿` |
| `sources-destinations` | 272 | `canva.com / 直接 / 79.32% / 6.3亿 / ↑4.4%` |
| `usa` | 459 | `加利福尼亚 / 13.92% / 1811.9万 / 531.5万 / 82.66%` |
| `subfolders-subdomains` | 900 | `/design/ / 35.74% / 6.1亿 / 1.4亿 / 2.8亿` |

**The `empty-silent` category emptied out completely: its count on this node is
now zero.** And the sharpest detail: `geographical-regions` and
`business-regions` only produced their rows on a **second** re-measure — 100
seconds did not catch them, and the same page did not behave the same way twice.
Hydration time on these heavy table pages has a wide and unstable spread. The
operator's own summary of the batch is worth keeping verbatim:
**"every single one I called empty turned out to be me not waiting long enough.
Zero exceptions."**

The operating protocol moved to **patient mode**: 200 seconds per round, three
rounds run to completion with no early stop, 600 seconds maximum per route. But
**the number is not the lesson.** Instance 5 was "stability is not completion";
instance 6 is **"neither is duration"**. Both criteria had the same shape — wait,
observe nothing, conclude absence — and a criterion of that shape can only ever
be tuned, never made sound. The sound version binds the verdict to a positive
end-of-render signal and otherwise reports `inconclusive`; the floor survives
only as a backstop. That is what the statement above now says.

**This Skill had already written this warning down and then walked past it.**
`scripts/lib-tools-share.mjs` `captureStable` carries a comment saying in so
many words that these vendors render metrics in two beats, that a readiness
check keyed on labels passes during the gap, and that the resulting error is
silent — small or zero numbers, no exception. That comment was about a
*positive* read landing on placeholder values; the early-stop bug is the same
mechanism producing a *negative* verdict. The lesson did not transfer because
it had been filed as a fact about `captureStable` rather than as a fact about
criteria. That is the reason this law exists as a law.

The repaired criterion for instance 4 is
`contains "canva.com" AND NOT contains 创建新列表 ("create a new list")`,
plus two recorded facts: `listPickerVisible`, and **the account initial in the
page header** (node 5 renders `H`, node 8 renders `B`) — the cheapest available
proof of *which account you are actually looking at*.

What the six share: the criterion asked whether **something exists on the
page** — or, in instances 5 and 6, whether something *keeps not* existing for
long enough — and a page has many suppliers — the vendor's copywriter, the stylesheet, a neighbouring
widget, the account's own history, and the render pipeline that has not reached
your region yet. Only one of those suppliers is this query.

**And one more supplier, the one nobody lists: you.**

To fight hidden tabs, a small read-only patch was injected into the page —
redefine `document.visibilityState` to `visible` and dispatch `visibilitychange`.
It was measured as barely better than nothing and labelled, correctly, *not
admissible as the basis of a verdict*. Harmless. It also carried one more line:
`document.hasFocus = () => true`.

Hours later a new problem appeared: a **lying `visible`** — after a foreground
attach, a tab that reports `visible` forever and never moves. Detecting that
needs a corroborating signal **independent of `visibilityState`**, and the
obvious first choice is `document.hasFocus()`.

**Our own disguise had overwritten the one witness that could have exposed it.**
The patch was never used as a criterion, exactly as promised; it did not have to
be. It only had to be *present* while something else was measured.

The lesson is not about that one line:

> **Anything injected into the page becomes part of every later observation.**
> A patch judged harmless — read-only, "better than nothing", explicitly barred
> from the verdict — can become, hours later, the contamination source for the
> single piece of evidence that could have falsified your conclusion.
> Therefore: **keep an explicit inventory of every patch injected, make each one
> switchable off, and before collecting any signal as corroboration, confirm
> that your own instrument has not touched it.**

The `hasFocus` override is being removed; the runner now records `hasFocus`
honestly, alongside `innerWidth/outerWidth` and `innerHeight/outerHeight`, as
the independent cross-check on a `visible` that may be lying.
</why>
<scope>
Applies to every readiness gate, every target/scope check, and every "did this
report load" probe in this Skill — panel tools, report routes, harvesting runs,
and the verification step after a submission alike.

It composes with <law-ref id="hidden-tabs-do-not-hydrate"/> rather than
replacing it: that law says an empty read may not be a fact about the domain;
this one says a read that *looks* non-empty may not be a fact about your query,
and that a *repeatedly* empty read — however long you waited — may not be a fact
about anything. The failure modes are opposite and all of them are live.
Instances 5 and 6 both amended that law's own admissibility rule: 5 added the
time floor, 6 demoted the floor to a backstop and made `inconclusive` the
default output when no end-of-render signal is available.

The rankup Skill's provider-capabilities reference and its JSON sibling hold the
per-route measurements. **They point here; they must not restate this law.**
All six instances live in this one place.

**Unmeasured:** whether a filled-cell count can itself be satisfied by a
foreign table — no panel page has yet been seen rendering a second tool's
*table* inside the report region, only its widget. Treat one as a candidate if
you meet it, and scope the cell count to the report container rather than to
`document`.

**Unmeasured, and it is the residual risk left by dropping `vis` from the
structural criterion:** whether a genuinely hidden tab can reach
`chartHydrated >= 3` **and** `exportBtns >= 1` while still withholding the
`table` element. Nothing observed so far comes close — the degraded hidden reads
on record are `innerText` 328–549 with no charts and no export controls, which
fails conditions 2 and 3 on their own — but the pairing has never been measured
directly, and it cannot be measured on a session that has ever been
foreground-attached. If someone builds a virgin-background pass for it, record
the result here. Until then the argument is "conditions 2 and 3 screen out every
degraded hidden state ever seen", not "they screen out all of them".

**Unmeasured, and now the largest open item — where the report region's root
is.** `chartHydrated` and `exportBtns` are scoped to `main` by an assumption
nobody has tested. Until it is tested they are satisfiable by any neighbouring
widget under `main`. **Do not guess a selector.** What a live pass must bring
back, on at least two of the chart-only routes (`daily-trends` for the
per-channel 导出 case, plus one of `organic-social` / `email`):

- for **every** `svg text` node carrying a digit under `main`: its text, and the
  `tagName` / `id` / `class` / `data-*` attributes of each ancestor up to
  `main` — the shortest ancestor chain that separates report charts from any
  foreign widget is the answer;
- for **every** `button, a` under `main` whose text matches `/导出|export/i`:
  its text, and the same ancestor chain. `daily-trends` should show one per
  channel; whether they share a container with the charts is the whole question;
- the report region's candidate roots as *the page itself names them*:
  `main > *` with `tagName` + `role` + `data-testid` + `aria-label` + class
  list, one level deep, then two — attributes the vendor authored, not ones we
  invented;
- whether any element under `main` carries `role="region"` / `role="main"` /
  `aria-labelledby`, and what it labels;
- the same dump on a route known to carry the axa.fr-style comparison widget, so
  the widget's own chain is on record as the negative example;
- `document.querySelectorAll('main').length` — the default silently takes the
  first one.

**Unmeasured — the empty-state landing page's structure.** The marker is still
text. Bring back the empty-state page's `main` subtree: element roles,
`data-testid`s, and the accessible name of the "create a new list" control, plus
`&lt;html lang&gt;` and the URL. A structural marker (a role, an attribute, a control
identity) would retire the locale table; a second locale's text marker is only a
patch on it.

**Unmeasured — how many routes need `presentationShape` at all.** `behavior` is
the only one found so far whose data is not in a table, and it was found by
accident. The other `pending` routes have not been re-read with anchors, so
"only one such route exists" is an absence of looking, not a finding.
</scope>
<correct><![CDATA[
// SCOPE_SELECTOR is a PARAMETER, and its default is an UNVERIFIED ASSUMPTION,
// not a finding. Nobody has ever measured that the report region's root is
// `main` on these routes. It stays the default only because changing behaviour
// without measurement is forbidden; every probe output therefore carries
// `scopeIsUnverifiedDefault` so a verdict taken under the default can be told
// apart from one taken under a measured root. See the statement above.
const SCOPE_SELECTOR = 'main';   // <- UNVERIFIED DEFAULT. Pass the measured root.

// readiness: bound to THIS query's output. A cell, not a word.
const ready = (() => {
  const root = document.querySelector(SCOPE_SELECTOR) || document.body;
  const cells = [...root.querySelectorAll('table td, [role="cell"]')]
    .filter((c) => (c.innerText || '').trim().length > 0);
  return { filledCells: cells.length, ready: cells.length > 0 };
})();
// -> { filledCells: 850, ready: true }   real rows
// -> { filledCells: 0,   ready: false }  NO verdict yet — see hidden-tabs-do-not-hydrate
// AND filledCells === 0 NEVER means "no data". It means "no TABLE-shaped data".
// The route may publish its numbers as a list or a bar chart - see below.

// NON-TABLE data: no safe generic criterion exists, so the route supplies the
// anchors. Declare them from the route's own navigation BEFORE the read; never
// scan the body for digits (that is instance 1, the axa.fr widget).
const ANCHORS = { '/analytics/traffic/behavior/': ['社交媒体', '兴趣度', '设备'] };
const anchored = (() => {
  const root = document.querySelector(SCOPE_SELECTOR) || document.body;
  let n = 0;
  for (const label of ANCHORS[location.pathname] || []) {
    // the section that OWNS this label, not the page that happens to contain it
    const head = [...root.querySelectorAll('h1,h2,h3,h4,[role="heading"]')]
      .find((h) => (h.innerText || '').trim().startsWith(label));
    const section = head?.closest('section, [class*="section" i], [class*="card" i]');
    if (!section) continue;
    n += [...section.querySelectorAll('*')]
      .filter((e) => !e.children.length && /\d/.test(e.textContent || '')).length;
  }
  return { presentationShape: 'list+bar-chart', anchoredValues: n, ready: n > 0 };
})();
// -> behavior: { anchoredValues: >0, ready: true } => verdict 'data-not-in-table'
//    raw: YouTube 71.8% 1.5亿 | Facebook 49.36% 1亿 | Instagram 48.61% ...
// -> anchoredValues === 0 is NOT absence either. Absence goes through the
//    structural criterion below, same as for tables.

// target check: the positive AND the negative condition, in one read.
// CORRECTED 2026-08-29: the negative half used to be the bare literal 创建新列表,
// and "no match" was read as "not the empty state". Both halves of that were
// wrong. Same account, English UI -> `Create a new list` misses -> `ok === true`
// on the empty-state landing page, i.e. instance 4 reproduced verbatim. And
// "marker absent" is itself an unfalsifiable negative - the disease this law
// exists to name. So markers are declared PER LOCALE, and a locale we have no
// markers for yields `unknown`, never `ok`.
const EMPTY_STATE_MARKERS = [           // extend by MEASURING a new locale's page
  { locale: 'zh', marker: '创建新列表' },
  { locale: 'en', marker: 'Create a new list' },
];
const scope = (() => {
  const t = document.body.innerText || '';
  const hit = EMPTY_STATE_MARKERS.find((m) => t.includes(m.marker)) || null;
  // page-produced facts, not guesses: <html lang> and the locale segment this
  // vendor puts in its own paths (dash.3ue.co/zh-Hans/).
  const lang = document.documentElement.lang
    || (location.pathname.split('/').find((seg) => /^[a-z]{2}(-[A-Za-z0-9]+)*$/.test(seg)) || '');
  const covered = EMPTY_STATE_MARKERS.some((m) => m.locale === lang.toLowerCase().split(/[-_]/)[0]);
  const emptyState = hit ? 'yes' : covered ? 'no' : 'unknown';
  return {
    hasTarget: t.includes('canva.com'),
    emptyState, emptyStateMarkerLocale: hit?.locale ?? null, uiLocale: lang || null,
    listPickerVisible: emptyState === 'yes',
    accountInitial: (document.querySelector('header [class*="avatar" i]')
                     ?.innerText || '').trim().slice(0, 1),
    ok: t.includes('canva.com') && emptyState === 'no',
  };
})();
// -> { hasTarget:true, emptyState:'yes',     ok:false } landed on the empty state
// -> { hasTarget:true, emptyState:'no',  accountInitial:"B", ok:true }
// -> { hasTarget:true, emptyState:'unknown', ok:false } French UI, no markers for
//    it: we cannot clear the empty state, so we do not pretend we did.

// an EMPTY verdict binds to a POSITIVE end-of-render signal. These pages render
// summary -> charts -> table (table last), so a zero-row table under a populated
// summary is a mid-render state, and "stable at zero rows" proves nothing.
// CORRECTED 2026-08-29: `spinnerGone` is gone as a gate. It was a NEGATIVE
// criterion built on GUESSED VENDOR CLASS NAMES - rename the class and it is
// permanently true, so a page that never began rendering reads "the loading
// indicator has gone away". Unfalsifiable, and false-in-the-direction-that-
// grants-authority: exactly the shape `vis === 'visible'` was removed for. It
// is split in two:
//   - `[aria-busy="true"]` is a STANDARD ARIA attribute - the page asserting
//     about itself. Kept, and only as a VETO. Its absence proves nothing;
//     completion is always supplied by the positive signals.
//   - the two `[class*=...]` guesses are RECORDED ONLY and gate nothing. (They
//     also cut the other way: one decorative `class="spinner-icon"` elsewhere
//     on a finished page would have blocked the verdict forever.)
const done = (() => {
  const root = document.querySelector(SCOPE_SELECTOR) || document.body;
  return {
    paginator: !!root.querySelector('[class*="pagination" i], nav[aria-label*="page" i]'),
    rowCount: !!root.querySelector('[data-testid*="row-count" i], [class*="total-rows" i]'),
    ariaBusy: !!root.querySelector('[aria-busy="true"]'),                     // VETO
    loadingClassPresent:                                                     // RECORDED
      !!root.querySelector('[class*="skeleton" i], [class*="spinner" i]'),
  };
})();
const renderFinished = (done.paginator || done.rowCount) && !done.ariaBusy;

// the floor is a BACKSTOP on the round, never the reason for the verdict.
const verdict = filledCells > 0 ? 'data'
  : (renderFinished && visibleReads >= 3) ? 'empty'
  : 'inconclusive';          // <- the default when the page never said it was done
// rounds: 200s each, 3 of them, run to completion, 600s cap per route.
// Those numbers bound the wait; they do not license the verdict.
// POLL at 600-700ms inside a round, never 6s: "visible" is a ~3s pulse (measured
// 2026-08-28 - 6 visible reads out of 1400+ at a 6s cadence, because another
// agent held Chrome's active tab). visibleReads >= 3 means three reads inside ONE
// visible window; three reads spread over three separate pulses do not count.


// PROVING A ROUTE HAS NO TABLE AT ALL is a different claim, and it has a sound
// criterion. Run in anger 2026-08-29. All FOUR conditions, on TWO reads running.
// It used to have five; `vis === 'visible'` was removed the same day - it is not
// page output, and after one foreground attach it is a pinned constant. See the
// correction in the statement above.
// ⚠️ CORRECTED 2026-08-29 (root cause): EVERY count below pierces shadow DOM.
// Same page, same instant: body.innerText 59 chars / deep text 1,605,054 /
// 44 shadow roots. `querySelectorAll` and `innerText` both stop at the shadow
// boundary, so the pre-correction version of this block measured a sliver.
// deepQueryAll / deepTextSample / collectRoots come from lib-deep-dom.mjs.
const structural = (() => {
  // the report root is looked up DEEP too - on this vendor the report region
  // itself can sit inside a shadow root, and the old lookup silently fell back
  // to document.body, i.e. back to those 59 characters.
  const scoped = deepQueryAll(document.body, SCOPE_SELECTOR)[0] || null;
  const root = scoped || document.body;
  return {
    scopeSelector: SCOPE_SELECTOR,
    scopeResolved: !!scoped,
    scopeIsUnverifiedDefault: SCOPE_SELECTOR === 'main',
    deepProbe: true,                    // this reading pierced shadow DOM
    shadowRoots: collectRoots(root).roots.length - 1,
    // 1. no table anywhere. ON ITS OWN THIS PROVES NOTHING - an unrendered page
    //    has no table element either. AND it must be the DEEP count: the shallow
    //    one says "no table in this sliver of the page", which is how nine
    //    `no-table-structural` verdicts were manufactured.
    noTable: deepQueryAll(root, 'table, [role="grid"]').length === 0,
    // the SHALLOW readings are kept beside the deep ones on purpose: the gap is
    // the diagnostic ("how much of this page is behind shadow DOM").
    lightDom: {
      tables: root.querySelectorAll('table, [role="grid"]').length,
      textLength: (root.innerText || '').length,
    },
    deep: { textLength: deepTextLength(root) },
    // 2 + 3. RETIRED AS CRITERIA 2026-08-29, still recorded. daily-trends
    //    measured exportBtns:12 (identical to its record's exp=12) with a BLANK
    //    content area - all twelve in the nav shell, inside shadow DOM, in no
    //    report. chartHydrated read 0 on all three routes probed, including the
    //    one recorded as chart=122. One is vacuously true on a blank page, the
    //    other vacuously false on a populated one. Neither may gate anything
    //    until this section's real root has been MEASURED.
    chartHydrated: deepQueryAll(root, 'svg text')
      .filter((t) => /\d/.test(t.textContent || '')).length,
    exportBtns: deepQueryAll(root, 'button, a')
      .filter((b) => /导出|export/i.test(b.innerText || '')).length,
    exportControlLabels: deepQueryAll(root, 'button, a')
      .map((b) => (b.innerText || '').trim()).filter((l) => /导出|export/i.test(l)),
    advisoryOnly: ['chartHydrated', 'exportBtns', 'vis', 'hasFocus'],
    // 4. and it is THIS query's page, being looked at right now. NOT droppable:
    //    the empty-state landing page is a PERFECT noTable===true (instance 4).
    onTarget: scope.ok,
    // RECORDED, NOT GATED. Evidence about the instrument, never about the page.
    // hasFocus is the cross-check on a `visible` that may be a pinned lie.
    vis: document.visibilityState,
    hasFocus: document.hasFocus(),
    // scrolling: the capability exists and is OFF by default. Today's routes read
    // scrollHeight === innerHeight and scrollY never moved - BUT THE MODULE
    // RENDERED BLANK, so that proves nothing either way. And on a page with 44
    // shadow roots the real scroller is very likely not `window`, which reads
    // exactly like "nothing to scroll". Record the candidates; decide later.
    scrollContainers: deepScrollContainers(root).slice(0, 20),
  };
})();

// THE HARD GATE. It runs BEFORE any classification, and nothing downstream may
// name a class until it passes. Today's whole sweep should have been
// `inconclusive`, and it was not, because none of these three was asserted.
const gate = (() => {
  const reasons = [];
  // precondition A: the reading pierced shadow DOM at all.
  if (!structural.deepProbe) reasons.push('shallow-probe');
  // precondition B: the report root was MEASURED, not the `main` convention.
  if (!structural.scopeResolved) reasons.push('scope-unresolved');
  else if (structural.scopeIsUnverifiedDefault) reasons.push('scope-unverified-default');
  // 1. landed path == requested route. www.semrush.com is NOT the authorised
  //    base and does not error: skeleton -> /analytics/traffic/ (the public
  //    MARKETING page) -> overview. A scanner records "no table, has svg, has
  //    export buttons" off a SALES PAGE.
  const landedPath = new URL(location.href).pathname.replace(/\/+$/, '');
  if (landedPath !== REQUESTED_PATH.replace(/\/+$/, '')) reasons.push('path-drift');
  // 2. header domain == requested target. After those bounces the tab was on
  //    mmradar.gg's overview: 23 filled cells, AS 22. Anything reading cells > 0
  //    then files mmradar.gg's numbers under canva.com. Header unreadable is
  //    ALSO a fail - this is the last gate, nothing catches it afterwards.
  const headerTarget = (parseHeader(structural.deepText).headerTarget || '')
    .toLowerCase().replace(/^www\./, '');
  if (!headerTarget) reasons.push('header-target-unknown');
  else if (headerTarget !== TARGET) reasons.push('header-target-mismatch');
  // 3. the content region is non-empty AFTER piercing. top-pages - 850 filled
  //    cells on its record - read tables:0 cells:0 innerText:59 for 150 seconds.
  //    POSITIVE and region-bound, three ways; the page's own rendered empty
  //    state counts, so a genuinely empty report is not stuck at inconclusive.
  const deepText = deepTextSample(root, { maxChars: 60000 });
  const evidence = filledCells > 0 ? 'filled-cells'
    : /[\d.,]+\s*(?:[KMB]|万|亿|%)/i.test(deepText) ? 'value-token'
    : /未找到结果|没有数据|No results|No data/i.test(deepText) ? 'rendered-empty-state'
    : null;
  if (!evidence) {
    // the 60-char floor is a BACKSTOP SUBORDINATE TO THE POSITIVE HALF: it never
    // runs when evidence exists, it can only push toward `inconclusive`, and it
    // exists to tell "never read the region" from "read it, nothing to
    // recognise". 60 = the 59-char shell measured today, plus one. Run the other
    // way round ("too short, therefore empty") it is instance 6 with a smaller
    // number.
    if (deepText.length <= 60) reasons.push('content-below-floor');
    reasons.push('no-content-evidence');
  }
  return { admissible: reasons.length === 0, reasons, evidence };
})();

const noTableStructural = gate.admissible && structural.deepProbe &&
  structural.noTable && structural.onTarget;
// meaning, in one sentence: THIS IS DEMONSTRABLY THE RIGHT PAGE FOR THE RIGHT
// TARGET, ITS CONTENT REGION HAS RENDERED, AND THERE IS STILL NO SUCH THING AS A
// TABLE IN IT - counted through shadow DOM. The finished-rendering evidence now
// comes from the gate's content check, which is bound to the report subtree, so
// the twelve export buttons in the nav shell cannot reach it.

// three verdict names, and only two of them are results. Check data-not-in-table
// BEFORE concluding absence: "no table" and "no data" are different sentences.
// AND: `admissible` is a REQUIRED first term. A gate that passes when you forget
// to pass it is not a gate - which is precisely how today's sweep got classified.
const absence = !gate.admissible ? 'inconclusive'                      // THE GATE
  : anchored.ready ? 'data-not-in-table'                               // admissible
  : noTableStructuralTwiceRunning ? 'no-table-structural'              // admissible
  : budgetExhausted ? 'no-table'                                       // NOT admissible
  : 'inconclusive';
// 'no-table' is filed as PENDING, never as a route capability. The two that
// landed there say why: paid-search chart=0/exp=6 (chart numbers never drew),
// behavior chart=0/exp=0 (nothing on the page rendered - nothing was measured).
// behavior has since been re-read and it is 'data-not-in-table', not empty.

// and record the evidence NEXT TO the verdict, not just the verdict
{ "route": "/analytics/traffic/top-pages/", "verdict": "data",
  "filledCells": 850, "listPickerVisible": false, "accountInitial": "B",
  "visibilityStateAtVerdict": "visible" }
// page-groups was recorded exactly like this, at 104300ms, and it was WRONG —
// a later patient run read 20 filled cells. Without an end-of-render signal the
// only honest verdict is the third one.
{ "route": "/analytics/traffic/page-groups/", "verdict": "inconclusive",
  "filledCells": 0, "visibleReads": 3, "elapsedMsThisRound": 104300,
  "renderFinishedSignal": null, "protocolId": "v6-patient-signal-gated" }
]]></correct>
<wrong><![CDATA[
// 1. digits anywhere -> matched a NEIGHBOURING TOOL'S widget (axa.fr / 42 / 758 / 15%)
const ready = /\d/.test(document.body.innerText);

// 2. a metric keyword -> matched marketing copy that merely NAMES the metric
const ready2 = document.body.innerText.includes('访问量');

// 3. "there is a chart" -> the EMPTY-STATE landing page ships decorative svg
const ready3 = document.querySelectorAll('svg').length > 0;

// 4. target present -> the empty state's saved-list picker LISTS canva.com
const onTarget = document.body.innerText.includes('canva.com');
// passed while the target had not taken effect; the 0-row / no-table / len-353
// read that followed was one step from being filed as "node 8 is empty too"

// 5. "empty three reads running" -> reads 6s apart, so the verdict lands at 18s,
//    and these pages render summary -> charts -> TABLE LAST. Not-yet-started is
//    the most stable state there is.
if (visibleReads >= 3 && filledCells === 0) return 'empty-silent';
// FALSE — page-groups (20 cells) and geographical-regions (198 cells) were
// filed as empty this way, while their summary blocks were already full.

// 6. the REPAIR for 5: same shape, bigger number. Still false.
if (visibleReads >= 3 && elapsedMsThisRound >= 100_000 && filledCells === 0) return 'empty-silent';
// FALSE — ALL EIGHT routes filed empty by this rule produced data once the wait
// grew (20 / 20 / 36 / 198 / 204 / 272 / 459 / 900 cells); geographical-regions
// and business-regions only on the SECOND re-measure. A floor is a threshold bet.
// "Waited long enough and still empty" is not a criterion at any number.

// 7. "no table element -> this route has no table". Condition 1 with nothing
//    behind it. A page that has not started rendering has no table element.
if (document.querySelectorAll('table').length === 0) return 'chart-only';
// FALSE - behavior finished the whole budget at chart=0/exp=0: not one chart
// number, not one export button, i.e. the section never rendered. That is a
// measurement of nothing, filed as a fact about the route.

// 8. the positive criterion run BACKWARDS: no filled cells, therefore no data.
if (filledCells === 0) return 'no-data';
// FALSE - and it is our own good criterion misused, which makes it the easiest
// one to miss. behavior has ZERO table elements and its numbers are right there:
// YouTube 71.8% 1.5亿 | Facebook 49.36% 1亿 | Instagram 48.61% | Reddit 33.71%
// drawn as lists and bar charts. filledCells===0 supports exactly one sentence:
// "no TABLE-shaped data". The hidden premise was "data means a table".

// 8b. and the tempting over-correction, which is instance 1 again:
if (/\d/.test(document.body.innerText)) return 'data-not-in-table';
// FALSE - that is the axa.fr widget. Non-table data needs anchors DECLARED BY
// THE ROUTE and values read from inside those sections. No generic form is safe.

// 10. counting anything with a NON-PIERCING query. THIS IS THE ROOT CAUSE.
const noTable = document.querySelectorAll('table, [role="grid"]').length === 0;
const bodyText = document.body.innerText;
// FALSE - on this vendor, same page same instant: innerText 59 chars vs 1,605,054
// piercing, 44 shadow roots. Every table/cell/text count taken this way measured
// a sliver. And the control group settles it: top-pages, 850 filled cells on its
// record, reads tables:0 cells:0 innerText:59 for 150 seconds - INDISTINGUISHABLE
// from the nine routes filed "no table". The classification had zero
// discriminating power. This repo had already fixed exactly this for the sidebar
// (snav-sidebar-* + el.shadowRoot) and never generalised it.

// 11. export controls / hydrated chart digits as "the rest of the page finished".
if (noTable && chartHydrated >= 3 && exportBtns >= 1 && onTarget) return 'no-table-structural';
// FALSE - daily-trends: BLANK content area, exportBtns === 12, byte-identical to
// the exp=12 on its own record. All twelve live in the nav shell inside shadow
// DOM, in no report at all. chartHydrated read 0 on all three routes probed,
// including the one recorded chart=122. Vacuously true where it lies, vacuously
// false where it is honest - the same shape as `vis === 'visible'`, one layer
// down. "It is page output" is NOT sufficient; it must be bound to THIS section.

// 12. classifying without asserting where you landed or whose page it is.
const verdict = classify(probe);   // no route check, no header check
// FALSE - www.semrush.com is not the authorised base (sem.3ue.co is) and DOES
// NOT ERROR: skeleton -> /analytics/traffic/ (public marketing page, innerText
// 514, title "Traffic Analytics: Estimate Any Website's Traffic | Semrush") ->
// overview, ending on mmradar.gg's domain overview (23 filled cells, AS 22).
// So this line can file a SALES PAGE as "no table, has svg, has export buttons",
// or file mmradar.gg's numbers under canva.com. Assert path == route and
// header == target BEFORE classifying, or emit `inconclusive`.

// 9. gating the structural criterion on visibility.
if (noTable && chartHydrated >= 3 && exportBtns >= 1 && onTarget
    && document.visibilityState === 'visible') return 'no-table-structural';
// FALSE - not because the verdict is wrong but because the last term is not
// evidence. visibilityState is not page output, and after ONE foreground attach
// it is pinned to 'visible' forever (Experiment E), so it is vacuously true on a
// poisoned session and can be false on an honest fully-rendered one. Conditions
// 2 and 3 already prove the render finished; the proxy only adds a liar.
// Keep onTarget - the empty-state landing page is a perfect noTable===true.
]]></wrong>
</law>

<law id="every-measurement-needs-two-witnesses" weight="load-bearing">
<statement>
**Every measurement of a quota-site page needs two witnesses: the rendered
pixels (a screenshot) and a shadow-DOM-piercing reading (a census). Any
conclusion about the page must be able to produce both, taken at the same dwell
position.** A single-witness reading is never sufficient grounds for a
*negative* conclusion — "empty", "no data", "the feature does not exist" — and
automation's job ends at collecting the witness pair. **The verdict belongs to
the AI, cross-examining the two witnesses against each other**; a script that
emits verdicts has crossed the line this law draws.

| role | who | may do | may NOT do |
|---|---|---|---|
| collector | script (<ref file="scripts/ground-truth.mjs"/>) | poll, screenshot, census, pair them, write manifest | conclude anything |
| judge | AI reading the evidence directory | compare pixels against DOM per dwell position | trust one witness alone for a negative |

Each witness catches what the other misses, measured on the pilot page
(2026-08-29, `top-pages` for canva.com — evidence in
`evidence/ground-truth/semrush-top-pages-canva/`, kept local: screenshots of the
logged-in panel do not enter this public repo):

- **DOM has, screenshot cannot show**: 17 columns of which one viewport shows
  ~6-7 (screenshot-only reading loses nearly 2/3 of the columns), 50 rows of
  which one screen shows ~16, and 1.6M characters of deep text. A
  screenshot-only pipeline under-reads massively.
- **Screenshot has, DOM cannot prove**: which page is actually *rendered* — a
  census of a hidden half-hydrated tab and a census of the real report can look
  alike, and only the pixels settle whether the user-visible page is a report, a
  sales page, or a skeleton. The trend-line curves' shapes exist only as pixels.

**Readiness binds to `filledCells`, never to text length — text length is the
shell, not the goods.** Pilot timeline, same page, same session: deep text hit
**1,599,006 characters at ~9 seconds** with **0 non-empty cells**; the data
landed at **~76 seconds** as **850 filled cells** (deep text then 1,605,808).
Any "deep text is long, so the page is ready" criterion fires a full minute
early on a pure shell. Corollary, in collection order: **poll the census until
`filledCells > 0` first, and only then start screenshotting** — the reverse
order archives a pile of loading-state screenshots as if they were evidence.

**Bottom-of-page binds to both witnesses at once**: the census unchanged AND the
screenshot md5 unchanged against the previous dwell. One witness frozen alone
proves nothing — an unchanged census with moving pixels is an animation or
virtual scroll; unchanged pixels with a changing census is data mutating below
the fold, and "scrolled but `scrollY` never moved" may just mean the real
scroller is not `window`.

The collector is `node scripts/ground-truth.mjs --url &lt;url&gt; --out
&lt;evidence-dir&gt;` — quota-site session convergence, foreground birth, poll →
paired census+screenshot per screen → manifest, secrets scrubbed before
anything touches disk or stderr. Its output directory *is* the witness bundle;
the pilot bundle above is the reference for what a completed cross-examination
looks like (`CARD.md` there is the judge's write-up).
</statement>
<why>
Every prior instance of this Skill's blindness — the 59-character shell read as
an empty page, `exportBtns: 12` counted off a blank content area, nine
`no-table-structural` verdicts manufactured from shallow counts, a sales page
scanned as "no table, has svg" — shared one shape: **one witness, trusted
alone, with no second witness able to contradict it.** The pilot run closed the
loop the other way: every number spot-checked in the pixels (39.47%, 5853.7万,
2.2亿, 934.4万, 6742, 6220, 5218, "Page 1 of 1,430") was found in the DOM
sample, and every DOM claim was confirmed on screen — that agreement, checked
per dwell position, is what a conclusion is allowed to stand on.

Anti-example, the readiness trap in its exact pilot numbers: at 9 seconds the
census read `deepTextLength: 1,599,006 / filledCells: 0`. A text-length
criterion says "ready" — and the paired screenshot at that instant shows a
skeleton. At 76 seconds the census read `filledCells: 850`, and the screenshot
shows the table. **Two witnesses disagreeing is itself the signal**: it means
"shell up, goods not yet" — a state no single witness can name.

Anti-example, the judging script: a collector that also classifies ("empty",
"ready", "no such feature") re-creates every verdict bug this file documents,
one layer down, where no law reviews it. The pilot's census counted
`tables: 1` off a page with zero `table` elements (a `role=grid` DIV) — a
mechanical reading with a built-in ambiguity that only a reader comparing both
witnesses (and the split `tables` / `grids` fields that fix followed from)
could catch. Scripts collect; the AI judges.
</why>
</law>

<law id="one-collector-per-quota-tool" weight="load-bearing">
<statement>
**On any quota tool, at most one collector agent exists at any moment — and a
run that spans multiple commands must hold the machine-wide tool lock for its
whole duration.** The daemon's same-name-session queue serialises **single
batches, not runs**: a whole-run collector like
<ref file="scripts/ground-truth.mjs"/> spans dozens of commands, and in the gap
between any two of them another workflow can `open` its own URL into the shared
`semrush-nav` tab. That is not a theoretical risk: **four live takeovers were
caught in one recheck session** (2026-08-29, judge's write-up in
`evidence/ground-truth/recheck-VERDICTS.md`, kept local).

(a) **One collector per tool at a time — and "collector" includes a human-paced
    manual exploration session.** Measured 2026-08-29 during the organic-routes
    run: a hand-driven exploration that held no lock was **legitimately driven
    off its tab by a lock-holding batch task** (`semrush-keyword.mjs`, the
    game-review batch) — the lock holder was in the right, the explorer was
    the intruder. Take the machine lock before any manual poking at a quota
    tool, exactly as a scripted run would. Queueing is not isolation. The
    poster-child sample: the page-groups re-run was steered through `/home/`
    and someone else's keywordoverview and parked on **sylviejewelry.com's
    top-pages — 942 filled cells that, had nobody read the href, would have
    been credited to canva.com**. The usa run was dragged to another agent's
    referral verification; demographics and behavior were stolen by other
    sessions' "december birthstone color" / "aries birthstone"
    keywordoverview queries. Second confirmed instance, 2026-08-30
    (ads-trends run): in a gap where this run held no lock, the shared tab was
    **legitimately taken over by another session's `semrush-report.mjs` batch
    (perfume-tools)** — findlinks read the other workflow's keywordoverview
    page. "读之前必须持锁" now has two independent live confirmations.
(b) **A whole run holds the machine-wide tool lock**
    (`acquireToolsShareBrowserLocks` in `scripts/lib-tools-share.mjs`,
    `yan-tools-share-&lt;tool&gt;.lock`): acquired before the first command,
    held across every poll, screenshot and scroll, released in `finally`.
    <ref file="scripts/ground-truth.mjs"/> is the reference implementation —
    it maps the URL's host to the tool key (non-quota hosts take no lock) and
    records `lockHeld` / `lockWaitMs` in the manifest.
(c) **Every census records its `href`, and that href is the last line of
    defence against contamination.** The verdict admits only witness pairs
    whose href stayed on the target route; the collector checks the path
    prefix after every census and, on departure, writes `hijacked: true` plus
    the offending href (scrubbed) into the manifest and exits 3 immediately —
    it never keeps polling on someone else's page.
(d) **The dispatcher's lesson: "it's queued, so it's safe" is a prediction the
    mainline itself made and got wrong.** The scheduling error was not a
    subagent's — the dispatcher reasoned from the daemon queue to whole-run
    safety, and four takeovers happened inside runs it believed were
    serialised. Dispatch collectors one per tool, with the lock, or not at all.
</statement>
<why>
<law-ref id="tools-share-is-a-global-mutex"/> already made the lock machine-wide
per tool — but it only binds scripts that go through `lib-tools-share.mjs`'s
launcher, and `ground-truth.mjs` (which enters via a direct URL, not the panel)
did not take it. The gap between "the daemon serialises each batch" and "the
run is serialised" stayed invisible until the 2026-08-29 recheck, where 4 of 19
live runs were taken over mid-flight by unrelated workflows on the same box.
The failure mode is maximally quiet: exit codes look normal, cells fill, and
the numbers are real — they are just **someone else's numbers**. Only the
per-census href (witness discipline from
<law-ref id="every-measurement-needs-two-witnesses"/>) exposed it, which is why
(c) is a law and not an implementation detail.
</why>
</law>

<semrush-traffic-route-capabilities date="2026-08-29">
<summary>
**Route capability map for Semrush Traffic Analytics — double-witness
re-measurement, 2026-08-29.** All nine routes whose historical verdicts had
been voided were re-measured with <ref file="scripts/ground-truth.mjs"/>
(census + screenshot pairs, session `semrush-nav`, strictly serial), and the
AI cross-examined both witnesses per route. The full judge's write-up is
`backlink/evidence/ground-truth/remeasure-VERDICTS.md` — **kept local**: the
evidence directory is gitignored, so that path does not resolve in a clean
checkout. This table is the durable summary.
</summary>

| route | shape | magnitude (canva.com, monthly) | historical verdict vs now |
|---|---|---|---|
| `referral` | chart-only | 40M–60M | "no table" holds; "no data" was false |
| `organic-search` | chart-only | 100M–130M, axis top 150M | same |
| `paid-search` | chart-only | 0.8M–1.15M, axis top 1.5M | historical "chart values never rendered" (`chart=0/exp=6`) did not reproduce — the chart carries real digits |
| `organic-social` | chart-only | 11M–24M, axis top 30M | "no table" holds; data lives in the chart |
| `paid-social` | chart-only | 140K–170K, axis top 200K | same |
| `email` | **empty-state** | none — grey jagged placeholder, no axes, export greyed out | historically lumped in with the chart routes; it has no chart at all |
| `display-ads` | chart-only | 45K–170K | "no table" holds; data lives in the chart |
| `socioeconomics` | chart-only | summary cards + bar/stacked charts; every value present as DOM text — densest of the nine | Class A "no table" holds, but the page is the richest, not empty |
| `daily-trends` | chart-only | daily visits 20M–35M, axis top 40M | historical "BLANK content area, exportBtns===12" did not reproduce — the same 12 export controls sit beside a full page of charts |
| `top-pages` (control) | **table** | 850 filled cells | the known-good table route, included as the positive control |

**Data-route recheck, same day.** The nine routes historically recorded as
*having* data were re-measured with the same collector — **2026-08-29 双证人复核
确认，计数与历史精确一致**, every route's filled-cell count matching its
historical record exactly (judge's write-up:
`backlink/evidence/ground-truth/recheck-VERDICTS.md`, kept local, gitignored):

| route | filledCells (recheck = historical) | verdict |
|---|---|---|
| `subfolders-subdomains` | 900 | confirmed-data |
| `usa` | 459 | confirmed-data |
| `sources-destinations` | 272 | confirmed-data |
| `audience-overlap` | 204 | confirmed-data |
| `geographical-regions` | 198 | confirmed-data |
| `business-regions` | 36 | confirmed-data |
| `page-groups` | 20 | confirmed-data |
| `demographics` | 20 | confirmed-data |
| `behavior` | data-not-in-table — summary cards, social-media bars, interest bars, device donut; values live in DOM text, not grid cells | confirmed-data (chart-card shape upheld) |

Attribution anchor, one line: **business-regions' four regions sum to ≈790M
(2.8亿+1.9亿+1.6亿+1.6亿), matching canva.com's ~7.9 亿 monthly visits** — the
counts above are anchored to the right domain, not to a hijacked page.

**Collection guidance for the chart-only routes.** They need a chart reader:
after piercing shadow DOM the axis labels, series names and data values are
present in the deep DOM text (`deep.svgText` 13–1132 nodes across these
routes), and every spot-checked pixel number was found there. **Never again
derive "no data" from "no table"** — that inference was wrong on 8 of 9
routes. The collector's readiness now has a matching second branch:
`filledCells > 0` (table, checked first) else `svgText > 0` stable three
polls (chart), recorded as `readyBranch` in the manifest.

**The email lesson, one line: a copy-free placeholder empty state exists, and
`svgText: 0` is the discriminator.** The placeholder has no "no data" text, so
marker-based empty-state detection never fires; among these routes only the
census's `svgText` separates it from chart-only (0 vs 13–1132). The collector
marks it `suspectedEmptyState: true` in the manifest; the verdict still
belongs to the AI with both witnesses.

**Corrections to the historical record.** "No table" was confirmed 9/9; the
"no data / feature does not exist" extension was wrong 8/9 (all but `email`).
The historical magnitude clues (referral 60M, organic-search axis 150M,
organic-social 30M, paid-search 1.5M) matched the re-measured axis tops
route by route. Neither historical anomaly — "paid-search chart values never
drew" and "daily-trends blank content area" — reproduced; both were
un-rendered loading states filed as page truth.
</semrush-traffic-route-capabilities>

<semrush-organic-route-capabilities date="2026-08-29">
<summary>
**Route capability map for Semrush Organic Research + Keyword Gap — the
"copy the competitor" chain, double-witness ground-truth run, 2026-08-29.**
Collector: <ref file="scripts/ground-truth.mjs"/>, session `semrush-nav`,
machine lock held for the whole run, strictly serial. Target domain canva.com
(db=us). Judge's write-up: `backlink/evidence/ground-truth/semrush-organic-VERDICTS.md`
— **kept local** (the evidence directory is gitignored). This block is the
durable summary. Host is the authorized panel origin (`sem.3ue.co`); URL
templates below are paths on it.
</summary>

<routes><![CDATA[
| route | URL template | shape | scale (canva.com/us) | answers |
|---|---|---|---|---|
| positions | /analytics/organic/positions/?db=us&q=<domain>&searchType=domain | summary cards + distribution chart + table | 990 cells (~99 rows × 10 cols); totals 1,658,077 keywords / 16,581 pages | which keywords carry the domain's traffic (keyword / intent / position / SERP features / traffic / traffic% / volume / KD% / URL / last change) |
| changes | /analytics/organic/changes/?db=us&q=<domain>&searchType=domain | trend chart + top-page-change cards + table | 1,230 cells; 45,382 total changes | what the competitor recently gained / improved / declined / lost (previous vs current position, delta, traffic change; "new" labels are plain DOM text, parseable) |
| pages | /analytics/toppages/?db=us&q=<domain>&searchType=domain — /analytics/organic/pages/ 302s HERE; collect via the toppages URL directly, or pass --accept-redirect /analytics/toppages/ | summary cards + 3-line trend chart + table | 997 cells; 33,931 pages | which pages carry organic traffic (URL / traffic / change / traffic% / keyword count / **LLM prompts (大型语言模型提示) — new 2026 column** / referring domains / top keyword / intent) |
| competitors | /analytics/organic/competitors/?db=us&q=<domain>&searchType=domain | competitive-position bubble chart + table | 700 cells (100 rows × 7 cols); 305,726 competitors | highest keyword-overlap rivals (domain / competition level / common keywords / SE keywords / traffic / cost / paid keywords); first row adobe.com, 17%, 328.5K common |
| subdomains | /analytics/organic/subdomains/?db=us&q=<domain>&searchType=domain | single table | 60 cells (15 rows × 4 cols), all on first screen, no pagination | where the traffic sits by subdomain (canva.com: www = 100%, 37.25M) |
| Keyword Gap (results) | /analytics/keywordgap/?q=<you>&searchType=domain&rankType=<bucket>&db=us&compareWith=<comp1>%3Adomain%3Aorganic%7C<comp2>%3Adomain%3Aorganic | best-opportunity cards + 3-circle Venn + bucketed table | 1,000 cells; buckets for canva vs figma vs express.adobe.com: common 45.4K / missing 24.9K / weak 8.2K / strong 24.6K / untapped 3.1M / unique 288.1K / all 3.9M | keywords rivals rank for and you don't (missing) or rank weakly for — the direct topic source |
]]></routes>

<keyword-gap-deep-link>
The hardest-won finding of the run: **the Keyword Gap results page is directly
addressable by URL** — no form walk needed. Verified reproducible template:
<cmd><![CDATA[
/analytics/keywordgap/?q=canva.com&searchType=domain&rankType=common&db=us&compareWith=figma.com%3Adomain%3Aorganic%7Cexpress.adobe.com%3Adomain%3Aorganic
]]></cmd>
- Each `compareWith` entry is `域名:searchType:关键词类型` (`domain:organic`,
  URL-encoded `%3Adomain%3Aorganic`); **multiple competitors are separated by a
  pipe `|` (`%7C`)** — never a comma.
- `rankType` switches the bucket in the same parameter slot: `common` and
  `missing` both verified by direct navigation; the bucket bar also offers
  weak / strong / untapped / unique / all.
- A subdomain (express.adobe.com) is accepted as a comparison column.
- The **entry page** (`?db=us&q=&lt;domain&gt;&amp;searchType=domain` with no
  `compareWith`) is a form with "you + up to 4 competitors" slots and **no
  results — a single domain never reaches the results page**.
</keyword-gap-deep-link>

<lesson id="fake-paywall-is-a-url-encoding-error">
**A "upgrade to Business" full-page blur modal can be a URL-encoding error, not
a plan limit.** Joining two `compareWith` entries with a comma (`%2C`) swallows
the second entry's `:domain:organic` suffix and stably reproduces the Business
upgrade modal ("谷歌购物广告数据有限…升级到 Business", page blurred behind it).
Switching the separator to `|` (`%7C`) made the same three domains return full
data immediately. **When an upgrade modal appears, suspect your own URL encoding
first, the subscription second.**
</lesson>

<lesson id="comparison-tools-need-full-inputs">
**A comparison tool probed with a single input measures a degraded form state,
not the feature.** The single-domain keywordgap entry renders only the empty
form and was ruled INVALID as capability evidence. Any Gap / "X vs Y" style
tool must be fed a full comparison set — 3 domains, or 3–5 keywords — before
any verdict about what it can do is admissible.
</lesson>

<lesson id="semrush-shadow-form-recipe">
**The Keyword Gap form (and its siblings) is a React controlled combobox buried
in shadow DOM.** Measured interaction results, 2026-08-29:
- opencli's AX layer (`find` / `click` / `state`) is completely blind to it;
- a synthetic `value` setter **crashes the component** — after the re-render
  even `deepQueryAll` no longer finds the input;
- the working combination: `el.focus()` +
  `document.execCommand("insertText")` to type, `opencli keys Enter` to
  commit, plain `button.click()` to press 比较;
- **do not use Escape to dismiss the dropdown** — it clears the uncommitted
  text.
Related read-out trap: the Venn diagram legend normalises subdomains to the
root domain (express.adobe.com shows as "adobe.com 3.5M"); **read domains from
the table column headers, never from the chart legend**.
</lesson>

<footnote>
Organic Research tab set observed: 概览 / 排名 / 排名变化 / 竞争对手 / 主题 /
子域名 — "主题 (topics)" not yet measured. Same nav group also holds 域名概览,
比较域名 (`/analytics/comparedomains/`), 关键词差异, and 反向链接差异
(`/analytics/gap/backlinks/`). The keyword-gap entry page's hydration is
moody — same URL often parks at a 1.6M-char shell; the collector's
stall-refresh handles it.
</footnote>
</semrush-organic-route-capabilities>

<semrush-ads-trends-capabilities date="2026-08-30">
<summary>
**Route capability map for Semrush 广告研究 (Advertising Research) + .Trends
市场概览/批量分析 — double-witness ground-truth run, 2026-08-30.** Collector:
<ref file="scripts/ground-truth.mjs"/> (machine-wide semrush lock held for each
run), session `semrush-nav`, target domain canva.com. Judge's write-up:
`backlink/evidence/ground-truth/semrush-ads-trends-VERDICTS.md` — **kept
local** (the evidence directory is gitignored). Host is the authorized panel
origin; URL templates below are paths on it.
</summary>

<routes><![CDATA[
| page | URL template | shape | scale (canva.com) | answers |
|---|---|---|---|---|
| 广告研究 · 排名 | /analytics/adwords/positions/?db=us&q=<domain>&searchType=domain | summary cards + trend chart + table (readyBranch=table, ~31s) | 2,607 paid keywords, $94.4K traffic cost; 100 rows/page × 27 pages | which Google Ads keywords the rival pays for (keyword / position / delta / volume / CPC / URL / traffic / cost / competition) — verified commercial-intent words |
| 广告研究 · 广告创意 | /analytics/adwords/copies/?db=us&q=<domain>&searchType=domain | card grid, NO table NO chart (data-not-in-table): table/chart ready branches never fire, so a plain run budget-exits 2 while deepText holds all the data — MUST collect with --ready-text '广告创意'; grep deepText before ever calling it empty | 2,118 ad copies; each card = title + display URL + body + keyword count | what the rival's ad copy says, and how many keywords back each copy (high count = a proven copy) |
| Ads History | ~~/analytics/adwords/adshistory/~~ ~~/adhistory/~~ | BOTH paths 302 back to positions (hijack self-check exit 3) | — | NEGATIVE, on record to stop re-searching: this account/version has NO standalone Ads History tool — the ads nav group (实见截图) has no such entry, and unknown adwords sub-paths all fall back to positions. The "12-months-running" matrix has no entry here; untested candidate: Keyword Overview's ad-history block |
| .Trends 市场概览 (Market Explorer 后继) | entry form /analytics/traffic/market-overview/ → results ?lid=<listId> (directly addressable; q= is NOT accepted — identity lives in lid) | summary cards + SVG four-quadrant + participants grid (346 filledCells); quadrant names AND domain labels are svg text nodes, bubble coords are SVG attributes — parseable from DOM, no pixel reading needed | market of 99 domains + canva; market traffic 49.4亿 ↑9.23%; TAM 70亿 / SAM 68.6亿 (97.95%); traffic cost $10.7亿 | a niche's market size / growth / consolidation / player quadrants (规则改变者/领导者/利基市场参与者/已有参与者) — pick an ecosystem niche |
| .Trends 行业与批量分析 (= Bulk Analysis) | /analytics/traffic/industry-and-bulk-analysis/ (remembers lid; tabs 批量分析/商家类别) | form (self-drawn row editor + TXT/CSV upload) → results grid (filledCells>20 ready, ~60-90s) | up to 100 domains per run; 6 domains → 42/42 cells in ONE request (genuinely quota-friendly vs 6 separate /analytics/traffic/ reports); exportable | bulk visits / uniques / purchase conversion / pages-per-visit / duration / bounce across a candidate pool — the quota-friendly screen for rival/backlink prospects |
]]></routes>

Dead-route corrections, same run: the old feature-map's
`/analytics/backlinks/bulk/` 302s to the `/analytics/backlinks/` landing form —
**that route no longer exists**; the real bulk entry is .Trends' 行业与批量分析.
`/trends/market-explorer/` is a 404 and `/market-explorer/` 302s to
`/analytics/traffic/market-overview/` — Market Explorer has been folded into
「流量与市场」.

<lesson id="market-overview-async-is-computing-not-empty">
**A newly created market list computes asynchronously and can sit on a skeleton
for 40+ minutes — that state is "computing", never "empty" and never a
paywall.** When done, filledCells 346 + svgText &gt; 10; the collector's ready
criterion is filledCells &gt; 40 or svgText &gt; 10, and a short budget exits 2.
Revisit later instead of writing a verdict. Two entry traps: (a) the bare
`/analytics/traffic/market-overview/` path 302-remembers the LAST `lid` once
any list exists — a **new** market must go through 「保存的列表 → 创建新列表」;
(b) the form shell can fail to hydrate — reload once and the input appears
within ~10s (same disease as keywordgap), then `el.focus()` +
`execCommand('insertText')` + click 分析, and come back in 15-60 minutes. The
「编辑」competitors dialog has a single-slot input — one domain per Enter, and
a dialog opened by mistake is discarded with 取消 (read-only discipline).
</lesson>

<lesson id="trends-pages-are-ax-blind">
**These .Trends pages defeat BOTH the AX tree (state shows only RootWebArea)
and CSS `find` — only <ref file="scripts/lib-deep-dom.mjs"/> shadow-piercing
reads them.** The iframe hypothesis is ruled out (deep iframe count 0). Do not
conclude "blank page" from a blind AX read; go straight to the deep-DOM
witness.
</lesson>

<lesson id="bulk-form-wants-a-file-not-keystrokes">
**The bulk-analysis domain form is a self-drawn row editor ("N/100 of 100
lines"), NOT a textarea — typed input silently loses every line after the
first.** `insertText` with `\n` keeps the counter at 1/100; `insertParagraph`
concatenates lines (`capcut.comcanva.com`). The working recipe (4 failures
deep): synthesize the upload in-page —
`new File([domains.join('\n')], 'domains.txt', {type:'text/plain'})` into a
`DataTransfer`, assign to the deep-DOM `input[type=file]` (accept=.csv,.txt),
dispatch `change` — counter flips to N/100 immediately ("文件已上传"), then
click 分析 via deep button-text match and read the results grid.
</lesson>

<footnote>
Parameter scope: `q=` / `db=` work on the `/analytics/adwords/` group only;
market-overview ignores `q=` (identity is `lid=`). Adwords tab set observed:
排名 / 排名变化 / 竞争对手 / 广告创意 / 页面 / 子域名 — the paid twin of the
organic set; only 排名 and 广告创意 measured. Cross-check anchor: canva.com
7.9亿 monthly visits agrees three ways (market participants table, bulk
analysis, historical semrush-traffic run).
</footnote>
</semrush-ads-trends-capabilities>

<similarweb-explore-capabilities date="2026-08-29">
<summary>
**Route capability map for Similarweb's "pick the racetrack" chain — Demand
Analysis + Website Rankings, double-witness run, 2026-08-29.** Session
`similarweb-nav`, machine lock held throughout. Judge's write-up:
`backlink/evidence/ground-truth/similarweb-explore-VERDICTS.md` — kept local.
Everything here is **hash routing**: `location.pathname` is permanently `/`,
so landing checks compare the first 3 hash segments and plain `open` of a deep
link can load an empty shell — the collector's hash-aware self-check and
`--scroll-container` / `--ready-text` flags (see
<ref file="scripts/ground-truth.mjs"/>) exist precisely for this surface.
</summary>

<routes><![CDATA[
| page | URL shape (hash on the panel origin) | shape | scale | answers |
|---|---|---|---|---|
| Demand Analysis home | #/digitalsuite/marketresearch/keywordmarketresearch/home | search box + topic cards + lists (no table, cells=0) | 4 trending-topic cards + 217-industry topic tree (in-page overlay) | topic radar entry: which topics' demand is rising |
| Demand Analysis topic report | #/digitalsuite/marketresearch/keywordmarketanalysissearch/demand-search-trends?country=999&webSource=Total&duration=12m&id=AiTopic%3B<topic>%3B999 | cards + charts + 4 tables (table-ready in 23s, filledCells=180) | 74M total searches on 1,000 keywords; 12-month curve; countries table paginated /29 ≈ 145 countries | a topic's total demand, growth, keyword mix, geography — the core pick-a-keyword report. Deep-linkable: the id format is AiTopic;<topic>;999 |
| Website Rankings selector | #/digitalsuite/markets/webmarketanalysis/home | industry tree only, no table | 217 industries (26 top-level + subcategories) | entry into a category board |
| Website Rankings category board | #/digitalsuite/markets/webmarketanalysis/mapping/<Top_Level~Sub_Category>/<country>/1m?webSource=Total | 3 Top-movers tables + main board as a COLUMN-MAJOR DIV layout (produces no cells — census is blind to it) | 10,000 domains × 13 columns × 100 pages (100 rows/page); 9 channel tabs (all/search/social/display/referral/direct/email/generative AI/affiliates) | the god-view for site picking: category map, climbers/fallers, per-channel slices ("who is eating generative-AI traffic" is just a tab) |
| AI traffic | #/digitalsuite/ai-traffic/overview/*/999/6m?webSource=Total | empty state awaiting a domain query | — | who gets AI referrals (not yet mined) |
]]></routes>

<rankings-mechanics>
- **Industry slug is guessable**: readable, `~`-separated levels
  (`Computers_Electronics_and_Technology~Graphics_Multimedia_and_Web_Design`);
  a guessed slug deep-linked successfully with no hash drift.
- **Page jump is direct**: the paginator ("N out of 100") is an `input` — type
  a page number + Enter and it jumps (verified page 5 → rows 401–500 with real
  long-tail data). Deep probes for `[class*=pagination]` find nothing; the
  pixel witness located it first.
- **Country change MUST go through the UI**: 999=worldwide, US=840 in the hash
  segment, but editing the hash segment directly gets silently rewritten back
  to 999. Use the header country dropdown (shadow DOM — semantic `find` fails,
  deep `.click()` works); after the UI switch the URL contains /840/ and is
  copyable.
- On the industry tree, `click --text` lands on the first clickable item, not
  the named one — deep-link the slug instead.
- The main board produces **no cells** (column-major DIVs), so `cells &gt; 0`
  is not a readiness criterion here — that is what the collector's
  `--ready-text` branch is for; the main scrollbar lives in an inner div
  (`.sw-layout-scrollable-element`, window scrollY stays 0), which is what
  `--scroll-container auto` handles, and chart animation keeps screenshot md5
  changing forever — a census-stable/shot-unstable stop is the honest outcome,
  not `stable`.
</rankings-mechanics>
</similarweb-explore-capabilities>

<other-drivers>
<driver name="agent-browser" verdict="no logged-in identity, ever">
It attaches over CDP, and CDP cannot reach the owner's Chrome: Chrome 136+
silently ignores `--remote-debugging-port` on the default user-data-dir
(verified on 151 — the flag is passed, no port is opened), and macOS TCC blocks
copying the profile out. Relaunching Chrome is wasted effort; do not suggest it.
Its `--profile` means a separate directory you log into once, unrelated to the
owner's sessions. Use it only for tasks needing **no** logged-in identity, and
address tabs by `--label`, never by the `t1`/`t2` positional index, which is a
shared namespace across agents.
</driver>
<driver name="Claude in Chrome" verdict="single agent, ad-hoc, prefer OpenCLI anyway">
It reaches the owner's Chrome but has no isolation boundary of any kind: one
flat tab group shared by every concurrent agent, and omitting `tabId` resolves
to "first tab in the shared group". It also has a reproducible bug where closing
one of your own tabs tears down your session's tab-group tracking and orphans
the rest. It is Claude-only, so anything built on it cannot be replayed from
another runtime.
</driver>
</other-drivers>

<preflight>
<cmd>node scripts/health.mjs</cmd>
Run before browser work. Use `--check-update` only when the user asks about
versions; an available update is informational, and upgrading OpenCLI needs a
separate request.

Read <ref file="references/safety-policy.md"/> before any fill, submission,
account, or logged-in operation.

Confirm ownership rather than assuming it:
<cmd>opencli browser "$SESSION" tab list   # should show only your own tab</cmd>
</preflight>
</browser-runtime>

<data-sources>
<terminology lang="zh">
**当用户说「数据面板」「数据勘测」「查一下数据」「用 Similarweb 看看」「Semrush 拉一下」，
指的都是同一件事：走那个共享账号的代理面板，用 Similarweb 或 Semrush 查。**
这两个产品是这里唯一的第三方数据源，没有别的候选，不需要反问用户指的是哪个平台。
</terminology>
<division lang="zh">
分工固定，按问题类型选，一次只开一个：

| 问题 | 用哪个 | 拿得到什么 |
| --- | --- | --- |
| 这个站多大、流量从哪来、还有哪些同类站 | **Similarweb** | 总访问量（含直接/推荐）、渠道构成、相似站、地理分布 |
| 这个词多少量、多难、谁在排、它的外链长什么样 | **Semrush** | 分国家搜索量与 KD、关键词全库导出、自然排名、主要页面、引荐域名与反链 |

**两边的「流量」口径不同，对不上很正常。** Semrush 域名概览给的是**自然搜索流量估算**，
Similarweb 给的是**总访问量**。同一个站两边差三倍以上是常态，写结论时必须标明口径，
否则会得出「竞品比想象中弱」这种错误判断。绝不放进同一列。
</division>
<panel-launch>
Both live behind one shared-account panel, and launching through the launcher is
mandatory — a deep link into the tool origin before the launcher runs lands on
`about:blank`.
<cmd>node scripts/tools-share-open.mjs --tool semrush</cmd>
Both entry points are **optional overrides**, not prerequisites.
`lib-tools-share.mjs` ships a `DEFAULT_DASHBOARD` and loads the Skill's
gitignored `.env`, so the scripts run with neither variable set — an earlier
revision of this file called them required, which sent a tester hunting for
configuration that was already there. Set them only to point at a different
dashboard:
<cmd><![CDATA[
export TOOLS_SHARE_DASHBOARD_URL="https://<your-authorized-dashboard>"
export TOOLS_SHARE_APP_ORIGIN="https://<origin-the-dashboard-launches-into>"
]]></cmd>
The launched application sits on a different host from the dashboard entry
point, so the second cannot be derived from the first.

All of these share one launcher, `lib-tools-share.mjs`. **Do not write a second
one.** A previous copy of the launch sequence inside `similarweb-query.mjs`
omitted three of the four known traps and failed with a generic "unavailable"
whose real cause differed every time.

**Check the subscription expiry before planning around it** — it is short-dated,
the scripts print it, and they warn inside 7 days.

**Budget the whole recon against the quota printed at launch.** Reusing a
session skips the launcher, which is the point, and the side effect is that the
quota text never re-renders — so no reused-session call prints a fresh reading.
A rule like "stop at 80%" cannot be enforced mid-run; decide the size of the
run up front.

**同一任务、同一工具固定传同一个 `--session`，零值复查也不新建，整批完成后只关一次。**
`launchTool()` 会优先复用已经停在目标工具 origin 的 session，但调用方仍必须固定传入同名；
重复打开 dashboard 可能被面板计作新的客户端登录，不能用换 session 代替复查。

**Raise your shell timeout before a batch, not after it fails.** A panel launch
costs 20–40s and each report ~15s, so five domains or a dozen keywords in one
call runs for minutes and a two-minute default kills it mid-flight. The scripts
write incrementally so nothing is lost, but the run still has to be restarted.

**每个节点是一个不同的共享账号，会分别用完每日报告限额。** 2026-08-27 实测：默认节点跑
Semrush 报表返回「已达到每日报告限额」，换到 `节点2`（一个当天还没被用满的账号）之后同一份
报表立刻跑通。**这张被限额的页面照样渲染完整的表头**——所有列名都在，只有表体被换成了那句
限额提示——所以任何只认表头就判定"页面就绪"的检查都会通过，然后把一张空表当成真实数据。

**目前只有 `semrush-report.mjs` 会自动识别这句提示**。⚠️ 一条更早的复核说这里「当前是死代码」，
2026-08-28 重新核对源码后**撤回**：那条判断说的是更早的一个版本（`if (loaded.capture?.bodyText
&& QUOTA_BLOCKED.test(...))`，而限额页上 `capture` 恒为 null，所以那个分支确实到不了）；
现在的代码在 `!loaded.capture` 时走 `diagnoseUnrendered`，**当场重读一次页面**，翻页路径上
也有同一条检查，两条都可达，`--self-test` 也真的驱动了它们。真正的缺陷是另一个：判据方向反了
——它原来在**整页**里搜这句话，而限额页会照常渲染完整列头，供应商改文案 / A/B / 帮助气泡
里出现同一句话都会两个方向都误判。现已改成绑**表体区**：`filledCells === 0` **且**这句提示
出现在表体区自己的文字里；表体区定位不到时报 `quota-suspected`，不冒充确诊。
即便如此也不要假设脚本会替你挡住限额。`similarweb-query.mjs`、`semrush-overview.mjs`、`semrush-batch.mjs`、
`semrush-keyword.mjs` 等其余脚本完全没有这项检测。**在这条被自动化补上之前，读表前必须自己
在表体文字里找一遍「已达到每日报告限额」**，出现了就是节点问题，换节点重跑，不是这个域名
没数据——不要假设脚本会替你发现。

<cmd><![CDATA[
node scripts/tools-share-node.mjs list --tool semrush                    # 只读，不点「打开」，不耗配额
node scripts/tools-share-node.mjs probe --tool semrush --nodes 1,2,3     # 逐个真的启动，看哪个能用
]]></cmd>

`probe` 只回答"这个节点现在能不能进去"，**不回答"这个节点会不会被限额"**——面板卡片上的
「API 今日配额 N%」与单份报表的「每日报告限额」是不是同一个配额口径没有验证过,同一次
`probe --nodes 1,2` 实测两个节点读到的配额百分比完全相同，说明那读数很可能是账号维度、
不是节点维度的,不要拿它当预测。真正会不会被限额，只有实际跑报表看有没有弹出那句提示才知道。

**镜像补丁把 `document.referrer` 的 getter 换掉了（gmitm.env.js reverseUrl），
referrer 为空时读它直接抛 `Cannot read properties of undefined (reading
'charAt')`，整条 eval 报废。** 任何页内 eval 读 `document.referrer` 必须包
try/catch —— opencli 的 `pressure.mjs` 配额探针就依赖这条读取，2026-08-30 实测
中招。

**平台方定性（2026-08-30，用户与客服确认）：面板公告里的自动化禁令针对的是攻击性
脚本 / API 轰炸，正常的面板读取不在禁止之列。** 此前判决书里「需上报的风险」条目
就此降级为已解决；但节制节奏保留 —— 单会话串行、请求间 30s 级间隔，这不再是风控
避险，而是省配额的纪律。

Everything else about cards, quota, and the traps is in
<ref file="references/authorized-data-sources.md"/>.
</panel-launch>
</data-sources>

<workflows>
<workflow id="explore" when="the user just wants to see what is on a page">
<statement>
Ad-hoc looking is still scripted work. Use OpenCLI so the look is replayable.
</statement>
<cmd><![CDATA[
# Name it after what you are looking at, per <law id="no-literal-session-name">:
# a unique-but-meaningless name still cannot answer "whose tab is this".
# Do NOT use $$ here — in Claude Code's Bash tool it changes every call.
S="explore-pricing"
opencli browser "$S" open "https://example.com/pricing"
opencli browser "$S" get url     # confirm you landed
opencli browser "$S" extract
opencli browser "$S" close
opencli browser "$S" tab list                        # expect [] 
]]></cmd>
<or>
For a public page where you want prices and paywall shape parsed out:
<cmd>node scripts/page-read.mjs --url https://example.com/pricing --out .backlink/pricing.json</cmd>
`page-read.mjs` reads only; it never fills or submits. `curl | grep` returns an
empty shell on the SPAs these sites are built with.
</or>
<promote>
If you find yourself running the same exploration twice, that is the signal to
write a script for it. That is how every script in `scripts/` started.
</promote>
</workflow>

<workflow id="discover" when="the user wants new opportunities">
<read><ref file="references/discovery-loop.md"/></read>
<method>
Recursive discovery: seed competitors → get their backlink rows from an
authorized Semrush/Ahrefs export or logged-in browser → classify source URLs
(editorial, resource, directory, profile, comment, login wall, paid, CAPTCHA,
rejected) → harvest commenter domains on real article pages → feed those back
into the queue → repeat to a bounded depth. Rank by topical fit, page quality,
moderation, public visibility, and referral potential. Low-quality comment
volume is auxiliary, never the goal.
</method>
<cmd><![CDATA[
node scripts/discovery-queue.mjs seed --file .backlink/discovery.json --domain competitor.com

# bulk: feed an authorized referring-domains export straight in.
# Edges are typed `refdomain` — do NOT route these through import-commenters,
# which would record a commenter relationship nobody observed.
node scripts/discovery-queue.mjs import-refdomains --file .backlink/discovery.json \
  --source competitor.com --input .backlink/competitor-refdomains.csv

node scripts/harvest-commenters.mjs --session "discovery-commenters" --url https://example.com/article --out .backlink/commenters.json
node scripts/discovery-queue.mjs import-commenters --file .backlink/discovery.json --input .backlink/commenters.json
node scripts/discovery-queue.mjs next --file .backlink/discovery.json --limit 10
]]></cmd>
<recon>
Domain overview is one page out of five that matter; the other four have no
export button and are where competitor recon actually happens. **Pass the same
`--session` across the whole recon** — the panel launch costs 20–40s and a
login, the report itself ~15s, and `semrush-report.mjs` skips the launch when
the session is already parked on the tool origin (`sessionReused: true` says
which happened).
<cmd><![CDATA[
# Semrush is a quota site: the script resolves the session to the fixed
# `semrush-nav` itself, so do NOT pass --session. Passing one is ignored with a
# warning; the fixed name is what serialises concurrent callers into one tab.
node scripts/semrush-report.mjs --report keyword --keyword 'grid maker' --db us
node scripts/semrush-report.mjs --report backlinks-overview --domain rival.com
node scripts/semrush-report.mjs --report organic-positions --domain rival.com --db us
opencli browser semrush-nav close
]]></cmd>
<note>
This is the one place a session legitimately handles several *reports* — it is
still one page at a time, navigated in sequence, which is what
<law-ref id="one-session-one-tab"/> allows. Holding them open simultaneously
would need N session names.
</note>
</recon>
<caution>
These metrics help discover and prioritize candidates. They never prove a
backlink is public, indexed, followable, or causally producing traffic. The
parsing traps that make a report silently return zeros are documented in
<ref file="references/authorized-data-sources.md"/> — read it before writing any
new reader, especially the rule that a readiness predicate must key on a **data
row**, never on a tab name, column header, or filter chip.

**Then check the parser against itself.** A ready page and a correct parse are
different claims, and the second one fails silently. One live run under-reported
**all five** domains it touched — the worst lost 91 rows of 93, and the one that
looked healthiest still lost 49 — with no error anywhere and a wrong written
conclusion on top.

The check is **two comparisons, and conflating them produces false alarms**:

<check level="1" compares="rawText vs parsed.rows.length">
Count the record-shaped lines in `rawText`, compare with `parsed.rows.length`.
A gap here means **your regex has a blind spot** — the rows arrived and you
dropped them. This is the silent, dangerous one. Fix the parser.
</check>
<check level="2" compares="the page's own headline count vs rawText">
Semrush prints its own total (`自然搜索排名: N`). If that exceeds what `rawText`
even contains, the rows **never reached you**: these tables are virtual-scroll
and only mount a fraction at a time, so a full pull needs the export, which
costs quota. This is a known ceiling, not a bug — say so rather than "fixed
the parser".
</check>

A live re-run shows both at once: three domains matched their headline exactly
(14/14, 22/22, 5/5) while one read 91 against a claimed 430. The first three
prove the parser; the fourth is level 2 and needs no fix.
</caution>
</workflow>

<workflow id="screen" when="before filling anything, always">
<statement>
The qualifying test is real traffic (`&gt;= 100` monthly visits), never DR, and it
runs BEFORE the form does.
</statement>
<read><ref file="references/traffic-screen.md"/></read>
<cmd><![CDATA[
node scripts/similarweb-batch.mjs --domains-file domains.txt --out sw.jsonl
node scripts/apply-traffic-screen.mjs --in sw.jsonl --source similarweb
node scripts/targets-select.mjs --cohort open --min-traffic 100
]]></cmd>
<headline>
Measuring a domain costs one query; filling its form costs two orders of
magnitude more. One run filled every form across a 73-domain family and only
then sampled five for traffic — every filled form was discarded.
</headline>
</workflow>

<workflow id="submit" when="a route exists and the target passed the screen">
<read><ref file="references/submission-lanes.md"/></read>
<inspect>
Inspect every target independently. Never infer a form from a sibling site. A
page is directly fillable only when there is one unambiguous qualifying form
and no detected CAPTCHA/login wall. A CAPTCHA page may be staged only when the
owner explicitly accepts normal human completion; never bypass or solve it by
an external CAPTCHA service.
<cmd><![CDATA[
node scripts/inspect-page.mjs --session "inspect-comment-scan" --mode comment \
  --url https://example.com/article --out .backlink/scan.json
]]></cmd>
Modes are `comment`, `directory`, or `auto`.
</inspect>
<payload>
Create a reviewed JSON payload with truthful values. For comment mode,
`description` is the comment body.
<cmd><![CDATA[
{
  "url": "https://owned.example/relevant-page",
  "name": "Real owner or product name",
  "email": "owner@example.com",
  "description": "A page-specific, useful comment or truthful listing description"
}
]]></cmd>
</payload>
<fill>
<cmd><![CDATA[
node scripts/safe-fill.mjs --session "fill-submission" \
  --scan .backlink/scan.json --payload .backlink/payload.json
]]></cmd>
It revalidates the URL, form identity, field semantics, login state, and CAPTCHA
state, installs a submit guard, and never submits. The human reviews the
rendered page and performs final submission. Only after the user explicitly
authorizes one exact reviewed submission may the agent run
`release-submit-guard.mjs` — and releasing the guard still does not click
Submit.
When the owner has explicitly accepted normal CAPTCHA completion, add
`--allow-captcha`; this only permits guarded filling and leaves the CAPTCHA and
final submission untouched. CAPTCHA routes are always handoff-only. Once the
filled form is visibly ready for the owner, release only the guard with
`release-submit-guard.mjs --human-handoff`, then stop. The agent must not solve
the challenge or click Submit, even when a batch authorization already exists.
</fill>
<staged-queue>
Lane B leaves forms on screen for the owner to finish. **One session name per
staged site** — a session owns one tab, so reusing one session overwrites the
previous staged form while the report still says N staged. `adapter-phpld.mjs`
carries the reference implementation.
</staged-queue>
</workflow>

<workflow id="analyze" when="the user has exported backlink data already">
<statement>
Analyze referring-domain quality and topical relevance; suspicious networks,
sitewide links, and toxic patterns; anchor and target-page diversity;
follow/nofollow/UGC/sponsored distribution **when observed**; competitor gaps
and prioritized next opportunities.
</statement>
<read>
<ref file="references/link-quality-rubric.md"/> — scoring, toxicity, disavow.
<ref file="references/analysis-templates.md"/> — report shapes.
<ref file="references/outreach-templates.md"/> — frameworks; sending needs the
user's explicit approval per message.
</read>
<hard-limit>
These templates assume you already have the data. They do not fetch it. **A
report built from templates alone, with no observed rows behind it, is
fabrication.** Do not disavow links, contact site owners, or change production
sites unless the user separately asks. Treat third-party authority and traffic
estimates as directional and time-sensitive.
</hard-limit>
</workflow>

<workflow id="harvest" when="the numbers are visible in a logged-in dashboard with no API">
<read>
<ref file="references/harvest.md"/> before writing any scraping loop. It
documents failures that produce **plausible, silently wrong output**: virtual
scroll tables that are not `&lt;table&gt;` and drop rows without erroring, long URLs
that make whole rows vanish, execution-channel timeouts that look like failure
while the page loop is still running, and Chrome's intensive throttling
stretching a four-second loop into twenty-five minutes.
</read>
<cmd><![CDATA[
sh scripts/harvest-collect.sh          # wait for downloads to settle, then collect
node scripts/harvest-merge.mjs         # merge by field shape, refuse duplicate files
]]></cmd>
<note>
`scripts/harvest.browser.js` is the in-page collector. Its output arrives via a
Blob download rather than a return value, because the execution channel
truncates at roughly 1 KB.
</note>
</workflow>

<workflow id="verify" when="closing the loop on any placement">
<states>candidate → qualified → drafted → filled → submitted → public → indexed → rel_verified</states>
<cmd><![CDATA[
# Track a submission
node scripts/ledger.mjs upsert --file .backlink/ledger.json --url https://target.example/page
node scripts/ledger.mjs transition --file .backlink/ledger.json \
  --url https://target.example/page --state public \
  --evidence "Observed the exact public anchor on 2026-07-30"

# Per-project progress: what have I submitted vs what's left?
node scripts/ledger.mjs stats --file .backlink/ledger.json
node scripts/ledger.mjs remaining --file .backlink/ledger.json --min-traffic 100
node scripts/ledger.mjs remaining --file .backlink/ledger.json --cohort open --free-only

# Select next batch, excluding already-submitted domains
node scripts/targets-select.mjs --cohort open --min-traffic 100 --ledger .backlink/ledger.json
]]></cmd>
<evidence-bar>
`submitted`, `public`, `indexed`, and `rel_verified` each require an evidence
note. Never promote a record from a filled form, a pending notice, or a
historical assumption. **`indexed` must name the engine** — `indexed@google`,
`indexed@brave`. An unqualified "indexed" is a claim about the whole web built
from one crawler's opinion.
</evidence-bar>
</workflow>
</workflows>

<rules type="non-negotiable">
<rule id="no-coordinate-clicking">No coordinate-based "human-like" clicking.</rule>
<rule id="no-bypass">No CAPTCHA, Turnstile, login, paywall, quota, or account-scope bypass.</rule>
<rule id="unmeasured-is-not-qualified">
Never treat "not yet measured" as "qualified". The traffic gate only works if
unmeasured rows are excluded from a batch rather than waved through.
`--min-traffic` drops them by design; `--unmeasured` lists them as the next
screening queue, never as a batch.
</rule>
<rule id="validate-gates-against-known-bad">
A gate metric is validated against known-bad domains, never against famous ones.
Any signal a link network can manufacture for itself — DR, popularity rank,
index size — will pass a farm. Tranco's top-1M failed exactly this way: 48 of 73
confirmed farm domains sat inside it, from rank 134k to 998k.
</rule>
<rule id="no-fabrication">
No generic praise, fake identity, invented metrics, or a comment body that
ignores the article it sits under. Never invent a product fact to fill a field —
founder, pricing, address, launch date, user count, ownership, legal, contact.
Leave optional unknowns blank and stop a row whose required field is unknown.
</rule>
<rule id="relevance-ranks-never-gates">
A host site on a different topic is fine. Relevance and DR **rank** candidates,
they never **gate** them, and `nofollow` is an observation to record rather than
a reason to skip. Read <ref file="references/acquisition-doctrine.md"/> before
rejecting any target on quality grounds.
</rule>
<rule id="no-link-farms">
No link farms, spam generators, adult/malware surfaces, hidden reciprocal links,
temporary eligibility pages, or cloaking. Two identical give-aways in one place
— one site script across dozens of domains, and a promotional sentence repeated
word for word — mean one operator. Submitting to N of its domains buys one
link's value while accruing N times the footprint.
</rule>
<rule id="submission-is-not-a-backlink">
Do not record a submission as a backlink. This includes handing a URL to a
search engine: that is an index-submission channel, it publishes no link, and it
belongs in `data/index-submission.json` rather than the placement ledger.
</rule>
<rule id="observe-before-recording">
Do not record `follow`, `nofollow`, `ugc`, `sponsored`, or `indexed` without
observing it for the exact URL. A click, a completed registration, a saved
draft, a form that cleared itself, or a generic thank-you URL is **not** evidence
of a submission — those record what you did, and the ledger records what the
site did.
</rule>
<rule id="never-retry-ambiguous">
Do not automatically resubmit an unconfirmed target. Never retry an ambiguous
final action — one where the submit happened and the result was not observed.
Check the account backend, then the mailbox, then the public page. That state is
`outcome-unknown`, and it is not a failure.
</rule>
<rule id="anchor-policy">
Anchor text is the brand, the product name, or the naked canonical URL. Never
request dofollow treatment, never repeat a commercial exact-match anchor across
a campaign, and treat a paid or incentivised placement that publishes as a plain
follow link as **noncompliant** rather than as a win.
</rule>
<rule id="secrets">
Records carry aliases and evidence IDs. Passwords, OTPs, recovery codes,
cookies, OAuth parameters, magic links, raw session IDs, raw email addresses,
and phone numbers belong in none of them. Keep raw cookies, tokens,
authorization headers, and credentials out of logs.
</rule>
<rule id="traffic-figures-need-six-fields">
A third-party traffic figure without `source · metric · month · geography ·
device · date verified` is not a number. Store all six or store none.
</rule>
<rule id="http-over-mcp">
Prefer a documented HTTP endpoint over an MCP server when both serve the same
data from the same quota — the MCP adds a connection and a process without
adding capability, and a failure there is harder to tell apart from the service
being down. Keep MCP where it is the only authorized channel; never retire a
working path before the replacement has run successfully once.
</rule>
<rule id="verify-before-trusting-a-row">
Records carry `lastVerifiedAt` because this genre dies faster than it changes. A
channel that worked three months ago may be gone, gated, or `noindex` today.
Re-verify before a campaign; the validator warns on anything `live` older than
180 days. **Fixing a wrong row is worth more than adding a new channel.**
</rule>
<rule id="two-tables-two-claims">
`free-channels.json` records **a published link on a live page** and requires
`relObserved`/`anchorRendered`. `submission-targets.json` records **a submission
route that exists** and the validator rejects those fields there. A target
graduates from the second into the first the moment an actual anchor is
observed; until then it makes no promise about `rel`, anchor text, or
indexability, and the report must not imply one.
</rule>
<rule id="closed-loop-volume-check">
Two volume sources disagreeing by more than ~3× is not evidence that "volume
is unreliable" — it is a resolvable arithmetic question, and you MUST resolve
it before either number enters a decision. Pick a domain ranking #1 for the
disputed keyword, get its real traffic and Organic-Search share from
Similarweb, and get its ranked keywords with volumes from Semrush. Divide
observed organic clicks by the candidate volume total to get an implied CTR:
under 40% is plausible, over 100% falsifies that volume. This validates
**volume only, never intent** — a keyword can clear the CTR check and still be
worthless if the SERP shows the searchers do not want what you sell. A
falsification of one function of a tool (its volume model) says nothing about
another function of the same tool (e.g. SERP-composition reads have no
estimation model and are unaffected). Full worked example:
<ref file="references/authorized-data-sources.md"/>.
</rule>

<rule id="volume-durability-check">
A closed-loop volume check validates **magnitude at one point in time**. It says
nothing about whether that demand persists, and the two questions need separate
evidence. Traffic tools report a trailing window, so a keyword measured during a
viral spike passes the CTR check with real, correctly-computed, and
already-obsolete numbers. Before a keyword is allowed to anchor a product line,
a page build, or a link campaign, pull a multi-year **Google Trends** curve for
it alongside a known-evergreen term in the same category. A term that is flat at
zero until one month, spikes, and decays is a fad — entering it means fighting
for a shrinking pool, and the incumbent's traffic collapse will be invisible in
rank data. The diagnostic that separates the two causes: if the incumbent still
holds #1 while its traffic falls, **demand fell, not rankings** — that is decay,
not a penalty, and no amount of link building recovers it. Real case: a keyword
verified closed-loop at 72k–143k/mo went to 2.2/100 on Trends within three
months while the #1 site kept its position and lost 87% of its traffic.
</rule>
</rules>

<escalation>
<summary>Read the reference **before** acting, not after the run goes wrong.</summary>
<when trigger="any browser work at all">references/browser-runtime.md</when>
<when trigger="any fill, submit, account, or logged-in action">references/safety-policy.md</when>
<when trigger="a supplied list of 100+ rows, or anything that must survive interruption">references/batch-campaign.md — the single-target loop deduplicates too late, stalls behind the first CAPTCHA, cannot tell an interrupted row from an unstarted one, and produces a number that counts forms instead of links</when>
<when trigger="about to actually submit to directories — authorization, hidden free tiers, no-fabrication, ledger hygiene">references/directory-run-playbook.md — a real run's difficulty is before and after the form, not in it: 4 of 5 successful submissions hid their free tier behind a paid upsell, one target was already listed without any submission, and a driver's ledger row went stale the moment someone else finished the job</when>
<when trigger="a first submission campaign">references/field-notes.md — personal-contact requirements outrank CAPTCHAs, and landing-page CAPTCHA scans give false negatives</when>
<when trigger="someone hands you a 'places to get backlinks' list">the "Reading a third-party list" section of references/instant-publish.md — a Dofollow column is an assertion about a platform, never an observation of a link</when>
<when trigger="the ask is about paid placement">references/paid-platforms.md</when>
<when trigger="the ask is about getting pages into an index rather than getting a link">references/index-submission.md</when>
<when trigger="about to reject a target on quality grounds">references/acquisition-doctrine.md</when>
<when trigger="BacklinkDirs eligibility">references/backlinkdirs.md</when>
<when trigger="the user wants a ready-to-copy prompt">references/prompts.md</when>
<when trigger="whose work is this built on">references/credits.md</when>
</escalation>

<output-contract>
<item n="1">data sources and authorization boundary</item>
<item n="2">candidates by type, and the reason for qualification or rejection</item>
<item n="3">current ledger state, never an inferred later state</item>
<item n="4">evidence links or local evidence files</item>
<item n="5">the next safe action, and whether human review or submission is required</item>
</output-contract>

<install>
Source: [Skills.sh](https://skills.sh/yan-labs/yan-skills)
<cmd><![CDATA[
npx skills add yan-labs/yan-skills --skill opencli -g -y    # install this FIRST
npx skills add yan-labs/yan-skills --skill backlink -g -y   # first install
npx skills update backlink -g -y                            # update
]]></cmd>
For a project-level install omit `-g`; update with `npx skills update backlink -p -y`.

**`opencli` comes first.** Every browser action in this Skill runs through it, and
it carries the rules this Skill only summarises.

It also requires the OpenCLI binary **and browser extension** from
[yan-labs/OpenCLI releases](https://github.com/yan-labs/OpenCLI/releases/latest) —
**not the Chrome Web Store build**. The store build defaults to foreground: it raises
a window and steals the tab the person is reading. That failure is silent — commands
still succeed, only the behaviour is wrong — so `opencli doctor` flags an extension
older than 1.0.32 explicitly. **When it does, act on it rather than working around it.**
</install>

</skill>
