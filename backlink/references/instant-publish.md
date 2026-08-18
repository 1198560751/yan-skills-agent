# Instant-publish platforms: the no-registration channel

The recurring request is "find me places that take a link without an account".
Directory submission almost never satisfies it. This reference is the class that
does, plus the verified behaviour of each platform tested so far.

## The registry: platforms verified to publish

**This table is the asset. Start here, publish first, hunt second.** Every row
was observed in a live DOM, not inferred. Re-verify before a campaign — these
services change silently — but do not re-discover them from scratch.

| Platform | Account? | Anchor | `robots` | `rel` | How to publish |
|---|---|---|---|---|---|
| **telegra.ph** (`graph.org` mirror) | none | yes | `index, follow` | **body `nofollow`; byline dofollow** | Pure HTTP API, no browser. `createAccount` → `createPage`, **POST not GET** |
| **write.as** | none | yes | none present → indexable | nofollow | Browser, plain textarea |
| **rentry.co** | none | yes | **`noindex`** | dofollow | Browser, CodeMirror `.setValue()` |
| **Atabook-powered guestbooks** (one engine, many host sites) | none | yes | **per board** — several verified with no robots meta at all (indexable); others `noindex, nofollow` | `noopener noreferrer ugc` | Browser required (Turnstile). Put the link in the message body as `[URL=…]text[/URL]` — no need to drive the editor |
| **Self-hosted blog comment forms** (plain anti-spam plugin, no hosted-platform widget) | none | yes | varies by host | `nofollow ugc` | Browser. Expect moderation — see field-notes |

**All three are publish targets. There is no shortlist here — use every row.**
Notes below are for the ledger, not for choosing between them.

telegra.ph is the cheapest by far because its pages are indexable and it needs
no browser at all, but be exact about what it gives you — every in-body anchor is `nofollow`, and the single dofollow link per
page is the **byline**, built from the `author_url` you pass at publish time.
Point `author_url` at the URL you actually want that dofollow to reach.
write.as is a real indexable mention; rentry.co's `noindex` cancels most of its
ranking value.

> **This row was wrong for a while, and the way it was wrong is the lesson.**
> It read "dofollow" because a verification sampled *one* anchor — the byline —
> and generalised. A later check of every anchor across six pages on both hosts
> showed body links carrying `rel="nofollow"` throughout. See "Read `rel` from
> every anchor" below.

Everything else tested to date **failed** a gate — the per-platform detail is in
"Verified platform notes" further down, and the failures are worth reading
before you re-test one of them.

### Reject by family, not by instance

Four whole classes are settled. Testing another member of any of them is wasted
time — a campaign that tested 20 candidates and published **zero** spent most of
its effort re-discovering these.

- **Etherpad and its mirrors** — the pad page ships
  `<meta name="robots" content="noindex, nofollow">`. Verified on three
  independent instances including one run by a major foundation, so this is the
  upstream default template, not one operator's policy. **Test the pad URL
  (`/p/<name>`), not the homepage** — the homepage carries no robots tag at all,
  so checking it produces a false pass.
- **Encrypted paste tools** (PrivateBin, ZeroBin, 0bin and relatives) — rejected
  by *architecture*, not policy: the decryption key lives in the URL fragment and
  never reaches the server, so no crawler can read the content no matter what
  `rel` or `robots` say. Skip the entire class.
- **Code-paste engines** (pastebin.com, dpaste.com, ideone.com, distro-run
  pastebins) — the paste body renders inside `<pre>` with syntax highlighting
  and URLs are **not** auto-linked. Gate 1, every time. They are also a poor
  content fit: prose in a code box looks like what it is.
- **Demo instances of self-hosted software** — `noindex` and/or scheduled
  wipes. Already noted below; it keeps recurring, so treat "demo." in the
  hostname as a rejection on sight.
- **The large hosted wiki farm** — every member serves a bot-check interstitial
  before any content renders. Confirmed on two independent wikis, so it is
  platform-wide; do not retest individual members.
