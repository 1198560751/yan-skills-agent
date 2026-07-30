---
name: backlink
description: |
  Automated backlink submission for websites. Clones backlink-pilot, configures
  product info, and batch-submits to 180+ free directory sites using bb-browser
  on the Mac Mini (so the user's local browser is never disturbed).

  Use this skill when the user mentions backlinks, external links, SEO link building,
  directory submission, "提交外链", "发外链", "submit to directories", or wants to
  promote a finished website to directory sites and search engines. Also trigger when
  the user asks about IndexNow, awesome-list PRs, or web directory submissions.
---

# Backlink — Automated Directory Submission

## Install and Update

Source: [Skills.sh](https://skills.sh/yan-labs/yan-skills)

```bash
# First global install, or reinstall if an update fails
npx skills add yan-labs/yan-skills --skill backlink -g -y

# Update the globally installed Skill
npx skills update backlink -g -y
```

For a project-level install, omit `-g`; update a project installation with `npx skills update backlink -p -y`.

Submit a website to 180+ free directory sites using bb-browser automation on the
Mac Mini. The user's local browser is never touched.

## Prerequisites

- SSH access to Mac Mini (`ssh mac-mini`)
- Node.js 18+ on Mac Mini
- bb-browser (`npm install -g bb-browser`) on Mac Mini
- Chrome running on Mac Mini (`bb-browser open about:blank`)

## Quick Start

```bash
# 1. Clone backlink-pilot on Mac Mini
ssh mac-mini 'zsh -lc "cd /tmp && git clone https://github.com/s87343472/backlink-pilot.git && cd backlink-pilot && npm install && npm install js-yaml"'

# 2. Create config.yaml (see Configuration section)

# 3. Copy config + batch script to Mac Mini
scp config.yaml mac-mini:/tmp/backlink-pilot/
scp batch-direct.mjs mac-mini:/tmp/backlink-pilot/

# 4. Start Chrome on Mac Mini
ssh mac-mini 'zsh -lc "bb-browser open about:blank"'

# 5. Run batch submission
ssh mac-mini 'zsh -lc "cd /tmp/backlink-pilot && node batch-direct.mjs"'
```

## Configuration

Create `config.yaml` from the user's product info:

```yaml
product:
  name: "Product Name"
  url: "https://example.com"
  description: "One-line description under 160 chars"
  long_description: |
    Detailed 2-3 sentence description with features and audience.
  email: "contact@example.com"
  categories:
    - category-1
    - category-2
  pricing: free  # free | freemium | paid
  features:
    - "Feature 1"
    - "Feature 2"

utm:
  enabled: true
  base_url: "https://example.com"
  medium: "directory"
  campaign: "backlink"

browser:
  engine: bb
  timeout: 30000
```

## How It Works

The batch-direct.mjs script (bundled below) does this for each target site:

1. **Pre-flight HTTP check** — skip dead sites (404/500)
2. **Open the page** via `bb-browser open <url>` (NOT `--tab` — avoids tab-switching bugs)
3. **Snapshot** the accessibility tree via `bb-browser snapshot -i`
4. **Parse form fields** from snapshot (name, url, email, description, submit button)
5. **Fill fields** via `bb-browser fill @ref <value>`
6. **Click submit** via `bb-browser click @ref`
7. **Check confirmation** text for success keywords
8. **Fallback**: if snapshot parsing fails, try JS eval-based filling with common selectors

## Critical Technical Details

These are hard-won lessons — do not skip them.

### bb-browser snapshot format (v0.11+)

The current format is `role [ref=N] "label"`, NOT the old `@N [role] label`:

```
textbox [ref=8] "url"
textbox [ref=9] "email"
button [ref=10] "Submit"
```

Parse with: `/^\s*(\w+)\s+\[ref=(\d+)\]\s*"?([^"]*)"?\s*$/`
Reference format for fill/click: `@8`, `@9`, `@10`

### Tab management

ALWAYS use `bb-browser open <url>` (navigates current tab).
NEVER use `bb-browser open <url> --tab` for submission workflows — it opens a new
tab but subsequent `snapshot`/`fill`/`click`/`eval` commands don't track the tab ID,
causing "Tab not found" and "无效的标签页索引" errors.

### Mac Mini remote execution

Run bb-browser on Mac Mini to avoid hijacking the user's local Chrome:

```bash
ssh mac-mini 'zsh -lc "bb-browser open about:blank"'
ssh mac-mini 'zsh -lc "cd /tmp/backlink-pilot && node batch-direct.mjs 2>&1"'
```

Always wrap remote commands in `zsh -lc` for proper PATH loading.

### Interpreting results (2026-07-17 crystalhealing.guide campaign, 44 sites)

Real outcome distribution: 3 confirmed / 23 "filled + submitted but no confirmation
text detected" / 16 "no fields" / 2 dead. Two lessons:

- **Confirmation-keyword detection is the weak link, not submission.** Sites often
  redirect or show custom copy the keyword check misses. Treat "submitted, no
  confirmation" as *probable success* — do NOT resubmit (risk of duplicate listings).
- **Retry "no fields" sites only when a same-template sibling succeeded.** Two runs
  disagree, and the discriminator is template identity, not effort:
  - 2026-07-17: a broad retry over 16 assorted "no fields" sites converted **0**. They
    were login-walled or had no public form. Retrying those is wasted time.
  - 2026-07-25: a retry over 10 sites converted **6** (3 with confirmation text). Every
    converter was a phpLD-template sibling whose identical twins had filled successfully
    in the same pass — a 4s settle was simply too short for them, and 12s fixed it.

  So: before retrying, check whether another site on the same template already worked
  this run. If yes, it is a timing problem — retry at 12s. If the site is a one-off with
  no successful sibling, treat "no fields" as a wall and move on. Confirm with a raw HTTP
  preflight: `forms>=1 && inputs>=8` in the served HTML but zero visible inputs in the
  browser means the page rendered slowly, not that the form is gone.

The tier lists below rot fast (sites add login walls / die between campaigns) —
trust the per-run pre-flight over the historical tier labels.

Wave-3 (2026-07-17, 50 backlink-pilot inventory sites): 1 confirmed (Unmatched Style,
via JS-eval fill), 24 filled+submitted unconfirmed, 22 no public form, 2 dead
(Betalist URL, Wewaat), 1 error (MicroLaunch unfocusable overlay). Extra lessons:
- **Email-only field detections are usually newsletter boxes**, not listing forms
  (10words, Joinly, PitchWall, Toools.design) — treat those "submitted" as noise.
- 1000.tools is now signup + $5.99/mo (Tier 4). GeekWire's free form demands street
  address + logo upload + founder name — not automatable truthfully without
  user-provided assets; ask the user for those first or skip.
- Google Forms submit URLs (YourStory etc.) usually require Google sign-in — probe
  for "使用您的 Google 账号继续" / 401 before counting them as no-login.

### Zero-login content pages (publish freely — but verify the link attribute)

- **Telegraph (telegra.ph, DR ~88)**: publish via anonymous API, no browser, no account
  credentials: `POST api.telegra.ph/createAccount` (short_name only → token), then
  `createPage` with Node-array content. Verified live in ~2s. Good home for a
  campaign article with product links.
- **Telegraph body links are `rel="nofollow"` (verified 2026-07-25).** An earlier
  version of this skill filed Telegraph under "dofollow weight" — that was wrong.
  Inspect the rendered HTML, not the platform's DR:

  ```
  <a href="https://example.com/page" target="_blank" rel="nofollow">   <!-- body link -->
  <a rel="author" href="https://example.com/page" target="_blank">     <!-- byline: NO nofollow -->
  ```

  The only followable anchor is the byline, rendered from the `author_url` you pass to
  `createAccount`/`createPage`. So set `author_url` to the page you actually want to
  pass weight to, and treat in-body links as referral/citation surface only. One
  account per article lets each article carry a different followable `author_url`.
- General rule this proves: **never record a link attribute from a platform's reputation
  or from a previous campaign's note.** `curl` the published URL and grep the anchor.
- Ping tools / "backlink maker" generators (Ping-O-Matic clones, UNmiss, Aienex):
  **policy = never use** — they mint link-farm spam, no SEO value, real risk.

### Untapped inventory (recorded 2026-07-17, for future waves)

- backlink-pilot `targets.yaml`: ~100 more free `auto: yes` sites unused (mostly AI
  directories — skipped for topical mismatch with a non-AI product; fine for AI tools).
- backlink-pilot `resources/backlink-resources.json`: 226 scout-discovered pending URLs.
- phpLD instant-approval directory family (fruity-directory, alive-directory, deepblue…,
  ~26 sites, claimed DA 59-71): free tier often = pending-forever unless paid; low priority.
- Aggregators to mine: submitsaas.com/no-login-directories (45 pages), backlinksitesdb.com,
  promotestartup.com (300+ CSV), github.com/volodstaimi/Startup-Launch-List (582 entries).

### Sami's "100 SaaS Submission Sites" list (verified 2026-07-22)

Source: `https://app.notion.com/p/100-SaaS-Submission-Sites-3a2e313566e88074a759d13c05bf6dbe`
(shared from `https://x.com/samigrows/status/2078504320375701861`). Treat this as
a **prospecting inventory**, not a batch target list. The post's claims that the
directories are all free and indexable within days are not supported by the list or
the live submission flows.

Live checks from a consumer content/tool-site campaign:

- Full-list preflight covered all 100 entries: 83 returned HTTP 200, 12 returned
  403, 3 returned 429, 1 returned 405, and 1 failed TLS verification. After
  category and submission-condition review, only 11 were worth moving to an
  authenticated submission check, 16 remained secondary candidates, and 73 were
  rejected as mismatched, conditional/paid, low quality, or non-directory channels.
  HTTP 200 means only that an entry page is alive; 403/429 often means anti-bot, not
  that the site is dead.

- **Fazier**: active and accepts free consumer tools, including health/wellness and
  tarot-style products. Submission requires an account (Google or email). It is a
  plausible manual-launch target, but an auth screen is not a submission.
- **Product Hunt**: active and potentially relevant for a real interactive tool
  launch, but requires an authenticated maker profile and launch assets. Do not count
  a login page or draft as a backlink.
- **TinyLaunch**: active and login-required. Its advertised dofollow link is
  conditional on ranking in the top three **and** placing a dofollow TinyLaunch badge
  on the product site; reject it when reciprocal homepage/footer links are out of
  scope.
- **Startup Fast**: the $0 tier can wait up to 90 days and requires a site badge. A
  dofollow link additionally requires a top-three finish. This is not an unconditional
  free backlink.
- **Uneed**: the submission page returned a Cloudflare 403 during verification.
- **Open Launch**: has a public submit route, but the live directory mixed ordinary
  tools with explicit adult/spam listings. Avoid for brand-safety unless its moderation
  quality materially improves.
- **Launched! (`launched.io`)**: TLS certificate was expired during verification.
- The source list itself labels several entries paid (There's An AI For That,
  Futurepedia, Toolify, Aixploria, TopAI.tools), directly disproving "all free."

Selection rule: shortlist by product/category fit, moderation quality, live public
listing examples, link attribute, and referral potential. Never add reciprocal badges
solely to unlock a directory link. Record five separate states: auth reached,
submitted, publicly listed, indexed, and follow/nofollow verified.

### Target-URL and anchor-text diversity (mandatory, 2026-07-25)

Never submit the same URL with the same title across a batch. In almost every directory
form, **the "Title"/"Name" field becomes the anchor text of the resulting link**, so a
batch that reuses one title ships N identical anchors — the single most obvious footprint
a link scheme leaves.

Build the batch as a per-site payload, not one global `product` object:

```js
{ site, submitUrl, url /* distinct deep link */, anchor /* distinct title */, desc }
```

Rules that produced a clean batch:

1. **One target URL per site.** Assert uniqueness in code before running — build the
   assignment, `throw` on a duplicate. Pull the URL set from the production sitemap.
2. **One anchor phrasing per site**, and vary the *form*, not just the words: exact-match
   (`Leo Birthstone Guide: Peridot and Ruby`), question (`What Is the Sagittarius
   Birthstone?`), partial-match (`Capricorn Garnet Meaning and Care`), plain descriptive
   (`Topaz Stone Guide`). Do not send the raw `<title>` of every page — those share a
   template and re-create the footprint you were avoiding.
3. **Write a distinct description too.** Many directories render it beside the link.
4. Prefer deep pages over the homepage. Spread across content types (tools, category
   pages, item pages) so no single section absorbs the whole batch.

Fetch real titles/descriptions from the live pages first (`<title>`, `meta[name=description]`)
so submissions describe the page truthfully, then rewrite them into varied anchors.

### "No-login directory" community lists: verify before trusting (2026-07-25)

Circulated Chinese/indie-hacker lists of "免登录 free backlink" sites are mostly stale.
A 29-entry probe of one such list (checking final URL, login keywords, and real form
fields) returned **one** genuinely open form:

| Claimed | Actual |
|---|---|
| PromoteProject, Launchtory, toolbit.ai, Woy AI, Tap4 AI, DokeyAI, AI Tool Center, aiwith.me, affordhunt | login wall (toolbit redirects to `/login`) |
| allinai.tools | redirects to **`/pricing`** |
| Google Sites | redirects to Google sign-in — and Google SSO cannot be automated |
| AlternativeTo, GetApp, SaaSHub, EU Startups, Launching Next, BacklinkDirs | HTTP 403 anti-bot |
| StackShare | HTTP 429 |
| BAI.tools | 404 |
| BetaList, BetaPage, ListedAI, 1000userguide, evite, ia-insights.fr | no submission form at the listed path (BetaPage now redirects to pitchwall.co) |
| **ainavbar.ai** | **open form, url + email fields, no redirect** |

Cheap probe that separates the four failure modes in one pass — run it before ever
opening a browser:

```js
const loginWall = /sign in with google|continue with google|you must be logged in|please (log ?in|sign ?in)|href="[^"]*\/(login|signin|auth)/i.test(body);
const hasUrlField = /<input[^>]*(name|id|placeholder)="[^"]*(url|website|link)/i.test(body);
// verdict: HTTP>=400 | loginWall | hasUrlField ? OPEN-FORM : no-form
// ALWAYS also compare r.url to the requested URL — a 200 at /pricing or /login is not an open form.
```

Two judgment rules that matter more than the list itself:

- **Category fit beats volume.** Most of these lists are AI-tool directories. Submitting a
  non-AI product to them is a topical mismatch that gets rejected or ignored; the same
  community sources also report free AI-directory listings carry no SEO benefit.
- A 200 status is not an open form, and a rendered form is not a listing. Keep the
  `candidate → submitted → publicly listed → indexed → follow/nofollow` states separate.

### BacklinkDirs is a reciprocal backlink-directory catalog, not a general product directory (2026-07-30)

A live, authenticated Chrome check of `https://backlinkdirs.com/submit` corrected the
earlier shorthand that treated its HTTP 403 as the main blocker:

- The submission form only accepts navigation sites, blogs, directories, or list-style
  sites that let other website builders add external links. It asks for a real
  **Submit Link** on the submitted site. A consumer content/tool site without such an
  intake route is not eligible; never invent a submission URL just to pass the form.
- The free plan is a reciprocal-link trade: the submitter must link back to
  BacklinkDirs, and the listing remains live only while that backlink remains live.
- Details creation requires a square PNG/JPEG icon and a PNG/JPEG listing image under
  1 MB. The DR field's controlled input clears literal `0` even though a zero-authority
  domain is valid; do not silently inflate the metric in future runs.
- Creating Details produces only a draft (`plan=free`, `status=submitting`). It then
  reveals the item-specific reciprocal URL:
  `https://backlinkdirs.com/item/<listing-slug>`. The free checker fetches the submitted
  product homepage, not the separate **Submit Link** page. Put that exact item URL in a
  real, visible homepage/Footer anchor; a reciprocal link that exists only on a
  resources page will not pass detection. Never hide it with CSS.
- A 2026-07-30 run verified a platform failure after the exact Footer link was live:
  the free-review handler crashed while reading an undefined response `status`, and the
  Dashboard stayed `submitting`. Treat this as a draft, stop repeat-clicking, and record
  `review submission unconfirmed`; it is not a submitted, approved, or public backlink.
- The one-time Pro plan was **£9.9** and waived the backlink requirement; subscription
  and sponsor plans were also paid. Prices are a dated observation, so re-check the
  live pricing page before quoting or purchasing.
- Authentication and a visible form prove only `auth ready`. If the product is
  ineligible, the correct ledger state is `rejected — category/reciprocal-link mismatch`,
  not `submitted`.

Decision rule: reject BacklinkDirs for ordinary content sites and tools that do not
operate a genuine third-party link-submission or editorial-resource intake. If the site
has a real intake and the user explicitly accepts the visible reciprocal Footer link,
the free path is allowed. A paid plan still needs explicit user approval and does not
override the site's product-type acceptance policy.

### JS eval fallback for tricky forms

When snapshot can't detect fields (React forms, iframes, dynamically loaded content),
use eval-based filling:

```bash
bb-browser eval '(() => {
  const el = document.querySelector("input[name=url]");
  if (!el) return;
  el.focus();
  el.value = "https://example.com";
  el.dispatchEvent(new Event("input", {bubbles:true}));
  el.dispatchEvent(new Event("change", {bubbles:true}));
})()'
```

This fires React/Vue change handlers that raw `.value =` assignment misses.

## Site Categories by Success Rate

### Tier 1: PHP web directories (batch-direct.mjs, ~90% success)

Simple `submit.php` forms with name/url/email/description fields. Best for automated submission.

**Confirmed working (2026-04-10 SBTI campaign):**
ASR, Sonic Run, Promote Business Directory, Tap4 AI, 9Sites.net, Highrankdirectory,
Site Promotion Directory, Marketing Internet Directory, ProLinkDirectory,
Free PR Web Directory, Free Internet Web Directory, Quality Internet Directory,
UK Internet Directory, USA Websites Directory, World Web Directory, GainWeb.org,
Submit.biz, OnToplist.com, Offpagesavvy, 01webdirectory, DropYourAI, ToolHunter.ai,
AI NAV, Cooltools.

**Re-confirmed 2026-07-17:** Sonic Run, Promote Business Directory, Tap4 AI.
**Regressed since April (now login-walled or form gone, verified 2026-07-17):**
ToolHunter.ai (login required), Interested In AI (login required), AI NAV,
Free AI Tool, 2AGI, AIGC工具导航 (all "no fields" even with extended waits).

### Tier 2: AI directories with open forms (agent-browser, has CAPTCHA)

Future Tools has a working form but requires Cloudflare Turnstile CAPTCHA —
form can be filled automatically but submit blocked by human verification.
Best approach: fill via agent-browser, then user manually clicks CAPTCHA.

### Tier 3: Require login (manual or agent-browser with auth)

Most AI directories require account creation before submitting:
AIWikiTools, Changelog, Alternative.me, AI Tools Up, findcool.tools.

Use agent-browser with `--session-name` to persist login across submissions:
```bash
agent-browser --session-name backlinks open https://site.com/login
# login manually once, then:
agent-browser --session-name backlinks open https://site.com/submit
```

### Tier 4: Paid or closed

aiwith.me ($19.9/submission), dang.ai ($29), Free AI Tool (paused),
There's An AI For That (paid listing), Product Hunt (scheduled launch).

### Dead / Down (skip these)

Thales Directory (404), AI-Hunter.io (500), SpotTheAI (domain for sale),
aitoolforbusiness.com (expired), aitoolsup.com (SSL expired),
insanelycooltools.com (403), MicroLaunch (Cloudflare block),
Viesearch (timeout), Futurepedia (404).

### agent-browser vs bb-browser

| Feature | agent-browser | bb-browser |
|---------|--------------|------------|
| Snapshot format | `@e1`, `@e2` (stable) | `@0`, `@1` (ref=N format) |
| Form detection | Excellent (labels, roles) | Needs regex parsing |
| Runs headless | Yes (default) | No (needs visible Chrome) |
| Session persistence | `--session-name` | None |
| Best for | Complex forms, debugging | Batch simple forms |

Prefer agent-browser for interactive/complex sites. Use bb-browser batch
script on Mac Mini for bulk simple directory submissions.

## Pacing

- Wait 5+ seconds between sites
- Max 40-50 submissions per session
- Don't submit the same URL to the same site twice

## Other Submission Methods

### IndexNow (search engine notification)

Notify Bing, Yandex, and other search engines about all your pages at once.
IndexNow accepts bulk submissions (up to 10,000 URLs per request).

**Step 1: Generate a key and create verification file**

```bash
KEY=$(uuidgen | tr -d '-' | head -c 32)
echo "$KEY" > public/$KEY.txt
echo "Key: $KEY — deploy site so the file is live at https://yourdomain.com/$KEY.txt"
```

**Step 2: Extract URLs from sitemap and submit**

```bash
URLS=$(grep '<loc>' public/sitemap.xml | sed 's/.*<loc>//' | sed 's/<\/loc>.*//' | \
  python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin]))")

# IndexNow API (shared endpoint, covers multiple engines)
curl -X POST "https://api.indexnow.org/IndexNow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"host\":\"yourdomain.com\",\"key\":\"$KEY\",\"keyLocation\":\"https://yourdomain.com/$KEY.txt\",\"urlList\":$URLS}"

# Yandex (accepts without key verification)
curl -X POST "https://yandex.com/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"host\":\"yourdomain.com\",\"key\":\"$KEY\",\"keyLocation\":\"https://yourdomain.com/$KEY.txt\",\"urlList\":$URLS}"

# Bing (requires key file deployed first)
curl -X POST "https://www.bing.com/IndexNow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"host\":\"yourdomain.com\",\"key\":\"$KEY\",\"keyLocation\":\"https://yourdomain.com/$KEY.txt\",\"urlList\":$URLS}"
```

**Expected responses:** 202 = accepted, 403 = key file not found (deploy first).

**Gotcha:** Bing requires the key file to be live before accepting. Yandex and the
shared IndexNow API are more lenient. Deploy the key file, then re-submit to Bing.

**Gotcha 2 (2026-07-17):** Cloudflare **Bot Fight Mode blocks IndexNow verification**.
With BFM on, Bing and api.indexnow.org return 403 "UserForbiddedToAccessSite" even
when the key file is live (their key-verification fetch gets challenged); Yandex
still accepts (202). Check `curl -sI https://yourdomain.com/$KEY.txt` returns 200
AND confirm BFM/WAF isn't challenging bots before blaming the key file — then
re-submit to Bing after BFM is off.

### GitHub Awesome Lists (high-ROI third-party citations)

Fork the repo → add your entry to README.md → submit PR. A merged, relevant entry is a
high-quality third-party citation from a trusted GitHub project. **Do not call it
"dofollow" from a repo's reputation alone**: open the final rendered page and inspect the
actual outbound anchor before recording link attribute or authority-transfer claims.

**Best targets for web apps:**

| Repo | Stars | Fit |
|------|-------|-----|
| aviaryan/awesome-no-login-web-apps | 3.1k | Free apps without login |
| unicodeveloper/awesome-nextjs | 9k+ | Next.js projects |
| mezod/awesome-indie | 9k+ | Indie developer projects |
| sindresorhus/awesome | 300k+ | Meta-list (need 30+ days old) |

**Workflow:**

```bash
# 1. Fork and clone
gh repo fork <owner>/<repo> --clone=false
git clone https://github.com/<your-user>/<repo>.git
cd <repo>

# 2. Add your entry to README.md (bottom of relevant category)
# Format: - [Product Name](https://url) - One-line description ending with period.

# 3. Create branch, commit, push, PR
git checkout -b add-<product>
git add README.md
git commit -m "Add <Product Name>"
git push origin add-<product>
gh pr create --repo <owner>/<repo> --title "Add <Product Name>" --body "..."
```

**Tips:**
- Follow each repo's CONTRIBUTING.md strictly
- Keep description concise, end with a period
- Don't include UTM params in awesome-list URLs (they'll reject it)
- One PR per repo, be patient — maintainers may take weeks

### Owned GitHub Reference Guide (zero-login, quality-first)

An organization-owned public GitHub repository can be a durable **public reference and
referral surface** for a finished website. It is useful when it gives readers a maintained,
machine-checkable directory or reference dataset—not when it disguises itself as an
independent review or a link dump.

**Truth boundary:** this is an owned citation, not a third-party editorial backlink. Public
visibility proves only that the page is accessible. It does **not** prove a follow link,
indexing, authority transfer, ranking benefit, or referral traffic.

#### When to use it

Use this pattern only when all of the following are true:

- The site has a stable canonical URL set (normally a production sitemap) and useful public
  pages worth navigating.
- The owner can publish under a real GitHub user or organization; no fake persona or false
  "independent" branding is involved.
- The repository adds reader value: a categorized directory, clear editorial method,
  authoritative source list, a license, and a reproducible integrity check.
- Descriptions are original, concise route summaries—not copied article text, keyword
  stuffing, or unsupported medical/scientific claims.

Skip it for a one-page landing site, a site with unstable canonicals, or a README that would
amount to nothing more than a row of self-links.

#### Recommended repository shape

| File | Purpose |
|---|---|
| `README.md` | Ownership disclosure, what the reference covers, direct official-site link, fact-versus-tradition policy, non-medical boundary where relevant, maintenance method, and no-SEO-guarantee statement. |
| `SITE_DIRECTORY.md` | Human-readable routes grouped by user intent; every official URL gets one original one-sentence introduction. |
| `site-directory.json` | Machine-readable equivalent with at least `title`, `url`, `category`, and `summary`. |
| `SOURCES.md` | Descriptively named primary/institutional sources; do not use bare URLs or claim a source supports an unverified fact. |
| `LICENSE` | Explicit documentation license, with a boundary for third-party assets/content. |
| `scripts/verify-directory.mjs` | Zero-dependency verifier that makes directory drift a failing build instead of a future cleanup task. |

Set a clear public description, homepage URL, and relevant topics when creating the repository:

```bash
gh repo create <org>/<reference-repo> --public \
  --description "A curated public directory to <site>'s guides and tools." \
  --homepage "https://example.com" --source=. --push
gh repo edit <org>/<reference-repo> --add-topic <topic-1>,<topic-2>
```

#### Canonical-directory gate (mandatory)

Use the production sitemap as the only URL source of truth. Before publishing and after any
directory update, the verifier must fail unless all of these are true:

1. Sitemap, Markdown directory, and JSON directory have the same unique URL set and count.
2. Every owned-site destination is exact canonical HTTPS: no query, fragment, userinfo,
   nondefault port, `www`, HTTP, preview/staging host, or unlisted path.
3. The verifier scans **every Markdown link destination**, then rejects noncanonical variants;
   counting only links that already match the canonical pattern is a silent-corruption bug.
4. Every target returns HTTP 200 and its final response URL equals the requested canonical URL;
   accepting a same-host redirect hides canonical drift.
5. A negative self-test proves that adding a same-site `?utm=` or `#fragment` link exits
   nonzero without mutating committed documentation.

Run this independent of the author before counting the surface:

```bash
npm run verify
node scripts/verify-directory.mjs --self-test
git ls-remote https://github.com/<org>/<reference-repo>.git refs/heads/main
curl -fsSL https://api.github.com/repos/<org>/<reference-repo>
```

Then use a fresh, unauthenticated browser session to verify GitHub renders the README and
directory publicly, the expected link count is visible, and representative pages from each
category load on the official domain. A local clone or an owner-authenticated browser is not
enough evidence of public availability.

#### Required ledger states

Record this separately from directory submissions:

| State | What can count as evidence |
|---|---|
| Candidate | Relevance and intended reader value have been reviewed. |
| Auth ready | The owner can publish under the real GitHub org/user. |
| Submitted | **N/A** for an owned repo; it is not a third-party directory form. |
| Approved / public | Fresh unauthenticated GitHub HTML/API shows public visibility and final `main`. |
| Target links | The canonical-directory gate and browser extraction pass. |
| Link attribute | Only verified after inspecting the rendered outbound anchor; otherwise mark unverified. |
| Indexed | Only verified from a search-engine surface, never inferred from GitHub availability. |
| Referral observed | Only verified from analytics/referrer data. |

**Verified example (2026-07-23):** `butterflydream-ai/birthstone-meaning-guide` used this
structure for 31 production canonical pages. Independent browser, verifier, and review gates
passed only after the verifier was strengthened to reject query/hash/HTTP/www/subdomain/preview
variants. Treat it as an owned public citation surface—not a confirmed follow link or ranking
win.

## Monitoring

Check progress while batch runs in background:

```bash
ssh mac-mini 'zsh -lc "tail -20 /tmp/backlink-pilot/batch-direct.log"'
```

Or grep for results:

```bash
ssh mac-mini 'zsh -lc "grep -E \"SUCCESS|ERROR|SKIP\" /tmp/backlink-pilot/batch-direct.log"'
```

## High-DA platform submissions via the user's own browser (2026-07-17 lessons)

For DR 88-96 platforms (dev.to, medium, linktr.ee, gumroad, dribbble, behance…) the
play is profile links / articles from the user's own accounts, driven through
OpenCLI on their real Chrome. Verified findings:

- **Login-state probe playbook** (open the URL; redirect-to-login = signed out, do not interact):
  dev.to `/settings`→`/enter` · hashnode `/settings`→`/login` · linktr.ee `/admin`→`/universal-login` ·
  carrd `/dashboard`→`/login` · gumroad `app.gumroad.com/settings`→`/login` · dribbble `/account`→`/session/new` ·
  mssg.me app = `next.mssg.me` (root→`/auth/login`) · Product Hunt settings loads at `/my/settings/edit`
  but the Website field lives at `/my/details/edit`.
  Bad probe URLs: `about.me/edit` is a username page (use `/account`); `behance.net/settings/profile`
  404s (read the homepage header's Adobe IMS login state); `my.mssg.me` 404s; `taplink.cc/admin`
  bounces to the marketing site.
- **Medium sentinel**: `/me/settings` auto-fires Google SSO; a Google session with no Medium
  account lands on `medium.com/unrecognized-account` — that URL means "no account", skip.
- **Google SSO cannot be automated.** accounts.google.com silently swallows scripted clicks
  and keyboard events on the account chooser (three strategies failed: form-button click,
  account-tile click, focus+Enter). If a site needs "Sign in with Google", the ONE click on
  the Google account tile must be the user's own — queue those sites for a moment when the
  user is present, then automate everything after the session exists.
- **Google product SPAs (GSC etc.) are similarly automation-hostile**: inputs reset between
  commands on re-render. Type + click in the same command invocation helps but is not reliable.
- OpenCLI v1.7.22 syntax: `opencli browser <session> <cmd>`; click/type take numeric refs
  (`click 42`, NOT `@42`); `find --name/--role/--css`; `keys Enter` (not `press`); `state`
  can throw on mid-load DOMs — wait and retry or use `extract`.
- A GitHub Pages org site (`<org>.github.io`) can be a zero-login, publicly visible owned
  reference surface: `gh repo create <org>/<org>.github.io --public --source . --push` with
  an `index.html`. Pages availability depends on the org/repository Pages settings, so verify
  the deployed URL; inspect final outbound anchors before calling any link follow/nofollow.
  It is extensible, but remains an owned citation rather than third-party editorial coverage.

## Cleanup (after every campaign)

The batch leaves state on the Mac Mini — clean it when the run is done:

```bash
# Kill the Chrome instance the batch spawned (its processes carry the
# bb-browser profile dir). Do NOT kill the bb-browser daemon itself
# (node .../bb-browser/dist/daemon.js) — that's shared infrastructure.
ssh mac-mini 'zsh -lc "pkill -f \"user-data-dir=/Users/yan/.bb-browser\""'

# Remove the clone + logs once results are recorded
ssh mac-mini 'zsh -lc "rm -rf /tmp/backlink-pilot"'
```

Record the submitted/confirmed site list in the project's `.rankup/decisions.md`
(or equivalent) BEFORE deleting logs — you need it to avoid duplicate submissions
next campaign.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "bb-browser cannot connect to Chrome" | `ssh mac-mini 'zsh -lc "bb-browser open about:blank"'` |
| "Tab not found" / "无效的标签页索引" | Kill Chrome, restart: use `open` without `--tab` |
| "No recognizable form fields" | Check snapshot format parsing; try JS eval fallback |
| ETIMEDOUT on bb-browser commands | Chrome unresponsive — kill and restart |
| Chrome CDP link dead (commands hang/400) | `bb-browser daemon shutdown` → `pkill -f 'user-data-dir=/Users/yan/.bb-browser'` → `bb-browser open <url>` (verified recovery recipe 2026-07-17) |
| `js-yaml` "no default export" on Node 25 | use `import { load } from 'js-yaml'` (skill script patched 2026-07-17) |
| Form filled but page unchanged | Site likely requires login or has CAPTCHA |
