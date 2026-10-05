# M4-M5: Workspace connections and collected dashboard data

Status: implementation verified locally; deployment and live provider setup pending
Review by Claude: no; Astra security self-review required

## Goal
Turn M3 credential storage into explicit account connection flows and a real,
workspace-scoped dashboard. Never use operator credentials or fabricated numbers.

## Decisions
- Work on codex/m4-m5-connected-dashboard; deployment requires Noe's approval.
- Reuse AES-GCM vault, SQLite repositories, session guards and cron tick. No dependencies or purchases.
- OAuth state binds workspace, user, provider and nonce; ten-minute expiry, one-use server record, PKCE where supported. Verifiers/tokens stay encrypted server-side.
- Google data OAuth is separate from sign-in OAuth. GBP and LinkedIn authorization remain disabled pending Noe's decision on their broad management scopes. Never request Gmail scopes.
- Google/Meta/TikTok/LinkedIn/Etsy platform registration, permissions and account consent are external prerequisites, not implied by a saved key.
- Only read provider data. No posts, messages, invoices, payments, advertising changes or provider-account mutations.
- One selected resource per source per workspace initially. Changing a source keeps prior history but invalidates its visible snapshot until a new sync succeeds.
- Stripe uses restricted keys; cannot prove a key lacks write scopes without unsafe writes, so say read-only access is requested, not verified. Separate test/live context; do not combine currencies.
- Email collects INBOX counts only via TLS IMAP and known provider hosts, no message bodies, attachments, contacts or sends. Custom hosts wait for a reviewed SSRF-safe connector.
- Jobs use explicit workspace leases, persistent source claims, bounded I/O, per-workspace/tick budgets and fair scheduling. Failures preserve last-good data with stale/error labels.
- Dashboard reads stored snapshots only; missing fields stay unknown, real zero remains zero. Each value has a source, unit, period and capture time.
- Provider versions requiring approval/configuration stay disabled until configured. No guessed access or silent environment fallback.
- Home gets the scoped dashboard when host features are disabled; preserve the old operator home behind its existing gate.

## Done when
- Tests cover state tampering/replay/expiry/user/workspace mismatch, role/origin/stale-form denial, encrypted tokens, refresh/revoke races, fixed-host requests, pagination/budget failures, currency separation, null versus zero, stale snapshots and two-workspace isolation.
- Typecheck, full tests (known Windows baseline noted), build, desktop/mobile checks; report exact remaining account setup blockers.

## Report
- Worked on 2026-10-04; branch codex/m4-m5-connected-dashboard, based on main a16ff0c. No merge or production deployment in this session.
- Added source setup/authorization, opt-in collection, disconnect confirmation and scoped overview/Search/Money/Social dashboards; retained legacy host pages behind their operator gate.
- Implemented Google Search Console/GA4/YouTube, Stripe charges, Facebook/Instagram/Meta Ads, TikTok, Etsy shop counts and TLS IMAP count adapters. No real account connections or app registrations were created.
- Added workspace source/history repositories, metric definitions, encrypted OAuth slots, session-bound one-use state, PKCE, token refresh and bounded fixed-host reads. No dependency changes.
- Added persistent claims, 15-minute minimum cadence, fair workspace iteration and job budgets; maintained the cron response array contract. Scheduled cloud collection currently runs only with host features disabled, as in the private beta.
- Security self-review: admin roles/origin/stale-workspace forms, state tampering/expiry/session/replay, encrypted token storage, reauthorization and refresh/disconnect races, resource/host validation, time/size limits, null-vs-zero and cross-workspace writes covered by tests. No customer secrets in env or client responses.
- Google Business Profile and LinkedIn remain disabled. Auto-review rejected adding broader LinkedIn management scope without specific approval; Noe was asked, no answer received. No workaround or broader scope added.
- Google Ads, TikTok Ads, advanced Etsy revenue/ledger/CSV, product/CRM collectors and lead/action intelligence remain follow-up work; their cards are explicitly planned. This does not complete all dashboard roadmap integrations.
- Typecheck passed. Full suite: 3,684 passed, 4 failed assertions out of 3,688; 346 files passed, 7 failed. Remaining failures are the documented Windows baseline: lead-magnet-actions, lead-magnets-route, roadmap-mock-5h, interaction-layer, paths, skills-plugins and superset-dispatch. All 26 new cloud tests passed.
- Updated route smoke inventory and host-boundary assertions to distinguish reviewed workspace adapters from operator-only connectors; added callback denial and scheduler contract coverage. Did not relax legacy operator checks.
- Local fixture browser check: 1366px desktop, 390px and 320px mobile; no horizontal document overflow, filters, keyboard confirmation and safe error feedback exercised. Used compiled app CSS with a monospace fallback; not a signed-in production or real-provider end-to-end test.
- Initial and final production builds passed. Temporary fixture server stopped, existing localhost:4100 development server left untouched.
- Provider setup and exact current limitations are documented in docs/architecture/cloud-connections.md. Privacy/deletion/terms review remains required before public provider onboarding; no legal copy published.
- Next: obtain deployment approval, register/approve provider apps and scopes, set private platform configuration, have each workspace owner consent, and verify its first real sync. No purchases, real messages, charges, credentials or Railway changes made here.