- **Guestbook engines that mint a short-lived anti-spam token** — one widely
  embedded engine rejects the POST with a control-value error after a
  multi-step scripted session, whether fields are set through native setters or
  real click-and-type events. The token expires faster than a stepwise session
  completes. It is an informal CAPTCHA; treat the engine as closed unless
  fill-and-submit can be done in one fast pass.
- **Wikis in general, for anonymous edits** — the well-known trope wiki, the
  wiki-farm sites, and most hosted wiki software now require an account for all
  edits. Anonymous IP editing is largely extinct on anything with traffic; do
  not budget a campaign around it.
- **Vendor demo boxes** (shoutbox/tagboard products) — the only postable
  instance is on the vendor's own marketing page, which carries no third-party
  value. Find real embeds on real sites or skip the class.

### Guestbooks are the most productive class currently known

The classic `/guestbook` page still exists in quantity on personal sites, fan
pages and small-business sites, and it is the one class where "no account, no
CAPTCHA, posts immediately" is still normal. Two things make it worth working
in bulk rather than one at a time:

- **One engine covers many hosts.** Identify the engine once, and every site
  running it behaves identically — the same editor, the same link handling. A
  single verified engine is worth more than ten individually verified pages.
- **They cross-link.** Guestbook entries typically render a "site" link for each
  visitor, so an active guestbook is itself a directory of other guestbook
  owners. Discovery compounds; also check the host platform's tag or category
  browse pages.

**The engine decides how to post; the board owner decides whether you can.**
This qualifier matters more than it sounds, because it is tempting to verify one
board and treat the whole engine as settled. On the engine measured here, each
owner independently controls:

- **An anti-bot question** (`question-<id>` field). It is posed to humans, so
  skip those boards rather than answering. On a larger sample this turned out
  to be the *majority* configuration, not an exception: **14 of 30 boards had
  one**. Budget campaign volume off the post-screen count, not the discovery
  count — the realistic conversion from "boards found" to "boards postable" was
  about **45%** once `noindex` and form-less boards were also removed.
- **The `robots` tag.** Several boards carry no robots meta at all and are
  therefore indexable; another on the same engine served `noindex, nofollow`.
  A single-board sample produced exactly the wrong generalisation here.

So probe per board and branch on the result; only the *mechanics* generalise.

Mechanics worth knowing for this class:

- The link goes in the **message body as BBCode** (`[URL=…]text[/URL]`), which
  the server renders into a real anchor. You do not need to drive the rich-text
  editor's Link button — writing the BBCode straight into the textarea produces
  identical output.
- **A hidden field with a name like a password, `tabindex="-1"` and autocomplete
  off is a honeypot.** Never fill it.
- **The bot check is instantiated on submit, not on load.** Before you click,
  there is no challenge widget, no iframe, and no response field anywhere in the
  DOM. Code that waits for a token *before* submitting therefore times out every
  time and reports "blocked" — when in fact nothing was ever asked. Click
  submit first, then observe what appears. If an interactive challenge shows up,
  stop and record a rejection; a passive check that clears itself in an ordinary
  browser needs no action.
- A plain HTTP POST to these forms returns **200 and silently does nothing** —
  no error, page renders normally, nothing saved. Anything gated by a passive
  bot check must go through a real browser, and the verification step is what
  catches this, not the response code.
- **Rate limiting is per address across the whole engine, not per board.** The
  engine measured here starts refusing at roughly the eighth or ninth post in a
  sitting (`Too many posts from your address. Try again in a few hours.`), and
  every remaining target in that batch then fails. Failure is silent in the same
  way as above: no redirect, no HTTP error, just an inline `⚠ Error …` banner
  above the form. **Read that banner after every submit** — without it, being
  throttled and genuinely being rejected look identical in the results, and you
  will burn a retry pass on something retrying cannot fix.

  The general rule this is an instance of: **when the back half of a batch fails
  and the front half succeeded, suspect a rate limit before suspecting the
  script.** Stop the run on the first throttle rather than converting the rest
  of the queue into failures, and make the campaign file resumable so the
  remainder posts after the window.

Two cautions learned the hard way:

