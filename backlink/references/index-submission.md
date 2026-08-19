# Index submission — the channels that publish no link

**Nothing in this reference produces a backlink.** An index-submission channel
hands a URL to a search engine and gets nothing back but a confirmation string.
It is in this Skill for two reasons, and neither of them is placement:

1. **The verify stage was under-specified.** The state machine ends at
   `indexed`, and it never said *whose* index. Every promotion to `indexed` in
   practice came from Search Console or a Google/Bing `site:` query — one
   family of crawlers standing in for "the web".
2. **An engine outside IndexNow gets nothing from the automated push.** The
   usual "ping IndexNow after deploy" wiring reaches Bing, Yandex, Seznam and
   Naver. An engine with its own crawler and no IndexNow membership is simply
   not in that list, and no amount of deploying moves it.

Records live in [`data/index-submission.json`](../data/index-submission.json),
validated by the same `scripts/validate-data.mjs` gate as everything else.

## Do not merge this into `free-channels.json`

That file's contract is *a place that publishes a link*: every row must answer
`anchorRendered` and, when checked, `relObserved`. Those two questions are
meaningless here — there is no anchor, because there is no page. A submission
form filed as a channel would read, to anyone querying the data later, as one
more place we got a link. The Skill's standing rule already covers it: **do not
record a submission as a backlink.** This file is how that rule survives contact
with a genuinely useful channel that happens not to be one.

## Why this is a GEO channel, stated precisely

The reason to care about a second index is not its own result page — for most
engines here that traffic is a rounding error. It is that **an independent index
is a grounding source for AI answers**, and a page missing from the index is
missing from every answer built on it.

Keep this argument tied to what the operator publishes about itself. Brave's own
API page is explicit that the index is not a scraper over Google or Bing but its
own, and sells it for grounding chatbots and AI search — that is a citable
claim with a URL behind it, which is why the schema requires `aiGrounding.source`.
What must **not** go in: "assistant X uses index Y". Those pairings change
quietly, are rarely confirmed by either party, and turn the field into folklore.

## The measurement that justifies the work

Before submitting anything, get the baseline, because without it the campaign
can never be judged:

```
site:<domain>  on the target engine   →  how many pages it already has
Search Console / Bing coverage        →  how many pages Google/Bing have
```

A wide gap is the signal. On the one site measured so far the gap was **1 versus
37 of 38** — not a crawl-delay story, an entire engine we had never touched.

Then **recheck after**, and record the outcome either way. A submission channel
that moves nothing is a finding worth as much as one that works; without the
recheck this is 38 manual operations justified by a hunch.

## Writing it down afterwards

Qualify every index claim with the engine: `indexed@google`, `indexed@brave`.
The `id` in the data file is the qualifier. An unqualified "indexed" is a claim
about the whole web made from one crawler's opinion.

Do not retroactively rewrite old ledger entries — the cost exceeds the value and
the reading is recoverable from the evidence note. Qualify new ones.

## Per-engine mechanics

Read the `traps` array on each record before automating anything. The Brave form
is documented there in full; the shape of its traps generalises past it:

- **A synthesised `click()` may not submit.** A passive human check can require
  a trusted event. Injecting the field value programmatically is usually fine —
  it is the click that has to be real. This is not CAPTCHA bypass and must never
  become it: the check runs normally and clears itself, or the channel is
  rejected.
- **Enter is not a submit button.** Verify, do not assume.
- **A passive check takes seconds.** Navigating away during it discards the
  submission with no error. Wait for the confirmation text.
- **Success may disable the form permanently.** One URL per page load.
- **Our own network log is not the judge.** After an in-page reload, request
  logging can stop recording while submissions keep succeeding. The judge is the
  target's own confirmation string — the same rule that governs the placement
  workflows.

## What is not in here yet

Only engines that were actually operated get a record. Other independent indexes
exist — Brave's own result page offers Mojeek alongside Google and Bing — but
**whether they have a submission endpoint at all is unchecked**, and an
unverified row is worth less than an absent one. Check one, operate it, then add
it.
