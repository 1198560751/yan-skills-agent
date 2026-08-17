# Instant-publish platforms: the no-registration channel

The recurring request is "find me places that take a link without an account".
Directory submission almost never satisfies it. This reference is the class that
does, plus the verified behaviour of each platform tested so far.

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

## What actually matters, in order

Two of these gates are hard fails and three are a value ranking. Keeping them
separate matters, because collapsing them throws away usable targets.

**Hard fail — the link does not exist or does not reach you:**
gate 0 (page expires), gate 1 (no anchor rendered), gate 2 (not publicly
readable), and link rewriting (a monetised redirect points at the redirector,
not at you). Nothing recovers these.

**Ranking, not rejection:** gate 3 (`robots`) and gate 4 (`rel`).

- **`nofollow` is worth publishing to.** Since 2019 the major engine treats it
  as a hint rather than a directive, and it still carries referral traffic and
  profile diversity. Record the `rel` honestly and publish anyway; do not
  discard a target for this alone. A practitioner-side rule of thumb worth
  respecting: if it is a real link on a real page, it counts.
- **`noindex` is a bigger discount than `nofollow`, and they are not the same
  thing.** `nofollow` weakens what one link passes; `noindex` keeps the *hosting
  page* out of the index entirely, so there is far less for a crawler to
  attribute. A bare `noindex` still defaults to `follow`, so the link is
  crawlable — non-zero, but rank the target well below an indexable one.

Check the gates in the order below: they fail in that order of frequency, and
gates 0 and 3 are readable before you write a single word of content, so
checking those first throws most candidates out in under a minute each.

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

Report campaign results by *observed `rel` on an indexable page*, never by
"published successfully". Those two numbers differ by a large factor.

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

### The listicles are not a shortcut

"10 alternatives to X for anonymous posting" articles are, as of testing,
AI-generated and materially wrong: entries repeat one boilerplate sentence
verbatim, mobile-only messaging apps get listed as web publishers, and platforms
that plainly require registration are described as not requiring it. Treat these
articles as a source of *names to test*, never as findings. Every claim about a
platform in this file was observed in a live DOM.

Budget accordingly: across the platforms tested here, roughly **one in fifteen**
cleared all five gates. That ratio is the realistic planning number, and it is
why the cheap gates matter so much.

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
