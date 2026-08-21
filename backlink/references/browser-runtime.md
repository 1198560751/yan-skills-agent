# Browser runtime: which driver, and the laws that keep parallel work honest

This Skill drives the owner's own logged-in Chrome. That single fact decides the
driver, and most of the expensive failures in this file come from someone
forgetting it. Read this before any browser work; SKILL.md carries only the
laws, and this file carries the measurements behind them.

## Contents

- [Why OpenCLI, and why it is the portable choice](#why-opencli)
- [Law 1 — one session, one tab](#law-1)
- [Law 2 — the multi-tab API inside a session is broken](#law-2)
- [Law 3 — never hardcode a session name](#law-3)
- [Law 4 — claim your handles before you start work](#law-4)
- [Background mode is not headless](#background)
- [The other two drivers, and what they cost](#other-drivers)
- [Diagnosing "something stole my tab"](#diagnosing)

---

<a id="why-opencli"></a>
## Why OpenCLI, and why it is the portable choice

OpenCLI reaches the owner's Chrome through a **browser extension plus a local
daemon**. Nothing about that path is specific to the agent runtime calling it —
it is a CLI, so Claude Code, Codex, or any other agent that can run a shell
command gets the identical capability. That portability is a real requirement
here, not a nicety: the same backlink work gets run from different runtimes, and
a driver that only exists inside one of them would strand half the work.

The alternative paths do not clear that bar:

| Driver | Reaches the owner's logged-in Chrome | Usable from any agent runtime |
|---|---|---|
| **OpenCLI** | yes — extension + daemon | **yes**, it is a CLI |
| agent-browser | no on current Chrome (see below) | yes, it is a CLI |
| Claude in Chrome | yes — its own extension | no, Claude-only MCP |

So: **OpenCLI is the default for everything**, including quick ad-hoc looks at a
page. Reaching for a runtime-specific tool for exploration means the exploration
cannot be replayed from a script or from another agent later, which is the whole
reason this Skill has scripts at all.

---

<a id="law-1"></a>
## Law 1 — one session, one tab

`opencli browser <session>` is a **one-page abstraction**. A session name owns
exactly one tab. Different names never steal from, switch, or pollute each
other, and each session's `tab list` shows only its own tab.

Measured 2026-08-19 on opencli 1.8.6:

```bash
opencli browser isoA --window background open https://example.com/
opencli browser isoB --window background open https://example.org/
opencli browser isoA --window background open https://example.net/
# isoA -> https://example.net/    isoB -> https://example.org/
```

`isoB` was untouched by `isoA`'s second navigation, and neither `tab list` could
see the other's tab.

Re-measured 2026-08-21 under three concurrent agents, which is the case that
actually matters. Three agents each given a distinct session name recorded
**zero cross-agent thefts** across 4 rounds × 3 pages. Three agents sharing the
name `work` recorded 3, 12, and 2 thefts respectively — one of them missed on
every single check it made.

**So N pages need N session names.** This is the single most load-bearing rule
in this file, and it inverts the intuition most people arrive with.

```bash
# Correct: three pages, three names. Verified twice — 9/9 solo, then 36/36
# across three concurrent agents following this rule, with zero tab leak.
opencli browser recon-sw-notion  --window background open "https://..."
opencli browser recon-sw-figma   --window background open "https://..."
opencli browser recon-sem-rival  --window background open "https://..."
```

---

<a id="law-2"></a>
## Law 2 — the multi-tab API inside a session is broken

Do not reach for `tab new`, `tab select`, or `open --tab` to hold several pages
under one session name. All three fail, and every one of them fails **silently**
— the command reports success and the next read returns the wrong page.

Measured 2026-08-21 on opencli 1.8.6:

| Call | Documented intent | What it actually does |
|---|---|---|
| `tab new <url>` | open a tab, return its id | opens the tab and returns an id, but the session then tracks **only its newest tab**; earlier ids fall out of `tab list` |
| `tab select <id>` | make that tab the target of later calls | returns `{"selected": ...}` success and has **no effect on reads** |
| `open <url> --tab <id>` | navigate that tab | opens a **new tab** instead, leaving the named one untouched |
| `get url` | read the current page | **`get` does not accept `--tab` at all** — it always reads the globally active tab |

`--tab` is accepted by `open`, `state`, `extract`, `find`, and `click`, and
refused by `get` and `tab`. A run holding several pages under one session and
using `get url` to confirm where it is has no way to be right about it.

**Do not over-correct.** Under Law 1 a session owns exactly one page, so there
is nothing to disambiguate and plain `get url` is safe — it is the simplest
confirmation read there is, and the objection above does not apply to it. Three
independent testers each named this paragraph as the one most likely to be
misread; one of them nearly threaded a `--tab` id through an entire job to obey
a rule that did not apply to it. Reach for `state --tab <id>` only when you
genuinely have several pages in one session, which Law 1 says you should not.

The observable damage from one three-agent run: the owner's Chrome went from 11
tabs to 30, all orphans, none of which the CLI could still address. The
reconstruction afterwards showed three tabs created by `tab new` that were never
navigated at all, three extra tabs conjured by `open --tab`, and one tab the
session still acknowledged.

**Use `state --tab <id>` when you need a read that names its target**, and
prefer one session per page so the question does not arise.

---

<a id="law-3"></a>
## Law 3 — never hardcode a session name

"Another task stole my tab" is never the CLI round-robining. It is always **two
tasks that picked the same session name**.

The single most common source of that collision is documentation. `opencli
browser --help` opens with `opencli browser work open https://x.com`, so every
agent that copies the example ends up on `work`. Expect this: an agent that
reads these laws and *then* checks `--help` for syntax will watch the tool model
the exact anti-pattern it was just warned about. Trust the law.

A name also needs **two** distinguishing parts and it is easy to ship only one.
The suffix separates your task from other agents; it does nothing to separate
your own pages from each other. By Law 1 a three-page job needs three names, so
`backlink-probe-$$` reused for all three obeys this law's letter while breaking
Law 1. Vary both: `backlink-probe-p1-$$`, `-p2-$$`, `-p3-$$`.

This Skill caused the same failure itself: `scripts/tools-share-open.mjs` once
defaulted to the literal session `backlink-panel`, two concurrent tasks each ran
it, and each read back pages the other had opened.

In JS, never hand-roll the suffix — `scripts/opencli-core.mjs` exports
`defaultSession(base)`, which applies it and validates the result:

```js
const session = flags.session ? validateSession(flags.session) : defaultSession('backlink-work');
```

The suffix resolves `OPENCLI_SESSION_SUFFIX` → `CLAUDE_CODE_SESSION_ID` →
`CLAUDE_CODE_HOST_SESSION_ID` → pid. **Never key off the HOST id directly**: it
is per desktop-app host and shared by every conversation running inside it, so
it hands parallel tasks the same tab. `CLAUDE_CODE_SESSION_ID` is per
conversation, which is the unit that actually runs concurrently. Verified
present in a live session:

```
CLAUDE_CODE_SESSION_ID=8bbc2d3d-...        per conversation
CLAUDE_CODE_HOST_SESSION_ID=local_55a8...  shared by the whole app
```

**Subagents inherit the parent's environment**, so several agents spawned inside
one conversation resolve to the same default. When fanning browser work out
across parallel agents, give each an explicit `--session` or a distinct
`OPENCLI_SESSION_SUFFIX`. In shell, `SESSION="backlink-$$"`, never a bare
constant.

Make names **describe the work** rather than merely being unique:
`backlink-probe-<suffix>` beats `bl-1`. The session name is the only identifier
that exists, so a unique but meaningless name still leaves you unable to answer
"whose tab is this".

**The Chrome tab group is not an identifier.** Every session's tabs land in a
group carrying the same extension-supplied label, and there is no way to change
it from here — no flag on `browser`, `open`, or `tab`, nothing in `opencli
--help` or `opencli profile`, and no `chrome.tabGroups` call anywhere in the CLI
package. `tab list` does not report the group either. So never ask a person to
tell tasks apart by looking at the tab group: watching one group fill with tabs
from three tasks is exactly what a collision looks like from the outside, which
makes a healthy run look broken and a broken run look healthy.

Release the lease with `opencli browser <session> close` when done. A session
left open leaves a tab in the owner's Chrome that looks exactly like live work
somebody else is doing.

---

<a id="law-4"></a>
## Law 4 — claim your handles before you start work

Every driver tested shares one race window: the stretch between creating a page
and holding a stable handle to it. Two independent runs lost pages in exactly
that gap — one agent had both of its pages clobbered before it finished creating
them, because a bare `open` with no established handle resolves against whatever
the shared notion of "current" happens to be at that instant.

So open **all** the sessions you need up front, capture every handle, and only
then start the work loop. Interleaving creation with use is what turns a
theoretical race into a reproducible one.

---

<a id="background"></a>
## Background mode is not headless

Default every session to background mode. The flag sits **between the session
name and the subcommand** — `opencli browser <session> --window background
<command>`.

Placed **before** the session name it fails with `unknown command:
<yoursession>`, which reads like a broken install rather than a syntax error.
Placed **after** the subcommand it **works** — re-measured 2026-08-21, and the
CLI's own `--help` prints that trailing form as its second example.

An earlier revision of this file claimed both positions fail. A tester falsified
it with one command, and then said the surrounding laws had become harder to
trust — which is the right reaction and the reason this correction is written
out rather than quietly edited. Prefer the between form for consistency across
this Skill; do not read the trailing form as a bug in someone else's script.

Background mode runs the owner's real, logged-in Chrome without raising the
window. Measured probes inside a background session:

| Probe | Value |
|---|---|
| `navigator.webdriver` | `false` |
| UA contains `Headless` | no |
| `navigator.plugins.length` | 5 |
| `document.visibilityState` | `visible` (background windows are not throttled) |
| `window.outerWidth × outerHeight` | 1364 × 806 |

So "background mode will trip the site's bot defences" is not a real concern —
every headless tell reads negative. There is never a reason to reach for
foreground to look more human.

**Neither mode steals focus.** Nine concurrent agents across three drivers
checked the frontmost application before and after every navigation on
2026-08-21; the host app stayed frontmost in every single check, and
`--window foreground` and `--window background` showed no observable difference
on this axis. If a person reports the screen "jumping around", the cause is
several tasks writing to one shared page, which looks like thrashing and is
really Law 1 being violated. Request foreground only when the user explicitly
wants to watch. If a site cannot be operated without stealing focus, stop and
report that constraint.

---

<a id="other-drivers"></a>
## The other two drivers, and what they cost

### agent-browser — cannot reach the owner's Chrome on current Chrome

`agent-browser` attaches over the Chrome DevTools Protocol. Two independent
walls make that impossible for the owner's everyday browser, verified
2026-08-21 on Chrome 151.0.7922.173:

1. **Chrome 136+ silently ignores `--remote-debugging-port` on the default
   user-data-dir.** Chrome was relaunched with the flag and `ps` confirmed it was
   passed; `lsof -nP -iTCP -sTCP:LISTEN -a -p <pid>` then showed **no listening
   port at all**, and 9222 was unreachable. Relaunching Chrome is wasted effort —
   do not suggest it.
2. **macOS TCC blocks reading `~/Library/Application Support/Google/Chrome`**, so
   copying the profile out is also closed. `agent-browser doctor` reporting
   `no profiles parsed` is this, not a misconfiguration.

Its `--profile` flag means a **separate profile directory it creates and you log
into once**, unrelated to the owner's existing sessions.

So use it only when the task needs **no** logged-in identity — public pages,
large batches where its isolation is worth the cost. Its isolation is genuine
and server-side: `--session` gives each agent a **whole separate Chrome
process** (measured: process count went 2 → 5 for three agents), with zero
visibility into the others' tabs and zero thefts across 4 rounds × 3 pages × 3
agents. That is the strongest isolation of the three, bought with the most
resources.

Two traps if you do use it:

- **`t1`/`t2` tab ids are a shared positional index, not per-agent handles.**
  Two agents' `t2` resolved to the same CDP target, and the read returned the
  other agent's page **with no error**. Address tabs by `--label`, never by
  position.
- **`--pin-tab` does not fail as loudly as documented.** It errors correctly when
  you explicitly address a label that no longer exists, but a command that does
  not switch tabs — `get url`, `snapshot` — silently falls back to another of
  your own tabs. It guards against other agents, and it does not guard against
  you losing track of your own pages. Confirm identity with an explicit read
  after every navigation.

### Claude in Chrome — single-agent only, and it leaks

It reaches the owner's Chrome and is convenient for one agent looking at one
thing. It has **no isolation boundary of any kind**: `tabs_context_mcp` returns
one flat tab group shared by every concurrent agent, listing everyone's tabs and
URLs. Omitting `tabId` resolves to "the first tab in the shared group", so three
naive agents all wrote to the same physical tab — 10, 0, and 4 thefts across the
three, with the zero belonging to an agent that was overwriting everyone else
rather than being overwritten.

Passing an explicit `tabId` on every call fixes most of it (12/12, 11/12, and
10/12 clean), and it is **client-side discipline with nothing enforcing it** —
one sloppy call from any agent lands on someone else's page. A tab created
before you started passing ids explicitly stays permanently vulnerable, because
`tabId` is a bare integer with no ownership concept.

It also has a reproducible self-inflicted bug, hit by two of three agents:
**closing one of your own tabs can tear down your whole session's tab-group
tracking**, orphaning your other tabs as permanently unclosable. That is where
the leftover tabs come from after a run.

Use it for single-agent ad-hoc looks only, and prefer OpenCLI even there so the
work is replayable from a script and from other runtimes.

---

<a id="diagnosing"></a>
## Diagnosing "something stole my tab"

Work down this list; it is ordered by how often each cause is the real one.

1. **Two tasks share a session name.** Confirm with
   `opencli browser <session> tab list` — it should show only tabs you opened.
   Fix by giving each task a distinct, descriptive name.
2. **One session is being asked to hold several pages.** Look for `tab new`,
   `tab select`, or `open --tab` in the code path. Fix with Law 1: one session
   per page.
3. **A read that cannot name its target.** `get url` has no `--tab`. Replace with
   `state --tab <id>`, or rely on Law 1 so the session has only one page.
4. **Work started before handles were claimed.** See Law 4.
5. **Only then** suspect the site or the CLI.

If `eval` returns a page you did not navigate to, it is cause 1 or 2 roughly
always. Navigation reporting success followed by a read of someone else's
document is the signature.
