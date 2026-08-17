# Field notes: what actually blocks directory submissions

Distilled from running a full submission campaign for a brand-new site end to end.
Everything here is a rule that held across many different targets. No site names,
no metrics, no credentials — those stay in the project's own ledger.

## The three walls, in order of how often they stop you

Most people expect CAPTCHAs to be the main obstacle. They are not.

1. **Mandatory personal contact info** — a required real name, personal email, or
   phone. This is the most common blocker by a wide margin. It is not a technical
   barrier at all, which is exactly why it stops an agent: the operator has to
   decide whether to spend their identity on this listing.
2. **Account registration.** Creating accounts is out of scope; abandon the target
   immediately rather than exploring alternate paths.
3. **CAPTCHA / anti-bot.** Genuinely common, but third.

There is a fourth that looks like a wall and is not: **directories that demand a
street address, city, ZIP, or company registration.** Those are local-business or
B2B-vendor directories. A software product with no legal entity has nothing true
to put there. Record `not applicable` and move on — never invent an address.

## Landing-page scans give false negatives on CAPTCHAs

Fetching a submit page and grepping for `recaptcha|hcaptcha|turnstile|captcha`
**does not work**. Repeatedly, a landing page scanned clean and the CAPTCHA
appeared on step 2 or later — after a category picker, a terms checkbox, or an
email-gate.

**Walk the form to its final step before concluding anything about it.** Budget
for this: a "quick scan" of N targets is not a real qualification pass.

## Free tiers are priced in time, and that is the product

Free listings routinely carry multi-month review queues, with a paid tier that
skips the line. This is the business model, not a malfunction, and it means:

- A free-tier submission today is not a link for months. Set that expectation
  before the campaign, not after.
- **Submitted is not published, and published is not followed.** Keep them as
  three separate states with separate evidence. A listing can go live with
  `rel="nofollow"` on the outbound link; check the actual `rel` in the DOM rather
  than assuming.

## Reciprocal badge requirements

Several directories grant free listings only if you link back. Handle it in this
order:

1. **Read whether they want a *link* or a *badge image*.** Wording like "you can
   set your own link or use one of our badges" means a plain text link satisfies
   it. Prefer that — no asset, no layout cost.
2. **If an image is required, self-host it.** Their snippet hot-links their
   server, which adds a third-party request to every page of your site. The
   verification checks the link, not where the image is served from.
3. **The href often must point to your item/product page, not their homepage** —
   and that page does not exist until the draft is created. This makes it
   inherently two-pass: create the draft, get the slug, update the link, deploy,
   then verify.
4. If they offer an "I've installed it, continue anyway" escape, **do not click
   it** unless it is actually installed. That is a false statement and the
   listing can be pulled later.
