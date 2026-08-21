# Credits

This Skill absorbs work from other people. Their rules are marked where they are
used; this is the full list.

- **[flaqai/backlink_skills](https://github.com/flaqai/backlink_skills)** (MIT,
  Flaq AI) — the campaign-operations layer in
  [batch-campaign.md](batch-campaign.md): idempotency keys, execution shards, the
  verification-first pipeline that keeps one CAPTCHA from stalling a run,
  per-action authorization, resumable state, the anchor-text policy, and the
  reporting discipline that separates published listings from submitted forms.

  Their `Free-backlink-list.md` (743 entries) is also the largest third-party
  lead list this Skill has been tested against — see
  [instant-publish.md](instant-publish.md#reading-a-third-party-places-to-get-a-backlink-list).
  Their two Skills carry no channel list of their own and expect user-supplied
  URLs, so the list and the workflow are separate assets in that repo too.

- **[aaron-he-zhu/seo-geo-claude-skills](https://github.com/aaron-he-zhu/seo-geo-claude-skills)**
  (Apache-2.0) — the analysis templates, quality rubric, and outreach frameworks
  in [analysis-templates.md](analysis-templates.md),
  [link-quality-rubric.md](link-quality-rubric.md), and
  [outreach-templates.md](outreach-templates.md). Licence text is kept at
  `LICENSE-analysis-templates-Apache-2.0`.
