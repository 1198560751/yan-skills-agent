# Backlink operation safety

- Use the owner's truthful identity and product information.
- Never fabricate comments, endorsements, metrics, addresses, or personas.
- Require article-specific comments that add useful context; reject generic praise.
- Stop on login requirements, CAPTCHA, Turnstile, ambiguous forms, multiple
  candidate forms, paywalls, or changed DOM fingerprints.
- Default every OpenCLI browser session to background mode. Do not use foreground
  mode or click a launcher that steals focus unless the user explicitly requests it.
  Background mode is not headless — it drives the owner's real logged-in Chrome
  (`navigator.webdriver=false`, no Headless UA, `visibilityState=visible`), so
  there is never a reason to reach for foreground to "look more human".
- Never hardcode a literal OpenCLI session name in a script. A session name is a
  tab claim; two concurrent tasks sharing one name share one tab and silently read
  back each other's pages. Suffix defaults with `CLAUDE_CODE_HOST_SESSION_ID` and
  always leave a `--session` override.
- Fill fields only. Keep the submit guard active and leave final submission to
  the user unless the user separately authorizes one exact submission after review.
- Never automate Google account-chooser clicks.
- Do not submit to adult, spam, malware, or link-farm pages.
- A different topic is NOT a reason to skip a target. Relevance ranks candidates,
  it does not gate them; when there is no relevant option, quantity wins. Keep the
  comment body specific to the article and put the link in the URL/name field.
  See [acquisition-doctrine.md](acquisition-doctrine.md).
- Do not use hidden reciprocal links, temporary eligibility pages, or cloaking.
- Do not resubmit an unconfirmed target; investigate its public state first.
- Never call a link follow, indexed, authoritative, or traffic-producing without
  direct evidence for that exact claim.
- Respect robots.txt, terms, rate limits, paid-plan boundaries, and account scope.
