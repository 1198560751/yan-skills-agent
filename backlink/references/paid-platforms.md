# Paid placement platforms: an evidence registry, not a shopping list

This Skill keeps a registry at `data/paid-platforms.json` of platforms that have
been **observed** carrying deliberately-placed links in real backlink profiles.
It is maintained by `scripts/paid-platform-registry.mjs`, and it accumulates
across every project and every harvest that gets merged into it.

Run it after any competitor harvest:

```bash
node scripts/paid-platform-registry.mjs merge \
  --dirs /path/to/project/.rankup/data/semrush-backlinks \
  --exclude-subject <the-site-you-work-for.com>
node scripts/paid-platform-registry.mjs list --min-sites 2
```

`--exclude-subject` is not optional in practice: the registry is shared across
clients, and the site you are working for must never be written into it.

## Why the registry is worth accumulating

A single investigation sees a few dozen domains' backlinks. That is far too
small a sample to tell "this platform is routinely used" from "one site happened
to use it once". What makes the signal usable is **repetition across
independent subjects**, which only appears after many harvests are merged.

So the column that matters is `sitesHit` — how many separate observed sites
have a placement burst on that platform. A platform that keeps reappearing in
unrelated profiles is a platform that is actually being used. One that appears
once is an anecdote.

This is why the registry lives in the Skill rather than in any one project.

## How placements are detected

**Same-day burst.** Automatic noise — domain-report pages, shorteners,
scraped syndication — arrives one link at a time with scattered dates. Only a
human submitting, or the receiving site batch-generating pages, produces a dozen
URLs from one referring domain on a single day.

## The single most misread number: bursts are not purchases

One listing is routinely rendered **once per interface language**, and often
across several domains run by the same operator. A "148 links in one day" burst
is typically **one placement × a site with many locales**, not a campaign.

Two consequences, and they point in opposite directions:

- **When estimating what a competitor spent**, count `placements`, not
  `totalUrls`. The registry tracks placements as distinct `site@date` pairs for
  exactly this reason.
- **When choosing among comparable channels**, prefer the ones that ship many
  locales — the same single success is amplified many times over. This is the
  useful half of the observation, and it applies to free channels too.

## Tiers, and what each one means

`tier` is recorded as observed. Never infer a price; open the pricing page and
fill in `price` and `priceCheckedAt`, or leave them null.

| tier | meaning |
| --- | --- |
| `paid-listing` | A real directory that charges a listing fee and reviews submissions. What is sold is the listing; links follow from it. |
| `link-package` | The offer is stated **in link count** — "N dofollow backlinks from M premium domains for a fixed fee". This is a link scheme in the plain sense, whatever it calls itself. |
| `free-with-account` | No fee, but submission requires registration. Recorded separately because "free" and "no registration" are different claims and platforms conflate them. |
| `spam-net` | Bulk networks, usually self-identifying in the domain name (`seo`, `ranking`, `boost`, `authority`, `fiverr`). **Blacklist.** |
| `not-a-platform` | A large burst that is not a purchasable channel — a sitewide widget, genuine editorial coverage plus a template link, or an injection on a compromised host. Recorded so nobody mistakes the volume for an opportunity. |
| `unverified` | Detected as a burst, pricing not yet checked. The default. |

## Reading `spam-net` correctly

Seeing one of these in **your own** profile is not an achievement — it is
untargeted blasting aimed at you by an unrelated party. They frequently appear
across several unrelated subjects at once, which is what exposes them. Do not
buy them, and do not count them.

## What this registry does and does not authorise

Recording is not recommending. This Skill's rules still exclude link farms and
paid link schemes, and `link-package` offers carry an obvious footprint — two
domains accounting for nearly a whole profile is trivially detectable, and
keyword-anchored links sold by the batch are named directly in search engines'
link-spam policies.

The registry's job is to make the decision **informed**: report the tier, the
verified price, how many independent sites were observed using it, and the
footprint risk. Whether to buy is the site owner's call, not the agent's. Do not
buy on your own initiative, and do not relabel a `link-package` as a "directory
submission" to make it sound acceptable.

## Identical wording across many domains is one operator, not a trend

The most valuable pattern a bulk price check produces is not any single price —
it is **recognising the same template twice**. Two families surfaced in one
2026-08 sweep of 648 domains:

- **~28 reciprocal web directories** (`1directory.org`, `azure-directory.com`,
  `dicedirectory.com`, `fruity-directory.com`, `johnnylist.org`,
  `lemon-directory.com`, `reddit-directory.com`, `webguiding.net`, …) all running
  one PHP/Smarty template: free submission **in exchange for a reciprocal link**,
  plus a verbatim-identical upsell — *a $0.80 sponsored link placed across
  32–90 directories*. Same sentence, same price, twenty-eight domains. That is
  one operator selling a link network, and the honest way to record it is as
  **one entry with 28 hosts**, not 28 independent opportunities. Counting them
  separately is how a report claims 28 placements for what a search engine sees
  as one footprint.
- **~11 launch platforms** (`600.tools`, `dirs.cc`, `featuredtool.com`,
  `open-launch.com`, `shipybara.com`, `launchvault.dev`, …) sharing a pricing
  template: a genuinely free tier with a stated multi-week-to-multi-year queue,
  against a cheap $2–$50 instant/featured tier. This family is the opposite
  case — the free path is real, so these belong in the free library with the
  queue length recorded, not written off as paid.

**The tell is verbatim wording, not similar pricing.** Similar prices across a
niche are a market; the same sentence across two dozen domains is a codebase.
When you find one, check the whole family before filing any of them.

