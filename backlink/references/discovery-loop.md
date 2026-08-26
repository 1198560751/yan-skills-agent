# Backlink discovery loop

Use this reference when the user asks to find new backlink opportunities rather
than operate an already-known target.

## Source idea

The workflow comes from the Web.Cafe post “博客评论外链自动发现和自动发布插件原理讲解”.
Its useful insight is a recursive graph, not blind mass commenting:

1. Start with a relevant competitor or known successful site.
2. Obtain its backlink rows from a logged-in Semrush/Ahrefs browser session,
   an authorized export, or another permitted source.
3. Classify each backlink URL. Keep real articles with public comments, profile
   pages, directories, resource pages, and editorial mentions separate.
4. Open likely article pages and inspect the comment area.
5. Extract external commenter website domains with
   `scripts/harvest-commenters.mjs`.
6. Add those domains to `scripts/discovery-queue.mjs`.
7. Fetch backlinks for the new domains and repeat at the next depth.
8. Stop expansion when new qualified domains per batch falls sharply, the
   configured depth is reached, or sources become off-topic/spam-heavy.

## Data-source rule

Prefer an existing OpenCLI adapter. If none exists, use a named OpenCLI browser
session and inspect `opencli browser <session> network` only inside the user's
authorized, logged-in account. Do not bypass CAPTCHA, rate limits, subscription
gates, or export limits. Never print cookies, authorization headers, or raw
credentials into logs or Skill files.

## Qualification

Score candidates on:

- topical relevance to the promoted page;
- public page quality and recent maintenance;
- content originality / Information Gain — does the page show original data,
  first-hand experience, or genuine expertise, or does it just restate what
  other pages already say? Post-March-2026-Core-Update, a page with real
  Information Gain is a stronger link source: it is more likely to rank and
  more likely to be cited in AI Overviews/AI Mode, both of which raise what a
  link from it is worth. [2026-08] This supplements traffic, quality, and
  maintenance below — it does not replace any of them;
- visible organic traffic or ranking evidence when available;
- outbound-domain saturation;
- no-login/public form availability;
- moderation and brand safety;
- whether the resulting link is publicly visible;
- observed `rel` attribute, recorded only after publication.

Treat comment links as auxiliary links. Low-authority comment volume may help a
low-competition site discover opportunities, but it is not a substitute for
editorial links in a competitive niche. Do not repeat unsupported causal claims
that backlinks alone caused traffic growth.

## Parallel lane: forum lists and automation-network footprints

Run this lane beside competitor/commenter expansion when a forum post or shared
table claims hundreds of comment targets:

1. Save the exact source URL and ingest the list as assertions, not verified
   channels, with `third-party-list-ingest.mjs`.
2. Match the normalized roots against `data/network-fingerprints.json` using
   `--blocklist`. A family match is emitted as `excluded`; it is never silently
   deleted, because the negative result is reusable backlink-audit evidence.
3. Cluster the remainder by repeated page title, form-field signature, template
   copy, CSS class, analytics ID, and shared comment backend. Count a cluster as
   one network event until independent operation is actually demonstrated.
4. Send only independent survivors into the ordinary traffic screen and page
   inspection loop. DR, DA, a live homepage, a visible Register button, or a
   third-party “dofollow” column cannot undo a network-family rejection.
5. Keep explicit exceptions. A legitimate platform accidentally mixed into a
   network list must be verified on its own; it does not inherit either the
   family rejection or the list's claimed authority.

```bash
node scripts/third-party-list-ingest.mjs \
  --input forum-list.md \
  --known data/free-channels.json \
  --blocklist data/network-fingerprints.json \
  --out .backlink/forum-leads.json
```

Measured 2026-08-27: the BlackHatWorld Money Robot thread contained 246 unique
roots. `full-design.com` was row 14; 172 roots still shared the fixed homepage
copy plus `motive-2017`. `edublogs.org` was retained as an explicit independent
exception, leaving 245 family-blocked roots. This is a discovery/filter source,
not a submission queue.

## State separation

Keep these states distinct:

`candidate → qualified → drafted → filled → submitted → public → indexed → rel_verified`

Never infer a later state. In particular, a filled form, confirmation screen,
email, or pending moderation notice is not a public backlink.