- **Hand-built guestbooks frequently do not auto-link.** A post can succeed,
  be publicly visible, and still put your URL in a plain text node. Check the
  rendered DOM of your own entry, not merely that the submission "worked."
- **Read the existing entries before posting.** One widely embedded comment
  widget was technically open and capable of a followed link, and the instance
  that was sampled had a live stream saturated with illegal and link-farm spam.
  That is a safety rejection independent of any SEO consideration, and it is
  only visible if you look at the neighbourhood.

  **But reject the instance, not the widget.** That finding was recorded as a
  blanket rejection of the whole product, and re-checking later showed other
  embeddings of the same widget carrying ordinary human conversation with zero
  spam — because these widgets give the embedding site's owner moderation
  controls. This is the *second* time a single sample produced exactly the wrong
  generalisation here (the first was inferring one guestbook engine's `robots`
  behaviour from one board).

  So state the rule in its general form: **the engine decides how you post; the
  site owner decides whether the result is worth anything.** `robots`,
  anti-bot questions, moderation, and spam saturation are all owner-level, and
  every one of them has to be checked per host. Only the posting *mechanics*
  generalise across an engine.

  One practical note when checking: these widgets render their comment stream
  client-side, so a plain HTTP fetch shows a near-empty page and finds no spam.
  That is a false clear, not a clean neighbourhood — look in a browser.

### Domain-report generators: a page per domain, no account, no content

A separate family worth probing early, because the cost per link is close to
zero: sites that **generate a report page for any domain you put in the URL** —
traffic estimators, worth-of-web calculators, whois and DNS lookups, security
and tech-stack scanners. Visiting `<site>/<your-domain>` is the entire
submission process. No registration, no form, nothing to write.

The yield is much lower than the mechanism suggests, so screen on three
independent conditions and treat any one failure as disqualifying:

1. **A real `<a>` is rendered back to the domain.** Many of these print the
   domain as plain text, or link it only inside a `<script>` payload.
2. **The `rel` on that anchor**, recorded as observed. `nofollow` still counts
   as a link; a claim of `dofollow` you did not read from the DOM does not.
3. **The report page itself is indexable.** This is the one that eliminates
   most of them — a large share of this family serves `noindex` sitewide. The
   page exists, links to you, and will never enter an index. Checking only that
   the URL loads will pass a pile of pages worth nothing.

Of roughly three dozen probed in one sweep, **three** cleared all three gates.

**Probe this family in a browser, not with a plain fetch.** A plain HTTP sweep
produces heavy false negatives here: many are client-rendered, so the anchor is
absent from the raw HTML, and others answer a scripted request with 403 while
serving the page normally to a browser. One site returned 403 to `curl` and, in
a browser, a plainly followed link. Use HTTP only to cheaply reject, never to
confirm absence.

### When the directory ecosystem has monetized, find out before you sweep it

Directory and launch-board lists circulate widely, and it is easy to spend a
campaign discovering that none of them are open. Before working a list of tens
or hundreds of directories, spend one cheap HTTP pass per domain that looks for
a submit page and flags two things visible in the HTML: **a login wall** and
**a price**. Both disqualify without a browser ever opening.

One sweep of ~80 curated launch directories produced **zero** free self-serve
submissions: every one either required an account or charged (observed prices
ranged from about $10 to £49 per listing, several stating openly that the fee
exists to deter spam). Treat that as the current default for this genre rather
than an unlucky list, and put the effort into channels that are open by
construction.

### Read a fast-rising competitor's profile before copying it

When a peer site goes from nothing to substantial traffic in a few months, the
useful question is not "which directories should I submit to" but "where did its
links actually come from" — and the answer is often one you should decline.

