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

## The gate you scanned is the gate on screen one

Measured 2026-08-19 on the first target actually walked end to end. Its step 1
asked for listing type, category, URL, title, description, name and email —
**no CAPTCHA in the raw HTML, no login, no reciprocal demand**, which is exactly
the profile that gets a row filed as an open, unattended target. Clicking
through to the confirm step produced a `scode` security-code field and a second
Submit button.

So a cohort built from a first-screen scan is **optimistic, and there is no way
to fix that by scanning harder** — the only thing that settles it is walking the
form. Two consequences worth building around:

- Treat "open" from a scan as *a lead about the gate*, not the gate. Re-file the
  row the moment a later step contradicts it.
- Because the surprise is systematic, plan the run so a discovered CAPTCHA costs
  one row and not the batch: fill everything the driver legitimately can, leave
  the page sitting at the confirm step, and push the row into the one manual
  queue described in [batch-campaign.md](batch-campaign.md).

## `requestSubmit()` does not fire a JS-bound submit handler

Also 2026-08-19, on a form whose `action` was an internal `/api/form` endpoint.
The driver filled every field, called `form.requestSubmit(button)`, and reported
a state change of nothing: same URL, same text. **The network capture showed no
request to `/api/form` at all** — so the submission never happened, which is the
good outcome, because the alternative is a driver that reports success on a form
that was never sent.

The cause is that these forms bind a handler to the **button's click**, not to
the form's submit event. `requestSubmit()` and `form.submit()` both bypass it.
The fix is to click the real control, and the check that catches it is the
network capture, not the page text:

```bash
opencli browser "$SESSION" network | grep -i '<the form endpoint>'
```

**Never resolve this state by clicking again.** No request fired here, but the
same "nothing visibly happened" appears when the POST *did* fire and the site
answered silently — and those two are indistinguishable from the page. That is
the `outcome-unknown` state: check the endpoint, the mailbox, and the public
page, in that order, before touching the form a second time.

## A currency amount on the page is not a submission fee

Measured across a 743-row sweep in 2026-08: a bare money regex flagged ~163 of
648 domains as costing money. Once each page was actually read, **about a
quarter of those were not submission fees at all**, and the errors were not
random — they clustered:

- **One legacy PHPLD directory script accounts for most of it.** Two dozen
  domains running it (`addgoodsites`, `adbritedirectory`, `deepbluedirectory`,
  `fire-directory`, `jet-links`, `steeldirectory`, …) all render a sidebar
  offering an **ad banner for $0.80**, while `/submit.php` on the same site is
  free with no fee field anywhere. Same template, same false positive, twenty-odd
  times — so this looks like a trend in the data and is one script.
- **Directories quote the prices of the products they list.** A SaaS directory's
  homepage is wall-to-wall pricing that has nothing to do with listing on it.

The fix that works is proximity, not a better money regex: only count an amount
whose surrounding ~160 characters mention submitting, listing, a plan, a
package, featured/priority placement, or a billing period.
`scripts/probe-submission-targets.mjs` does this and reports the rest separately
as `priceHitsUnscoped`, because "there was money on the page somewhere" is worth
a human glance and worth nothing as a `payment` value.

**`optional` is the most useful answer here, not a hedge.** In the same sweep 18
sites turned out to run a genuine free tier next to a paid fast-track — that is
a *free* channel with a queue, and calling it `required` would have deleted 18
usable targets from the library. Record what the free path costs in time.

## Cloudflare's interstitial makes "dead" unknowable over HTTP

In the same sweep, of 85 hard cases handed to a resolver, **53 could not be
classified at all — and the dominant cause was not dead sites.** It was
Cloudflare's "Just a moment…" JS challenge and WAF blocks, which a browser User-
Agent on `curl` does not get past. Well-known live properties sat in that bucket:
`sourceforge`, `g2`, `getapp`, `goodfirms`, `daniweb`, plus a long tail of
classifieds directories. A second cluster was modern SPAs whose raw HTML is
essentially empty (`aitoolsdirectory`, `booky.io`, `techbasedirectory`), so form
and gate detection finds nothing on a page that is obviously alive.

Both clusters are **alive and unresolvable by HTTP**, which is exactly the state
`unverified` exists for. Do not let them decay into `dead`, and do not let a
report count them as failures: they are the queue for the browser pass, and the
Skill already drives a real logged-in Chrome for precisely this.

Two smaller ones from the same run, both of which need the browser as well:
domain parking that only reveals itself after a **JS redirect to `/lander`**
(two apparently unrelated domains turned out to share one parking template), and
a cluster of expired TLS certificates that need an explicit fallback before any
conclusion is drawn.

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

## Blog comments: the submitting session is the worst place to verify

Comment forms are the most available no-registration channel there is, and the
verification trap is severe enough to invalidate a whole campaign report.

- **Seeing your own link after submitting proves nothing.** The common blog
  engine redirects to `?unapproved=<id>&moderation-hash=<hash>#comment-<id>`,
  and that page renders the pending comment **to its author only**. Worse, the
  submission sets an author cookie, so the *same browser session* keeps showing
  the pending comment on the clean URL afterwards. A verifier that just asks
  "is my link on the page?" reports `published` for something no crawler and no
  reader can see. Observed doing exactly this.
- **Judge by the landed URL first**: `unapproved=` or `moderation-hash` in the
  query string means moderation, full stop, regardless of what renders.
