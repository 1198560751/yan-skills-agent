# BacklinkDirs free reciprocal-listing workflow

Use this reference only for `backlinkdirs.com`. Its product gate and reciprocal-link
sequence are stricter than an ordinary directory form.

## 1. Qualification gate

The authenticated Details form says it accepts only navigation sites, blogs,
directories, or list-type sites that allow adding external links. It requires a real
**Submit Link**.

Proceed only when all of these are true:

1. The submitted site permanently operates a useful resource list, directory, or
   comparable editorial collection.
2. A real public intake already exists and lets third parties propose relevant links.
   Email intake with documented editorial criteria is acceptable; it does not need a
   database.
3. The owner explicitly accepts a visible reciprocal BacklinkDirs link on the
   submitted homepage or Footer for as long as the free listing remains live.
4. The resource feature is useful without BacklinkDirs. It is not a temporary review
   route, cloaked page, hidden anchor, or empty list created only to pass approval.

If any item fails, record:

`rejected — category/reciprocal-link mismatch`

Do not invent a Submit Link or recommend a hidden/temporary route.

## 2. Verify the permanent feature before submission

Require production evidence for:

- the resource/list page;
- the Submit Link page and actual intake action;
- desktop and mobile navigation to both routes;
- unique metadata/canonical URLs and sitemap inclusion;
- safe external-link behavior;
- a visible homepage/Footer location reserved for the later reciprocal item URL.

For a new feature, test and deploy it before creating a BacklinkDirs record. A local
route or preview deployment is not sufficient.

## 3. Prepare truthful Details fields

Check the live form because labels and limits can change. The 2026-07-30 form required:

- HTTPS homepage URL;
- name of at most 32 characters;
- one or more categories and tags;
- DR and monthly visitors (MV);
- Submit Link;
- short description and Markdown introduction;
- square PNG/JPEG icon, max 1 MB;
- 16:9 PNG/JPEG listing image, max 1 MB.

Use a reputable current source for DR and MV. Record the source and observation date.
Do not infer DR from a site's age or replace `0` with `1`. Do not copy unsupported AI
Autofill claims: inspect every populated field and restore the truthful categories,
tags, description, and introduction before submission.

Suggested states:

| State | Meaning |
|---|---|
| `qualified` | Permanent feature and reciprocal authorization verified. |
| `auth ready` | Authenticated dashboard/form visible. |
| `details blocked` | No draft exists because validation or required truth blocks Details. |
| `draft` | Dashboard shows one identifiable record and exact item URL. |
| `reciprocal live` | Exact item URL is visibly present on the production homepage/Footer. |
| `review requested` | Free-review action was triggered once and acknowledged. |
| `published` | Public item page is live and links to the submitted site. |
| `indexed` | A search-engine surface independently shows the public item page. |

Never collapse these states into “submitted.”

## 4. DR=0 validation failure and manual fallback

Observed 2026-07-30 behavior:

- an Ahrefs-powered checker returned DR `0`;
- BacklinkDirs AI Autofill returned about `3.36K` MV;
- the Details form cleared DR `0` and showed
  `Expected number, received string`;
- normal fill and native spinner-key interaction did not make the truthful zero pass;
- therefore no BacklinkDirs draft was created.

When this exact failure occurs:

1. Stop before submission; do not enter `1`, `0.1`, or another invented value.
2. Capture the validation text and the current metric sources.
3. Email `support@backlinkdirs.com` with the complete truthful field set, production
   resource URL, Submit Link, metric evidence, and required images.
4. Ask support to fix validation or create the free-plan draft manually.
5. Record `details blocked — DR=0 validation; manual request sent`.
6. An outbound email is not a draft, review request, approval, or backlink.
7. Check the dashboard and email thread later. Do not create duplicates while awaiting
   support.

## 5. Draft and exact reciprocal URL

After Details succeeds or support creates the record:

1. Re-open the dashboard and confirm exactly one matching draft.
2. Record its plan and status without upgrading the claim. A typical pre-publication
   state is `plan=free`, `status=submitting`.
3. Obtain the item-specific URL shown by BacklinkDirs:
   `https://backlinkdirs.com/item/<listing-slug>`.
4. Add that exact URL as a normal visible anchor on the submitted homepage/Footer,
   for example `Listed on BacklinkDirs`.
5. Do not link merely to `https://backlinkdirs.com/`, put the anchor only on a deep
   resource page, hide it with CSS, or add `nofollow` when the free checker expects the
   reciprocal link.
6. Test/build, deploy, and verify the exact href in live homepage HTML and a browser.

The item URL cannot be guessed before the record exists.

## 6. Request free review once

Only after the exact reciprocal URL is live:

1. Re-open the same draft.
2. Trigger the free review/publish action once.
3. Observe the toast, redirect, dashboard status, and public item URL.
4. If the handler errors or the state remains ambiguous, stop. Record
   `review submission unconfirmed` and do not repeat-click.
5. Do not buy Pro, sponsor placement, or a subscription without explicit user approval.

Count a backlink only when the public item page is reachable and its outbound link is
verified. Keep indexing and follow/nofollow verification as separate later checks.

## 7. Evidence ledger

Record these fields for handoff and future monitoring:

```yaml
target: backlinkdirs.com
site: https://example.com/
resource_url: https://example.com/resources/
submit_link: https://example.com/submit-link/
qualification: qualified | rejected
auth: ready | blocked
details: not-started | blocked | draft
details_blocker: null
manual_request:
  sent: false
  recipient: support@backlinkdirs.com
  message_id: null
item_url: null
reciprocal:
  live: false
  verified_at: null
review:
  attempted: false
  state: not-requested
public_listing:
  live: false
  verified_at: null
indexed: unverified
link_attribute: unverified
```

Update only the state proved by the latest authoritative surface.