The tell is **concentration**: pull the profile sorted by first-seen ascending
and look at how many referring *domains* the early links come from. A site whose
first few hundred links come from two or three domains did not earn them.
Following that up on the referring site's own pricing page is usually a
one-click confirmation — these operations advertise the count directly ("N
dofollow backlinks from M premium domains" for a fixed one-time fee).

Two things follow that are worth keeping separate:

- **The link-count inflation is locale duplication, not repeat submission.** One
  paid listing renders once per interface language, and often across two domains
  run by the same operator, so a single submission shows up as dozens of links
  with identical anchors. A "148 links from one domain" burst is one placement,
  not a campaign. The same arithmetic applies to *legitimate* i18n directories,
  which is the useful half of this observation: **an open channel that ships
  many locales amplifies one successful placement many times over**, so prefer
  those when choosing among comparable open channels.
- **Report the price, decline the purchase.** Paid link schemes are excluded by
  this Skill's rules and carry an obvious footprint (a two-domain source
  accounting for nearly the whole profile). Tell the owner what the going rate
  is and let them decide; do not buy, and do not quietly reframe a paid network
  as a "directory submission".

### Liveness first: this genre dies faster than it changes

Anonymous paste hosts attract the worst abuse on the internet, and operators
increasingly respond by **shutting down rather than moderating**. Two candidates
that were plausible on paper were found fully offline — one after a CSAM
incident, one disabled by its registrar over malware hosting.

Equally, several platforms famous for open anonymous access have quietly closed
it: anonymous gist creation was removed, one wiki farm now gates both creation
and editing behind an account, a landmark early wiki has been frozen for over a
decade, and a well-known code playground offers no anonymous save. **The "the old
internet was more open" instinct is stale.** Check liveness and current
anonymous-access status before anything else; it is the cheapest gate of all.

### Maintenance obligation

This registry only stays valuable if every campaign feeds it. After any
publishing round, **before reporting results**:

1. **Add every newly verified platform as a row here**, with all five columns
   filled from live observation. A platform tested and rejected goes into the
   rejection list below with the gate it failed — a rejection you can cite is
   worth almost as much as a success, because it stops the next campaign from
   re-testing it.
2. **Correct rows that turned out wrong.** Revise the row; never leave two
   conflicting claims side by side.
3. **Keep the published URLs out of this file.** Those are per-site records and
   belong in that project's ledger. What generalises is the *channel*, not the
   page you put on it.

## The rule that finds them

Before hunting, ask one question about a candidate site:

> **Does this site need to manage what I post over time?**

- **Yes** — directories, launch boards, review sites, profile/portfolio hosts.
  They own a listing that gets edited, renewed, moderated, ranked. An account is
  the product logic, not an accident. Expect a login wall every time.
- **No** — paste hosts, note hosts, anonymous blogging endpoints. The page is
  write-once. There is no reason to make you register, so most of them don't.

Campaigns that fail to find "no-registration" targets are usually searching the
first category. Search the second.

## Default policy: if it publishes, publish to it

**Publish to everything that will accept a page. Do not filter by `rel`, by
`robots`, by the host's topic, or by how good the platform looks.** Record what
you observe; never let the observation stop a publish.

The reasoning is about which error is expensive. A site with no traffic loses
nothing by holding a `nofollow` link on an unrelated blog, and gains an audit
trail plus the occasional referral. What it cannot afford is a campaign that
spends its whole budget grading candidates and publishes to three of them.
**Selectivity is a luxury of sites that already rank.** Early on, coverage beats
quality-per-link, and the only real constraints are the four hard fails below —
each of which means there is no link at all, not a weak one.

Two consequences worth stating, because they cut against the instinct:

- **Topic fit does not gate publishing.** The host does not need to be a tool
  site, a tech site, or related to the subject in any way. Personal blogs, hobby
  pages, guestbooks on a fan site — all fine.
- **Ugly platforms still count.** Low traffic, dated design, and an obscure
  domain are not rejection reasons. Only genuine spam neighbourhoods and
  malware/adult surfaces are, and those are covered by the safety policy.

Quality still governs **what you write** — one real, self-contained page per
host, never the same body twice. That is a content rule, not a targeting rule,
and it exists because near-duplicate pages get purged in waves.

## What actually matters, in order

Two of these gates are hard fails and three are recorded but never block.
Keeping them separate matters, because collapsing them throws away usable
targets.

