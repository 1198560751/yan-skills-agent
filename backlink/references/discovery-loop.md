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

## State separation

Keep these states distinct:

`candidate → qualified → drafted → filled → submitted → public → indexed → rel_verified`

Never infer a later state. In particular, a filled form, confirmation screen,
email, or pending moderation notice is not a public backlink.
