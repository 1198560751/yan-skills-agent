# The traffic screen: qualify a target before you fill its form

The qualifying test is **real traffic, not DR**, and it runs **before** the form
does. A directory with no measurable traffic cannot send a referral, cannot pass
a useful signal, and its DR is whatever its own network linked into it.

## The commands

```bash
# hundreds of domains, one login, ~5-10s each, resumable
node scripts/similarweb-batch.mjs --domains-file domains.txt --out sw.jsonl
node scripts/semrush-batch.mjs   --domains-file domains.txt --out sem.jsonl

# write verdicts back into the table (repeatable --in; clears stale ones)
node scripts/apply-traffic-screen.mjs --in sw.jsonl --source similarweb
node scripts/targets-select.mjs --cohort open --min-traffic 100
```

`traffic >= 100` monthly visits qualifies.

## Budget by quota, not by clock

Amortising the login gets a domain down to ~5s, which makes "a few hundred in
half an hour" look right. It is not: the panel's *API 今日配额* went from 13% to
100% at around domain 110, and every call after that timed out —
indistinguishable from a dead session, and the launcher's own error message
sends you off to change nodes.

Plan on **~120 domains per card per day**. Quota is per card, so when Similarweb
is spent, Semrush usually is not — switch and keep going, but record which one
measured each row. Similarweb reports *total visits* and Semrush reports
*organic traffic*; those are not the same number, which is what `traffic.source`
exists for.

Both batch scripts break the circuit after 5 consecutive errors. Without it one
dead session burned 48 domains at 60s each before anyone noticed.

## "No data" and "timed out" are opposite results

**A domain the data source explicitly reports no data for is a result, not a
tool failure** — it is below the detection floor, i.e. zero, and gets written as
`below-floor`.

**A timeout is not that result.** A slow render and a genuinely empty record look
identical at the moment the clock runs out, and they mean opposite things: two
directories with 2.4K and 4.6K organic visits were written off as "no traffic"
by exactly that confusion. Timeouts are recorded as `error`, meaning *this check
did not complete*; resume retries them, and applying an `error` **clears** any
stale verdict it previously left on that domain.

Before writing "no data", be able to name the sentence in which the source said
so.

## Do not substitute a popularity list for measured traffic

Tranco's top-1M was tried as a cheap stand-in and failed on the labelled set:
**48 of the 73 known link-farm domains sat inside it**, spread from rank 134k to
998k, so no cutoff separates a farm from a small honest directory. Popularity
rank is fed by DNS resolutions and crawler requests — exactly the signals a
network manufactures for itself, the same reason DR is worthless here.

The general rule, which outlives this particular list: **validate a proposed
gate against known-bad domains, never against famous ones.** Recognising big
sites is not the problem a gate exists to solve.

Speed is not a reason to downgrade the metric. The panel login costs ~20s and
the query itself ~5s, so amortise the login across the batch (that is all
`similarweb-batch.mjs` does) instead of reaching for a weaker free signal.

## Three field signs that a batch is one link network

Any one of these means measure first:

- one site script across the batch, with field names identical to the character;
- a promotional sentence repeated **word for word** across dozens of domains — 
  similar pricing across a niche is a market, one sentence twenty times is a
  codebase;
- DR that exists while traffic does not.

## Why the order is not negotiable

One run filled every form across a 73-domain family and only then sampled five
of them for traffic: four returned no DR and no traffic at all, the fifth scored
bottom-tier with traffic down 89% in three months and a suspected penalty. Every
filled form was discarded.

Measuring a domain costs one query. Filling its form costs two orders of
magnitude more.

Submitting to N domains of one network buys **one** link's worth of value and
accrues **N times** the footprint, because the buyer's and the seller's link
graphs are the same graph. See [acquisition-doctrine.md](acquisition-doctrine.md)
§1.1 — and note that the doctrine's "post everywhere you can" was never a licence
to skip this: it governs topical irrelevance, and it always excluded link farms
in the same breath.

## Unmeasured is not qualified

The gate only works if unmeasured rows are excluded from a batch rather than
waved through. `targets-select.mjs --min-traffic` drops them by design;
`--unmeasured` exists to list them as the next screening queue, never as a batch.
