# M2c: Reliable sign-in email on Railway

Status: in progress
Review by Claude: no

## Goal
Fix the production magic-link request hanging while SMTP connects.

## Context and decision
Railway logs on October 4 show Better Auth Connection timeout errors.
Railway Hobby does not allow outbound SMTP; use existing Resend over HTTPS.
Noe approved connecting the existing account. No purchases or plan changes.

## Do
Add a server-only Resend transport for fixed system-mail templates, with a
10-second deadline and sanitized failures. Keep SMTP compatibility with bounded
timeouts and cleanup. Limit the sign-in browser request to 20 seconds, without
automatic retries. Preserve allowlist, beta gate, token hashing and next URL.
Document private configuration; test success, failure, timeout, and origin checks.

## Don't
Change authentication authorization or send newsletters. Never log keys or
production sign-in URLs. No dependencies, database migration, or main merge.

## Done when
Typecheck, full tests (document Windows baseline), build, deployment and approved
test email verified. Inbox receipt and first sign-in remain separate checks.

## Report
- Code complete; production delivery verification pending deployment.
- Typecheck and production build passed on October 4, 2026.
- New regression tests failed before implementation; all 10 focused tests pass after it.
- Full suite: 3,634 passed, 5 failed; 8 failing files including cleanup hooks.
- Failures match AGENTS Windows baseline: interaction-layer, paths, seed timeout,
  skills-plugins, superset-dispatch, lead-magnet-actions, lead-magnets-route, roadmap-mock-5h.
- No dependency changes. Provider errors are sanitized; no SMTP fallback after a
  failed Resend request, to avoid accidental duplicate mail.
- Noe approved the dedicated domain-scoped sending-only key and one sign-in test
  to noster@nostermarketing.com. Key and SYSTEM_MAIL_FROM staged privately in Railway.
- Configure RESEND_API_KEY and SYSTEM_MAIL_FROM in Railway; HTTPS takes precedence
  over legacy SMTP. Existing SMTP credentials are untouched, not copied or logged.
- Resend dashboard shows nostermarketing.com Verified. No plan upgrades/purchases.
- Deployment, provider delivery and inbox confirmation still to be checked.