5. Watch for a **stated detection deadline** ("removed if not detected within N
   hours"). Deploy before you trigger verification.

Also worth stating plainly to the site owner: stacking many badge images in a
footer starts to look like a link-exchange page, which is its own risk. Text
links keep it modest.

## Email verification is part of the job, not a follow-up

Multiple directories email a confirmation link and **delete unverified entries
after a few days**. A submission without the click is not a submission. Treat
"confirmation email clicked, page returned an explicit VERIFIED string" as the
completion criterion, and say so in the handoff if you cannot access the inbox.

## Browser automation notes

These cost real time to discover and generalise across sites.

### Make the human's step visible

Automation tools commonly default to a **background window**, and their tabs may
be ephemeral. If you fill a form and hand it to a human for the CAPTCHA, they may
see nothing at all — and you will waste turns explaining rather than diagnosing.

**When a human must finish a step, drive the tab they are already looking at**
(most tools have a `bind`-style command that attaches to the active tab). Check
for a foreground/background switch *before* concluding "the two browsers are
different" — the symptom has a boring cause.

### Selector hygiene

**Dump `tag / type / name / id` before writing a selector.** Two separate targets
cost multiple rounds each because an attribute assumed to be `name` was actually
`id`, or vice versa. A tolerant helper avoids the whole class of failure:

```js
const q = n => document.getElementById(n) || document.querySelector(`[name="${n}"]`)
```

Also check for **duplicate ids** — real pages ship them. Confirm you have the
right node by reading the label text near it.

### Framework-controlled inputs

`el.value = x` is swallowed by React and similar frameworks; the UI never sees it.
Use the native setter, then dispatch events:

```js
const set = (el, v) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
  el.dispatchEvent(new Event('input',  { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
```

### Custom dropdowns (react-select and friends)

Setting `.value` does nothing. Open the control by dispatching
`mousedown`/`mouseup`/`click` on the wrapper, wait for the listbox to render, then
dispatch the same sequence on the option whose text matches exactly — **all inside
one evaluation**, or the dropdown closes between calls.

### A button that "does nothing" may be a multi-step confirm

One target flipped its button's `type` from `button` to `submit` after the first
click, re-showed the same modal twice, and only submitted on the third. **Read the
button's `type` and the surrounding DOM after each click** instead of concluding
the click failed and moving on. This is a deliberate retention pattern, not a bug.

### File uploads when the automation layer is refused

If the debugging-protocol file-input call is denied, inject the file client-side:
`fetch(dataURL)` → `Blob` → `File` → `DataTransfer` → assign to `input.files` →
dispatch `change` and `input`. This avoids the native file chooser entirely.

### Check length limits before typing

Character counters and `maxlength` silently truncate or reject. One 300-character
description failed a 255-character field with no visible error.

### Validate the *shape* of a probe result, not one field of it

A qualification pass over N targets returned "candidate" for 69 of 70. The
number was suspiciously good, and it was: 68 of those probes had returned

```json
{"error": {"code": "attach_failed", "message": "..."}}
```

— valid JSON, but with none of the probe's fields. The classifier read
`if (p.fieldCount === 0) return 'no-form'`, and `undefined === 0` is false, so
every failed probe fell through to the final `return 'candidate'`. The output
was a clean, plausible, entirely fictional qualification table.

**Write the check as "are all expected keys present", never as "does this field
equal a sentinel value".** The second form silently assumes the field exists,
and the failure path is precisely the case where it doesn't:

```js
const REQUIRED = ['url', 'title', 'captcha', 'fieldCount']
const wellFormed = p => !!p && REQUIRED.every(k => k in p)
```

Then give every batch script a **failure-rate gate**: if more than ~20% of a run
came back malformed, exit non-zero and refuse to hand over the results. Without
it, a broken session produces a table that downstream steps consume as fact.

### A result that is much better than the historical rate is a measurement bug

Both of the above were caught by the same instinct rather than by the code: the
pass rate did not match what this kind of work has ever produced. When a batch
suddenly reports an unusually high success rate, suspect the measurement before
celebrating. Re-running a fixed version against a small sample and confirming
the distribution matches history is a cheap check and worth doing every time.

## Never run two agents against one browser session

If a subagent is driving a browser session, **do not drive the same session
yourself**. Concurrent navigation clobbers state, produces intermittent failures
that look like site flakiness, and can overwrite the other's output file. Give
each agent its own session name, and do not "help" a running agent by doing its
work in parallel.

Related trap when scraping a single-page app: after client-side navigation the
**previous query's rows can stay on screen for several seconds** before the new
data swaps in. "Results are present" is not a readiness signal — also require the
new query's own identifier to appear in the page text.

## Mining competitors' backlinks: expect mostly noise

Copying a competitor's backlink profile is sound in principle, and it is the right
instinct for a site with no authority. But budget for the composition:

- A large share of any small site's referring domains is **auto-generated noise** —
  URL shorteners, screenshot/"domain report" generators, search-bang lists, scraper
  aggregates. These attach to any URL that exists. They are not strategy.
- Sorting by "how many competitors share this referring domain" is the right
  ranking, but **the top of that list will be the noise**, precisely because noise
  attaches to everyone. Classify before you treat anything as an opportunity.
- **Bought links announce themselves.** Blocks of numbered domains on one odd TLD,
  appearing within a few days of each other, are a rented network. A single
  unusual TLD holding a large share of a profile points at one network rather than
  many sources.
- What survives the filter is usually small and of one kind: **roundup and
  "best tools" articles, forum threads, and Q&A aggregations — places where a
  human mentioned the tool.** Those are earned, not submitted, and the outreach
  for them is a normal email to the author.

The honest conclusion this supports: for a young site in a niche where the
incumbents bought their links, there is often **no clean bulk path to copy**. Say
that plainly rather than producing a long list of targets that are really a PBN.

## What not to do, and why the request will recur

An operator under pressure will ask for the fast version: a scraped list of blogs
that accept comments without login, posted to in bulk. Expect the request more
than once, and expect it to be backed by real evidence that it works in
low-competition niches.

It is still out of scope here, and the reason is not efficacy: those lists are
harvested from abandoned or unmoderated blogs, and posting promotional comments to
them is advertising on other people's property. The link-farm rule in `SKILL.md`
is not a quality heuristic to be traded away when the legitimate path proves slow.

What *is* in scope, and worth offering instead:

- Writing tooling the operator runs themselves, with a human approving each post.
- Individually-written, genuinely relevant comments where the operator has an
  account and something real to add.
- The outreach path above: roundup inclusion, which produces one editorial link
  worth more than dozens of farm links.

Say the boundary once, plainly, then put the effort into the alternatives rather
than re-arguing it.