**Hard fail — the link does not exist or does not reach you:**
gate 0 (page expires), gate 1 (no anchor rendered), gate 2 (not publicly
readable), and link rewriting (a monetised redirect points at the redirector,
not at you). Nothing recovers these.

**Recorded, never a reason to skip:** gate 3 (`robots`) and gate 4 (`rel`).
Log what you see and publish regardless. The distinction below is for reading
the ledger afterwards, not for deciding where to post.

- **`nofollow`.** Since 2019 the major engine treats it as a hint rather than a
  directive, and it still carries referral traffic and profile diversity. A
  practitioner rule of thumb worth respecting: if it is a real link on a real
  page, it counts.
- **`noindex` is not the same thing, and is a bigger discount.** `nofollow`
  weakens what one link passes; `noindex` keeps the *hosting page* out of the
  index entirely, so there is far less for a crawler to attribute. A bare
  `noindex` still defaults to `follow`, so the link remains crawlable. Note it
  in the ledger; still publish.

Check the gates in the order below: they fail in that order of frequency, and
gate 0 is readable before you write a single word of content, so checking it
first throws dead candidates out in under a minute each.

0. **Does the page persist?** Several paste hosts cap free retention at days or
   weeks and sell permanence as the paid tier. An expiring page is not a
   backlink, and the expiry is usually stated on the compose screen next to the
   textarea where it is easy to skim past.
1. **Does the published page render an `<a>` at all?** Several note/paste hosts
   emit your URL as plain text. That is a brand mention, not a backlink. Check
   `document.querySelectorAll('a')` on the *published* page, not the editor.
2. **Is the page publicly readable from a different session?** At least one host
   saves guest content successfully and then renders nothing at all for anonymous
   visitors, so the page exists and contains no link.
3. **What does `<meta name="robots">` say on the published page?** This is the
   gate that gets skipped, and skipping it invalidates the whole exercise: a
   **`noindex`** page does not enter the index, so a dofollow link sitting on it
   is worth approximately nothing. Read it before celebrating a `rel`.
4. **What is the observed `rel`?** Read it off the live DOM. Never infer it from
   the platform's reputation. Some are dofollow, some are nofollow, and the same
   platform can differ between its markdown view and its HTML view.

A platform that renders anchors, is public, is indexable, **and** is dofollow is
rare. Most anonymous-publish hosts fail gate 1 or gate 3, and both failures look
like success if you only check `rel`.

Report both numbers: how many pages published, and the observed `rel`/`robots`
distribution across them. Publishing is the target; the distribution is the
audit trail. Reporting only "published successfully" hides whether the links
exist at all — that is what gates 0-2 are for — while reporting only dofollow
counts understates work that was correctly done.

## Verified platform notes

Behaviour observed directly; re-verify before relying on it, since these
services change silently.

### Fully scriptable, no browser required

- **telegra.ph** — **the only platform tested so far that clears all four gates:
  anchors rendered, public, `meta robots: index, follow`, and `rel` empty
  (dofollow).** Public HTTP API, no signup, no email, no CAPTCHA.
  `GET /createAccount?short_name=…&author_name=…&author_url=…` returns an
  `access_token`; `GET /createPage?access_token=…&title=…&content=<JSON>` publishes.
  `content` is a JSON array of node objects (`{"tag":"p","children":[…]}`), and
  anchors are `{"tag":"a","attrs":{"href":"…"},"children":["anchor text"]}`.
  **Send `createPage` as a POST.** The documented examples use a query string,
  which works for short parameters and then fails once `content` holds a real
  article: the server answers with an HTML error page, so the client reports
  `Unexpected token '<' … is not valid JSON` and the URI-too-long cause stays
  invisible. Any API client here should print the HTTP status and a slice of the
  body on a parse failure, or this costs a debugging round every time.
  The token is anonymous and disposable but is still a credential — keep it out
  of the repo and out of logs.
  **`graph.org` serves the same pages** and is a useful fallback when the primary
  domain is unreachable from your network.

### Browser required, worth the trouble

