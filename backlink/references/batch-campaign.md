# Running a submission campaign at batch size

This Skill was built around **one target at a time**: inspect, fill, review,
submit, verify. That is the right unit for a comment on an article. It is the
wrong unit for 300 directory rows, and the difference is not "do the same thing
faster" — a batch has failure modes a single submission does not have: the same
site submitted twice, the whole run stalled behind the first CAPTCHA, an
interrupted run that cannot tell completed work from unstarted work, and a final
report that counts forms instead of links.

Most of this file is absorbed from **[flaqai/backlink_skills]** (MIT), whose two
`submit-product-directories-*` Skills are a campaign-operations layer rather than
a channel list. Credited in full in [SKILL.md](../SKILL.md#credits). Where their
rule and ours already agreed, ours is kept and theirs is noted as confirmation
from an independent operator.

## The queue is built before the browser opens

Deduplication after the browser is open is deduplication that already cost a
submission. Build the whole queue first:

1. **Normalise** the route. Strip tracking parameters from the stored record;
   keep required route parameters (`?c=1&LINK_TYPE=1` is part of the address, not
   noise) in the evidence copy.
2. **Derive an idempotency key** from `platform domain + canonical product ID +
   account alias + route`. Not the URL — the same directory reached through two
   different submit paths is one submission, and the same domain submitted under
   two different products is two.
3. **Refuse to execute a key** that is already `submitted`, awaiting approval,
   `public`, or **outcome-unknown**. Unknown is the important one: re-running an
   ambiguous case is how a directory gets a duplicate listing and a ban.
4. **Assign stable queue IDs and shards.** Shard size and maximum concurrent tabs
   are operational settings — how much a browser and an operator can hold. They
   are **not** SEO safety thresholds, and must never be described as "a safe
   number of links per day". There is no such number to know.
5. **Classify every row up front** into `direct form`, `account required`,
   `manual verification`, `email verification`, `paid/reciprocal`, `unavailable`,
   `ineligible`, `unknown`. The classification decides the pipeline, and the
   classes have wildly different costs per row.

## Verification-first: never let the first CAPTCHA stall the run

The naive order — open a site, fill it, hit a CAPTCHA, stop — serialises the
entire campaign behind human availability. Invert it:

1. Run a **read-only preflight over the whole shard** before typing a single
   product field.
2. Surface the earliest CAPTCHA, Turnstile, image code, email check, or login
   wall on each row.
3. Attempt only the site's own ordinary verification. Never bypass, outsource, or
   weaken a safeguard — that rule is in
   [safety-policy.md](safety-policy.md) and it does not relax at scale.
4. Move every blocked row into **one manual queue** and keep processing the rest.
   The user clears that queue in a single pass instead of being interrupted N
   times.
5. When the queue comes back, **recheck token validity and process the
   short-lived ones first.** Email confirmation links and session tokens expire
   while the batch is running; the row that was cleared first is the one most
   likely to have gone stale.

Note the interaction with a trap already in [field-notes.md](field-notes.md):
landing-page CAPTCHA scans give false negatives, so the preflight is a
prioritiser, not a guarantee. A row classified `direct form` can still produce a
challenge at submit time; it goes into the same manual queue when it does.

## Authorization is per action, not per campaign

A campaign-level "go ahead" does not authorise everything inside the campaign.
Keep these separately authorised, each one named explicitly:

| Action | Why it is its own gate |
| --- | --- |
| Create an account | Creates a durable identity the owner now has to manage |
| Accept terms | A legal commitment the agent cannot evaluate |
| Upload assets | Publishes owner-controlled material |
| Final submit | The irreversible one |
| Any payment | Money, and paid links change the required `rel` |
| Reciprocal link / site change | Modifies the owner's own production site |
| DNS or verification-record change | Infrastructure, and outlives the campaign |

Batch-scoped authorization is usable only when it names **the allowed actions,
the source-list scope, the approver, the approval time, and an expiry**. An
approval without an expiry is not a batch approval; it is a standing grant nobody
decided to give.

## Distinct states so an interrupted run can resume

Our ledger chain is `candidate → qualified → drafted → filled → submitted →
public → indexed@<engine> → rel_verified`. A batch needs the off-chain states
too, and they must be distinguishable from each other:

- `draft-saved` — the site kept a draft; resuming means editing, not re-filling.
- `awaiting-verification` — in the manual queue, blocked on a human.
- `awaiting-approval` — submitted, the site moderates before publishing.
- `outcome-unknown` — **the dangerous one.** The final action was taken and the
  result was not observed. It is not a failure and must never be retried
  automatically.
- `transient-failure` — safe to retry, because nothing was submitted.
- `excluded` / `ineligible` — terminal, with the reason recorded.

**Never retry an ambiguous final action.** Check the account backend, the
mailbox, and the public page first — in that order, because the public page is
the slowest to update and the backend is the most authoritative about what the
site believes it received.

Write the result **before** advancing the queue cursor. A cursor ahead of the
record is indistinguishable from work that was never done.

## What counts as evidence of a submission

Insufficient, every one of them: a click, a completed registration, a saved
draft, a form that cleared itself, a generic thank-you URL. Each of those is
evidence that *you* acted, and the ledger records what the *site* did.

This is the same rule as the Skill's `submitted` bar, stated from the other
direction, and it is worth having both: at batch size the tempting shortcut is to
treat "the form went away" as success across 300 rows at once.

## Product facts come from a source, never from the model

Maintain an approved product profile before the campaign: exact brand spelling,
canonical URL, category, contact alias, approved description variants **by length
band** (most directories want 50 / 150 / 500 characters and will truncate
silently), and approved assets.

- Reuse the approved variants; never regenerate prose per site.
- Never invent founder, pricing, address, launch date, user count, ownership,
  legal, or contact facts. Not even plausible ones — a directory listing is a
  public record that outlives the campaign.
- Leave **optional** unknowns blank. Mark **required** unknowns
  `blocked — missing verified data` and stop that row. A blocked row is a
  question for the owner, not a gap to fill.

## Anchor text policy

Use the brand, the product name, or the naked canonical URL. Nothing else.

- Never request dofollow treatment. Asking marks the placement as manipulated
  even when the link would have been followed anyway.
- Never use repeated commercial exact-match anchors across a campaign. One
  keyword anchor is a link; two hundred is a pattern.
- A paid or incentivised placement **requires** `sponsored` or `nofollow`. If it
  publishes as a plain follow link, record the placement as **noncompliant** —
  it is not an acceptable listing just because it appeared.
- Record the actual public anchor, `href`, `rel`, and whether the relationship
  was commercial or reciprocal, after publication. Recording the anchor you
  *submitted* is recording your intent, not the outcome.

## Fanning the screen out across parallel agents

Screening is the one stage that parallelises cleanly — each row is independent
and network-bound. Three failure modes showed up the first time this was run
five-wide, and all three are cheap to prevent in the brief:

**Scratch filenames collide.** Parallel agents share one scratch directory, so
two of them writing `chunk1.json` silently overwrite each other's work. It was
caught only by diffing the finished domain set against the input. **Give every
agent a distinct output path and require every temp file to carry its slice
number.** This is the same failure as two browser tasks picking one session name
(see [SKILL.md](../SKILL.md)) — shared namespace, no error, wrong data.

**An agent will background the batch and then wait forever.** Nothing wakes it,
the turn ends on idle, and the task finishes having written nothing. Two
sentences in the brief prevent it: *run the work synchronously in foreground
calls, chunked; a call may run for minutes, so raise its timeout rather than
backgrounding it* and *rewrite the output file after every chunk so a partial
result survives an unexpected stop.* The second one paid for itself immediately —
every agent's file was readable and growing throughout the run.

**Verify the returned count against the input.** An agent's own summary is not
evidence that every row was processed. Diff the domain sets.

What to hand an agent is the judgement, not the fetching: following a route to
the real submission page, deciding what a page *is*, reading what a price
actually buys. The mechanical sweep belongs in a script — it is faster, it is
consistent across rows, and its heuristics can be fixed once instead of
re-invented per agent.

## Records: aliases in the shareable file, secrets nowhere

Split the campaign record in two:

- **Shareable record** — queue state, domains, routes, outcomes, public URLs,
  observed anchors and `rel`. Uses **aliases** (`account: owner-primary`) and
  controlled-evidence IDs.
- **Controlled evidence** — screenshots and raw captures, stored separately.

Never in either: passwords, OTPs, recovery codes, cookies, OAuth parameters,
magic links, raw session IDs, raw email addresses, phone numbers, or tokenised
URLs. A magic link in a campaign log is a live credential in a file people paste
into chat.

## Reporting: forms and links are different numbers

Report published listings **separately** from submitted forms, always, and lead
with the smaller one. Then:

- totals by queue state, verification state, shard, and outcome;
- queue completion rate, duplicate avoidance, recovery rate after interruption,
  and the size of the unresolved manual queue;
- verified submissions per operator hour, if throughput is the question.

**Never present submission volume as evidence of SEO value.** "We submitted to
300 directories" is a statement about labour. The only sentence that describes
the outcome names observed anchors on live pages.

### Traffic numbers need six fields or they are not numbers

A figure like `4.84M` with no provenance is unusable within months and
actively misleading after that. Store, or do not store at all:

`source · metric · month · geography · device · date verified`

The list that prompted this rule carried undated per-site traffic values; when
its own maintainers rechecked three of them against the same public tool, all
three had drifted 20–30% and one by more. They then deleted every unsourced
figure, which was the right call. Do the same rather than carrying a number that
looks like evidence.

[flaqai/backlink_skills]: https://github.com/flaqai/backlink_skills
