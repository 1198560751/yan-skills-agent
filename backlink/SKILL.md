---
name: backlink
description: OpenCLI-first backlink discovery, profile analysis, opportunity qualification, safe browser-assisted form filling, evidence-based verification, and bulk data harvesting from logged-in dashboards. Use for backlinks, external links, competitor link research, blog-comment opportunities, directory submissions, Similarweb/Semrush/Ahrefs discovery, Search Console verification, anchor analysis, toxic-link review, disavow review, outreach templates, scraping SaaS report tables that have no API, driving the owner's logged-in Chrome from a script, or Chinese requests such as 反链、外链、找外链、发外链、评论外链、外链分析、抓后台数据、导出报表、数据面板、数据勘测.
---

<skill name="backlink" version="3.2" body-format="xml">

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
│   ├── similarweb-query.mjs        performance | channels | similar-sites
│   ├── similarweb-batch.mjs        bulk traffic screen — one login, N domains, resumable
│   ├── semrush-batch.mjs           same, on the other card's quota (organic traffic)
│   ├── semrush-overview.mjs        AS / organic traffic / ref-domains / keywords
│   ├── semrush-keyword.mjs         one keyword: volume, KD, CPC, per-country split
│   ├── semrush-report.mjs          the OTHER four no-export reports; reuses one session
│   │                               table reports paginate — pass --all-pages or it warns
│   ├── page-read.mjs               render a public page → text, prices, paywall shape
│   ├── apply-traffic-screen.mjs    write verdicts back into submission-targets.json
│   ├── inspect-page.mjs            dump one target's form / login / CAPTCHA state
│   ├── safe-fill.mjs               fill a reviewed payload, never submit
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
  `scripts/third-party-list-ingest.mjs` to normalise and diff it, then the
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
`defaultSession(base)` from `scripts/opencli-core.mjs`; in shell use
`SESSION="backlink-$$"`.
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
<law-ref id="one-session-one-tab"/> a three-page job needs three names. So
`backlink-probe-$$` used for all three pages obeys this law's letter and breaks
Law 1. Vary both: `backlink-probe-p1-$$`, `-p2-$$`, `-p3-$$`.
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
Request foreground only when the user explicitly wants to watch. If a site
cannot be operated without stealing focus, stop and report that constraint.
</exception>
</law>

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

**Raise your shell timeout before a batch, not after it fails.** A panel launch
costs 20–40s and each report ~15s, so five domains or a dozen keywords in one
call runs for minutes and a two-minute default kills it mid-flight. The scripts
write incrementally so nothing is lost, but the run still has to be restarted.

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
S="explore-pricing-$$"
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

node scripts/harvest-commenters.mjs --session "discovery-$$" --url https://example.com/article --out .backlink/commenters.json
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
S=semrush-recon-$$                       # descriptive + unique; never a bare constant
node scripts/semrush-report.mjs --session $S --report keyword --keyword 'grid maker' --db us
node scripts/semrush-report.mjs --session $S --report backlinks-overview --domain rival.com
node scripts/semrush-report.mjs --session $S --report organic-positions --domain rival.com --db us
opencli browser $S close
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
page is fillable only when there is one unambiguous qualifying form and no
detected CAPTCHA/login wall.
<cmd><![CDATA[
node scripts/inspect-page.mjs --session "inspect-$$" --mode comment \
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
node scripts/safe-fill.mjs --session "fill-$$" \
  --scan .backlink/scan.json --payload .backlink/payload.json
]]></cmd>
It revalidates the URL, form identity, field semantics, login state, and CAPTCHA
state, installs a submit guard, and never submits. The human reviews the
rendered page and performs final submission. Only after the user explicitly
authorizes one exact reviewed submission may the agent run
`release-submit-guard.mjs` — and releasing the guard still does not click
Submit.
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
