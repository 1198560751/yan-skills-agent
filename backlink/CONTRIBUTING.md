# Contributing to the backlink Skill

This Skill is an open, shared database of **places where a link can actually be
published**, split into free channels and paid platforms. Pull requests are
welcome and are the point — one person can only verify so many channels, and
this genre decays fast enough that a list nobody maintains is worse than no list
at all.

Please read the one rule below before anything else.

## The one rule: record what you observed, never what you assume

The only thing that makes this database worth more than the dozens of
copy-pasted "500 free backlink sites" lists is that **every row here was seen in
a live page**. The moment unverified entries get in, and nobody can tell which
rows are observation and which are guesswork, the whole table's value does not
shrink — it goes to zero.

So: **a real entry rejected is a small loss; an unverified entry accepted is a
large one.** When you are not sure, open a PR with `status: "unverified"` and
say what you could not check. That is a genuinely useful contribution.

Concretely, do not write:

- a `rel` value you did not read out of the DOM;
- `indexable: true` without having looked at the `robots` meta **and** the
  `X-Robots-Tag` response header of the page carrying the link;
- "works / dead / no anchor" based only on `curl`. Many sites are
  client-rendered, and others answer 403 to scripted requests while serving
  browsers normally. **Plain HTTP can confirm that something IS present; it can
  never confirm that something is absent.** Negative claims need browser
  evidence, and the validator enforces this.

## What a good contribution looks like

Ranked by how much they help:

1. **A trap.** A failure mode that produces a *plausible but wrong* result — a
   form that returns HTTP 200 and saves nothing, an editor whose value must be
   set through its own API, a bot check that only instantiates on submit. These
   save other people entire wasted campaigns. Adding one trap to an existing
   record beats adding a new record.
2. **A status correction.** A channel that died, started requiring an account,
   added a CAPTCHA, or went `noindex`. Decay is the main way this database goes
   wrong, and you are the only one who will notice.
3. **A verified new channel**, with evidence.
4. **A price check** on a paid platform, with the date you checked.

## How to submit

```bash
git clone https://github.com/yan-labs/yan-skills
cd yan-skills/backlink

# edit data/free-channels.json or data/paid-platforms.json

node scripts/validate-data.mjs      # must pass — CI runs exactly this
```

Then open a PR. In the description, say **how you verified it** — browser or
HTTP, what you saw, and ideally a link to a live page carrying a real
placement. A PR that adds rows without saying how they were checked will be
asked for that before anything else.

One channel or one correction per PR where practical. It keeps review honest.

### Never commit

- `.env`, tokens, cookies, session identifiers, or any credential. The
  repository ignores `*/.env`; do not work around that.
- Your own client's or employer's domain in `data/paid-platforms.json` — the
  registry merge script takes `--exclude-subject` for exactly this reason.
- Scraped personal data, or private URLs that were never meant to be public.

## Data model

Two files, two purposes. Both live in `data/`, both have a JSON Schema in
`data/schema/`, and both are checked by `scripts/validate-data.mjs`.

### `data/free-channels.json` — publish at no cost

The fields that carry the weight:

| Field | Why it matters |
| --- | --- |
| `account` | `none` is the whole reason this file exists. Note that **"free" and "no registration" are different claims** — platforms conflate them, and at least one advertises a $0 fee behind a submit button that is literally labelled *Login*. That is `account: "required"`, not `"none"`. |
| `captcha` | `passive` clears itself in an ordinary browser with no user action. `interactive` means a real challenge; those are recorded as rejected. **This project does not solve or bypass CAPTCHAs.** |
| `anchorRendered` | Some platforms publish your URL as a plain text node. Those are worth nothing. Record `false` — do not omit the field and do not quietly drop the channel. |
| `relObserved` | The exact strings from the DOM. An empty string in the array means an anchor with no `rel` at all, i.e. dofollow. Omit the field entirely if you never checked. |
| `robotsObserved` | The exact `robots` meta content, or `null` when the tag is absent (absent means indexable). A page that links to you but cannot be indexed is not a win. |
| `scope` | `engine` means one codebase across many independent hosts. Engine records describe **mechanics only**. Per-host settings — `robots`, anti-bot questions, moderation — must be probed per host. A single-host sample once produced exactly the wrong generalisation here, so the validator rejects `scope: "engine"` combined with `indexable: true`. |
| `traps` | The highest-value field. See above. |
| `status` | `live` / `changed` / `dead` / `rejected` / `unverified`. `rejected` means it technically works but is disqualified — always give a `rejectReason`. |
| `lastVerifiedAt` | Anything `live` and older than 180 days gets a staleness warning. Re-verify or downgrade to `unverified`; do not just bump the date. |

**Dead records stay.** Set `status: "dead"` rather than deleting the row, and
never reuse an `id` for a different channel — the history would then point at
the wrong thing. The validator enforces id uniqueness.

### `data/paid-platforms.json` — observed paid placement

This one is generated and merged by `scripts/paid-platform-registry.mjs` from
real backlink profiles, then annotated by hand. The column that matters is
`observedSites` — how many independent sites were seen placing links there.
A platform that keeps reappearing across unrelated subjects is one that is
actually being used; a platform seen once is an anecdote.

Tiers: `paid-listing` (a real directory charging a listing fee) ·
`link-package` (the offer is stated **in link count**) · `free-with-account` ·
`spam-net` (**blacklist**) · `not-a-platform` (a sitewide widget, genuine
editorial coverage, or an injection — big numbers, not an opportunity) ·
`unverified` (the default).

Never infer a price. Open the pricing page, fill in `price`, and fill in
`priceCheckedAt` — the validator requires the date, because a price without one
gets quoted as current long after it stops being true.

**Recording is not recommending.** This file exists so the decision is
*informed*. Whether to buy is the site owner's call. Do not relabel a
`link-package` as a "directory submission" to make it sound acceptable.

## Scope and conduct

Contributions are declined, regardless of technical merit, for: link farms and
auto-generated link networks; adult or malware surfaces; anything requiring a
CAPTCHA, login, paywall, or quota to be bypassed; hidden or cloaked links; and
channels whose live content is saturated with spam — that last one is a safety
judgement, and it is only visible if you read the neighbourhood before adding
the row.

Placement content is expected to be genuine and specific to the page it sits
on. Bulk-identical comments get deleted by moderators in batches, which wastes
the channel for everyone who comes after you. That is a practical argument, not
a moral one, and it is why these records track *mechanics* rather than supplying
templates to blast.