- **rentry.co** — markdown, custom URL slug, returns an edit code on publish.
  Anchors observed **dofollow**, but the published page carries
  **`meta robots: noindex`**, which cancels most of that value. Useful as a
  stable, editable, human-shareable reference page; do not count it as a ranking
  backlink. **This platform is the reason gate 3 exists in the list above** — it
  was briefly recorded as the best find of a campaign on the strength of its
  `rel` alone, before anyone read its `robots` tag.
  **Trap:** the visible editor is **CodeMirror**; the real `textarea` is
  `display:none`. Setting `.value` on the hidden textarea appears to work — you
  can read the value back — but CodeMirror overwrites it with its own empty
  buffer on submit, and the form returns a bare "This field is required" that
  reads like a *different* missing field. Set content through the editor
  instance instead:
  ```js
  document.querySelector('.CodeMirror').CodeMirror.setValue(markdown)
  ```
  The hidden textarea then syncs by itself.

- **write.as** — anonymous publishing works with no account. Anchors observed
  **nofollow**, so treat it as a mention channel.

### Publishes but produces no link

- **txt.fyi**, **notes.io** — both publish anonymously and both render your URL
  as plain text with no `<a>`. Brand mention only.
- **anotepad.com** — guest note saves and returns a URL, but the public page
  renders none of the content for anonymous visitors. Zero value; do not count it.

### Blocked

- **justpaste.it** — content can be set through the tinyMCE instance
  (`tinymce.activeEditor.setContent(html)`), but the Publish button raises an
  image-selection anti-robot test. Out of scope.
- **controlc.com** — CAPTCHA on the landing page.

### Rejected on a cheap gate, before writing any content

Each of these cost well under a minute because gate 0 or gate 3 is visible on
arrival. This is the payoff for checking the cheap gates first.

- **hackmd.io** — anonymous note creation genuinely works, and then the note
  carries `robots: noindex, nofollow`. Both gates fail at once.
- **ctxt.io** — free retention tops out at 30 days, permanence is the paid tier.
  Gate 0.
- **A public demo instance of a self-hosted editor** — `noindex` *and* documented
  daily deletion of all content. Demo instances of anything are a dead end for
  this purpose; look for a production deployment or skip the software entirely.
- **techplanet.today** — open-publishing article site, but every outbound link in
  the post body is `nofollow`.
- **A large anonymous social network with open posting** — outbound links all
  `nofollow`, and the visible post neighbourhood was wall-to-wall APK and game
  spam. Even had it been dofollow, that neighbourhood is a reason to decline.
- **pastelink.net** — advertises "no login required", but the product is
  automatic link monetisation, meaning outbound links are rewritten into a
  redirect. **A rewritten link is not a link to you.** The example paste linked
  from its own homepage also resolved to an "Illegal Content" takedown notice.
- **A microblog platform with a public feed** — reads as anonymous, but posting
  is gated behind Join.
- **txti.es** — retired; the site says so on its homepage.
- **A plain shared-textarea notepad** — `noindex, nofollow` site-wide, and the
  content is a raw textarea value rather than rendered prose.
- **A hosted paste service behind a consultancy's domain** — saving raises a
  blocking full-site Terms & Conditions modal that a human must accept. Out of
  scope to click on someone's behalf; and its paste rendering would have failed
  gate 1 anyway.

Whole families rejected in one go — Etherpad mirrors, encrypted pastes, code-paste
engines, demo instances — are covered under "Reject by family" above rather than
listed instance by instance.

### The listicles are not a shortcut

"10 alternatives to X for anonymous posting" articles are, as of testing,
AI-generated and materially wrong: entries repeat one boilerplate sentence
verbatim, mobile-only messaging apps get listed as web publishers, and platforms
that plainly require registration are described as not requiring it. Treat these
articles as a source of *names to test*, never as findings. Every claim about a
platform in this file was observed in a live DOM.

Budget accordingly, and budget pessimistically. Across everything tested to
date the rate is **worse than one in fifteen**: a later campaign tested twenty
fresh candidates and published **zero**. Assume a sweep produces nothing, and
treat the three registry rows as the durable asset rather than expecting the
list to keep growing.