- **Confirm public visibility through a channel that has none of your cookies**
  — a reader proxy, a different machine, or a fresh anonymous context. Anything
  else is measuring your own session.
- Guest comment links come back as `rel="nofollow ugc"` or `"ugc external
  nofollow"` on the main engine's default. Publish anyway; just log it.

Two architectural blockers decide most of the target list before any of that:

- **The hosted-blog platform's comment widget is a cross-origin iframe.** It is
  invisible to `document.forms` and to frame enumeration, so form-probing tools
  report "no comment form" on posts that plainly have one. Roughly half of a
  49-post sweep died here.
- **The big hosted-WordPress commenting system** leaves only hidden fields plus
  an anti-spam honeypot in the classic markup; the real UI is rendered by script
  elsewhere. It failed 6 of 6 tested.

Self-hosted installs with a plain anti-spam plugin are the class that actually
works. Searching with both hosted platforms excluded is therefore the productive
footprint — filtering them out afterwards wastes most of the sweep.

## `form.elements[name]` may hand you a collection, not an element

When more than one field shares a name — which anti-spam honeypots deliberately
arrange — `form.elements[name]` returns a node list. Setting `.value` on it
throws nothing, changes nothing, and the form submits empty. This is the same
failure signature as the rich-editor trap: **the field reads back fine and
submits blank.**

Resolve fields with `querySelectorAll('[name="x"]')` and pick the one that is
actually visible (non-zero box), which also skips the honeypot — filling a
honeypot is self-identifying as a bot. Then **assert the body field is non-empty
before submitting**: posting an empty comment burns the target and leaves litter
on someone's site.

## Poll for the element, never sleep a fixed interval

An ad-heavy blog can take well over ten seconds to attach its comment form. A
fixed delay that expires early produces a null result that reads exactly like
"this page has no form" — a false negative that silently shrinks the target
list. Poll for the specific thing you need, with a bounded retry count.

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

## 「没有数据」几乎总有自己的页面形态，别拿超时当判据

批量测流量时，数据源查不到的域名并不是页面加载失败——它**正常渲染完成**，
只是把指标区换成了一句「未找到匹配内容」加一排 `N/A`。

第一版轮询只认「总访问量」这个内容词。有数据的域名 5 秒返回，没数据的域名
**白等满一整个 45 秒超时**，而在外链目标里没数据的那一档恰恰占比最大，
于是整批的平均耗时翻了三倍——批量作业里这就是能不能跑完的差别。

**判据：任何「查不到 / 没有结果 / 空态」的分支，先去页面上把它自己的那句话找出来，
用它做正面判定；超时只留给真正的卡死。** 代价不对称——多认一个空态字符串是一分钟的事，
拿超时兜底是每条记录都要付的税。

顺带一条：**空态页仍然带着这个域名的简介文案**（数据源从站点抓的 meta description）。
所以「页面上出现了这个域名」不足以证明「查到了数据」，轮询条件必须认指标本身或空态串，
不能认域名。

## 超时不是结论——「没测到」和「没有」在超时那一刻长得一模一样

这条是上一条的反面，而且比上一条贵得多，因为它**污染数据而不报错**。

上一条说「空态要正面认出来」。第一版顺手做了个看起来很合理的推论：
既然认不出指标就说明没数据，那超时就记 `below-floor`（低于测量下限）吧。

**错。** 实测一个自然流量 2.4K 的目录站被这么判成了「没流量」，
另一个 4.6K 的也是。原因只是概览页那一次渲染慢，超过了 41 秒的阈值。
**渲染慢的页面和真的没有数据的页面，在超时那一刻的可观测状态完全相同，
而两者的结论正好相反。**

规则：

- **只有数据源明说「未找到匹配内容」才算 `below-floor`。**
- **超时一律记 `error`。** error 的语义是「这次没测成」，不是判决。
- **续跑时 `error` 不算跑过**，必须重测。反过来会把一次会话故障造成的空洞
  永久固化下来，而且从输出行数上完全看不出来——行数是齐的。
- 写回主表时，遇到 error 要**清掉**该域名上已有的旧判决，
  否则由 error 降级来的错误结论会一直冒充「已测」。

判据一句话：**任何「查不到」的结论，都要能说出数据源在哪句话里说了「没有」。
说不出来，就只是你没等到。**

## 共享面板的真实瓶颈是每日配额，不是速度

把登录摊销掉之后单域名 5 秒，很容易得出「几百个域名半小时跑完」的结论。
**跑到第 110 个左右，面板上的「API 今日配额」从 13% 涨到 100%，之后每一次
eval 都超时**——表现和会话挂掉一模一样，脚本里的报错还在教人「换个节点」。

- **真实吞吐 ≈ 每天 120 个域名/张卡片**，不是每小时几百个。规划批量筛选时按这个算。
- **配额是按卡片分开的。** 一张打满了，另一张往往还满着——换工具继续，
  不要因为其中一张见底就整批停下。代价是口径变了，必须在数据里标明来源。
- **配额耗尽必须能和会话故障区分开。** 跑之前和跑挂之后都去读一次面板上的
  「今日配额」，那是唯一能直接区分两者的地方。
- 因此批量脚本必须有**连续失败熔断**：会话一挂，后面每个域名都要付满一整个超时，
  实测连烧 48 个域名 60 秒才被人发现。连续 N 次失败就停下报错，不要跑完整张表。
