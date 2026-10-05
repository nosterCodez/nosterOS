# M5k: Google Ads reporting connection

Status: implementation verified locally; provider setup and deployment pending
Review by Claude: no (Astra self-review)

## Goal
Implement the requested Google Ads connection behind verified platform readiness.
This is reporting, not campaign management, payments or automatic ad spending.

## Decisions
- Separate google-ads OAuth slot and callback; do not expand existing Google grants.
- Reuse the data app credentials only after approved setup; require an explicit
  OMEGA_GOOGLE_ADS_ENABLED flag and supported API version. Flag remains unset now.
- Google requires broad adwords consent; app code only calls list and search APIs.
- Discover directly accessible accounts and non-manager descendants. Persist
  manager/customer selection in the workspace source, never global configuration.
- Bound discovery to five account queries, 500 results and 15 seconds. Show truncation.
- Report previous 28 completed account-local days, USD spend only, clicks,
  impressions and reported conversions. Missing data stays null; no revenue claims.
- Current Google guidance sunsets developer tokens September 9, 2026. Use the
  OAuth project's Cloud API access level; distinguish production-access denial.
- No purchases, platform credential changes, account writes or deployment in this spec.

## Verification
Test first: scope isolation/readiness, bounded discovery, manager mapping,
disconnect races, dates/currencies/test labels, malformed responses and safe errors.
Run typecheck, full tests and build. Keep known Windows failures separate.
Fill Report and commit locally; pushing main requires deployment approval.

## Report
- Implemented separate Ads OAuth slot, callback, readiness gate and account picker.
- Added bounded account discovery and workspace-local manager/customer mapping.
- Added account-local 28-day reports with USD-only spend and explicit test labels.
- Missing values remain null; partial or malformed reports are rejected.
- Typed project-approval errors expose no raw provider messages or credentials.
- Eight new adapter tests failed first, then passed; added API isolation and UI tests.
- Typecheck and production build pass; full suite: 3,745 pass, four baseline assertions fail.
- Three baseline EPERM teardown failures remain (seven affected files total); no new failures.
- Security review checked provider-slot separation, origin/role/workspace gates and post-I/O rechecks.
- Also checked fixed-host requests, no redirects, bounded results, safe IDs and no campaign-write paths.
- Browser recheck: Etsy pending approval; TikTok awaiting email verification; LinkedIn at sign-in.
- Google Ads terms/access and PayPal sandbox-app approvals are still pending; GBP quota remains zero.
- No new credentials, Railway changes, purchases or deployment; live consent/sync remain unverified.
- Dev server retained on 4100; commit locally only until Noe approves deployment.
