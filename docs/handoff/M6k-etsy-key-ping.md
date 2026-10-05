# M6k: Etsy key-only ping and error_description

## Request
Claude reports live discovery still returns HTTP 403 / unrecognized_provider_error
without message. Run GET https://api.etsy.com/v3/application/openapi-ping with only
production x-api-key, no user token. Record whether error/error_description exists,
and include their strings in masked diagnostics. Do not change Railway variables.

## Scope
- Railway's agent confirmed it has no runtime execution tool; local Railway CLI
  is absent. No live ping was possible through that route. Do not export secrets.
- One-off action: POST /api/admin/sources with {"action":"etsy-key-ping","id":"etsy"}
  under existing owner/admin, origin, session and x-omegaos-workspace guards.
- Fixed Etsy URL, GET, key-only header, no redirects, 8-second timeout, 64 KB body cap.
- Recheck owner/admin, user and workspace after I/O; log only masked result with
  workspace ID. No source state, user-token read/refresh or scheduler changes.
- JSON errorFields lists which approved fields exist, including non-string fields;
  empty means neither in a parsed object; missing/null means no parsed object.
- Only error/error_description strings enter the existing masked 160-character
  message. Keep legacy diagnostics compatible. No arbitrary JSON fields/body output.
- A 200 verifies the key for this endpoint, not all shop permissions. A 403 is a
  key-only refusal; it does not alone distinguish bad pairing, restriction or edge denial.
- Noe approved deployment and one production ping after tests in this turn's clarification.
  The existing owner/admin Etsy row exposes Check Etsy app key; no automatic pings.

## Report
Implemented fixed key-only probe, owner/admin UI action, and masked error_description
support with JSON field-presence metadata; credentials are never exported.
Typecheck passes. Isolated production build passes (.next-m6k-etsy).
Full Windows suite: 3,921 pass / 4 baseline assertions fail; three baseline EPERM
cleanup suites also fail (376 files: 369 pass / 7 fail). No new failures.
Baseline assertions: interaction-layer BrainCore Windows path, paths, skills-plugins,
superset-dispatch. Logs: .local/m6k-test-output.txt and m6k-build-output.txt.
Focused rerun after test type guard: 51/51 across four files pass; earlier five-file
focused run passed 67/67. New probe/admin tests cover key-only headers, body caps,
masking, authorization/origin/workspace restrictions and unchanged credential state.
No Railway variables, secrets, dependencies or source settings changed.
Deployment and one production ping approved by Noe and completed below.

### Production result - October 5, 2026, 18:07 CDT
- Pushed main to d4d46894976c59ebfae1d16809b0cf771ce194ce.
- Railway deployment 39b605ec-7023-41ba-a127-2e4de43e420e SUCCESS at 23:06:03 UTC.
- Signed-in production Connections showed the new Check Etsy app key control.
- Clicked it exactly once: HTTP 200; JSON error fields: neither.
- This validates the current production key for openapi-ping, with no user token.
- Before the ping, the dashboard already showed Etsy Up to date: shop 66739608,
  lifetime sales 1, active listings 396, collected 23:00:18 UTC (before M6k).
- Did not run Find accounts, reconnect, save settings, or trigger a shop sync.
- Earlier 403 was not reproduced; its body fields and original cause remain unknown.
- No Railway variables, secrets or provider settings changed. Shared dev server untouched.
- Result left visible in Chrome. This post-deployment checkpoint is local documentation;
  no second deploy is needed for it. Claude can review the code and result above.
