# M5j: Provider onboarding and account selection

Status: checkpoint implemented; provider activation and deployment blocked
Review by Claude: no (Astra self-review)

## Goal
Continue Google Business, TikTok, Etsy, LinkedIn, Google Ads and PayPal setup
without fake connected states, public launch, purchases or write operations.

## Decisions
- Noe approved Google's Business Profile terms and its broad business.manage
  permission. Keep that authorization in a separate encrypted OAuth slot;
  never add this scope to existing Analytics/Search Console/YouTube tokens.
- Gate Business Profile sign-in on explicit verified platform readiness, not
  just the shared Google client credentials. Its current project has zero quota.
- Noe chose a separate OmegaOS Etsy app, then approved Etsy terms and creation.
  The new app is Pending Personal Approval. Leave existing Etsy apps untouched.
- Add bounded Business Profile location and Etsy owner-shop selection using
  existing admin/origin/workspace and post-request generation checks.
- Keep customer tokens encrypted per workspace; no tokens or app secrets in
  browser responses, logs, specs or committed configuration.
- Do not equate PayPal identity login with merchant financial reporting.
  LinkedIn needs approved Community Management access; investigate the minimal
  read-only r_organization_admin permission before enabling it.
- Google Ads now uses Cloud-project API access levels (developer tokens sunset
  September 9, 2026). No ad spend, mutations or paid Cloud setup are authorized.

## Verification
Tests first for selection, malformed responses, bounded pagination, workspace
isolation, disconnect races, separate Google scopes and platform readiness.
Run typecheck, full suite and build; record known Windows baseline separately.
Live consent and sync are separate from fixture tests. Publishing needs approval.

## Report
- Oct 5, 2026: created separate Etsy omegaos app; Pending Personal Approval.
- Existing Etsy apps untouched; pending app has no action menu for callback setup.
- No Etsy credentials installed in Railway; finish callback/secrets after approval.
- Enabled all three approved GBP APIs; Account Management quota remains zero.
- GBP needs Basic API access approval; verified/active 60+ day profile eligibility is unconfirmed.
- Added gated, separate GBP authorization and bounded GBP/Etsy account selection.
- Added Etsy app headers to token exchange/refresh; GBP totals require all 28 days.
- Nine new tests cover readiness, narrow scopes, selection, token races and partial data.
- Typecheck/build pass; full suite 3,735 pass, four baseline assertions fail plus three baseline teardown failures.
- Initial security-audit failures fixed by centralizing Etsy app-secret access in the reviewed OAuth module; no audit tests weakened.
- Self-review: fixed HTTPS hosts, GET-only discovery, bounded payload/pages, encrypted workspace tokens, post-read generation checks, no automatic enrollment.
- TikTok/LinkedIn still need sign-in; PayPal signed in but sandbox app-creation approval pending; Google Ads activation approval pending.
- No live consent/sync verified, paid services, real messages, secret changes or deployment performed; UI covered by SSR tests, not a new authenticated browser session.
- Local checkpoint only; main already had unpushed M5i commit 533c280. Obtain deployment approval before pushing either.
- Next: provider approvals/logins, exact callbacks/private secrets, deploy approved code and verify real selection/sync; keep PayPal identity separate from reporting access.
