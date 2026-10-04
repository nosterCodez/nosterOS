# M2c: Reliable sign-in email on Railway

Status: done
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
- Fix committed as 0864908 and pushed to m2-isolation; main remains unmerged.
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
- Railway deployment 80c59f99-e793-4e4e-a3db-a821e3952b38 succeeded; one healthy replica.
- Both private mail variables applied in production. Live form completed with
  the new success message and re-enabled its submit button.
- Approved live test email to the owner shows Delivered in Resend, message ID
  01a10905-d324-7ef4-aea0-527d0363e8bc, October 4 around 22:25 UTC.
- No sign-in token was printed, stored in this report, or consumed by the agent.
- Noe still needs to open the delivered link; provider delivery is not proof of
  inbox placement or completed sign-in. Online M2 two-workspace check remains pending.