The corollary is that **a well-documented rejection is close to as valuable as a
success** — it is what stops the next campaign paying the same cost. Record the
gate each candidate failed, and promote it to a family-level rule the moment two
members of a class fail the same way.

## Editor APIs beat native setters

The React native-setter trick in `field-notes.md` is necessary but not
sufficient. Rich editors keep their own buffer and serialise it over your value
at submit time. Detect the editor first, then use its API:

| Editor | Detect | Set |
|---|---|---|
| CodeMirror 5 | `.CodeMirror` element with `.CodeMirror` property | `el.CodeMirror.setValue(v)` |
| tinyMCE | `window.tinymce?.activeEditor` | `tinymce.activeEditor.setContent(html)` |
| Plain / React | neither of the above | native `value` setter + `input`/`change` |

The failure signature is identical in every case — the field reads back correct,
then submits empty — so check for an editor **before** debugging the form.

## Content standard

These pages are trivially cheap to create, which is exactly why they get purged
in waves. What survives a purge is what a human would plausibly have written.

Write a real, self-contained technical explanation per page, each one different
from the others, and **state the limitations of the thing you are linking to**.
Keyword-stuffed near-duplicates are the first thing removed, and posting the
same body across ten hosts creates a duplicate-content footprint that is easy to
detect and easy to discount.

One genuinely useful page carrying three contextual links beats ten thin ones.

## Which browser to drive

When both an owner-Chrome connector and an isolated built-in browser are
available, split the work rather than picking one:

- **Owner's Chrome** — only for surfaces that need their logged-in session
  (analytics dashboards, paid SEO tools). Nothing else belongs there.
- **Built-in browser** — publishing and verification. These targets are
  anonymous by definition, so the logged-in session buys nothing, and keeping
  them off the owner's Chrome avoids three real costs: competing for the same
  tab as a long-running dashboard scrape, stealing focus while they work, and
  an extra layer of shell escaping on every DOM read.

Reliability differs too: an API endpoint that intermittently dropped the
connection through the owner's Chrome went through first try on the built-in
browser. When a publish step fails with a transport error, retrying on the other
browser is a faster diagnostic than debugging the request.

State which browser is doing what before starting, so a failure is attributable.

## Read `rel` from every anchor, out of the raw HTML

Two sampling errors produce a confidently wrong registry, and both have happened:

1. **One page can carry several different `rel` values.** A byline or author
   link, an in-body link, and a footer link are generated by different code
   paths. Sampling one anchor and reporting "the platform is dofollow" is how a
   nofollow channel gets recorded as the best find of a campaign. **Enumerate
   every anchor pointing at your domain and report the distribution**, not a
   representative value.
2. **Read the server HTML, not only a rendered DOM.** Fetching the raw document
   and matching every `<a …>` whose `href` contains your domain is both cheaper
   and harder to fool than reading a live DOM through a browser, where it is easy
   to inspect a different element than you think you are.

Do this on at least two pages before writing a row into the registry. When a
platform has a public mirror domain, check both — matching results across hosts
rules out a per-host proxy or CDN rewriting the markup.

Corollary worth stating: when a subordinate report contradicts your own earlier
verification, **re-run the measurement rather than defending it**. The cost of
the re-check is a single HTTP request; the cost of a wrong registry row is every
campaign that follows.

## Verification when the host is unreachable

If the publishing domain is blocked on your network, a reader proxy
(`r.jina.ai/<url>`) confirms the page is public and contains the link, but
returns markdown and therefore **cannot** confirm `rel`. Record the page as
public and leave the `rel` state unverified rather than assuming. Generic CORS
proxies were unreliable for this in testing.

Checking whether the host's pages are *actually indexed* is a separate question
and often cannot be answered from a restricted network: one major engine's
regional endpoint silently mangled `site:` queries and returned results for an
unrelated domain, and another served a bot challenge. **A mangled `site:` query
returns confident nonsense rather than an error**, so verify the operator is
being honoured — search for something only the target domain could match —
before reading anything into the result. Failing that, report the page's own
`robots` directive as what it is (a claim of indexability) and leave actual
indexation unverified. It takes days to become true anyway.
