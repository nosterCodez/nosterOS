# M2b: live beta naming and internal ticks

Approved by Noe through Claude. Two commits on m2-isolation; pushes auto-deploy.

## Scope
1. Rename visible product branding to nosterOS. Prefer NOSTEROS_ACCESS_TOKEN
   and NOSTEROS_DB, retain legacy fallback with one-line warnings, exchange
   the legacy beta cookie without breaking POSTs. Preserve LICENSE and
   upstream attribution. Do not rename stored files/IDs or broaden DB access.
2. Diagnose production internal tick 401s, fix authenticated self-calls and
   make an unbound operator a quiet skip. Keep public/session authorization.

## Verification
Run typecheck, full tests and build for each commit. Add compatibility and
production-shaped tick regression tests. Do not expose or change live secrets.

## Report
### Task 1: rebrand
- Renamed product UI, challenge mark/title, root metadata, generated copy and
  operator docs to nosterOS; package identity is nosteros. LICENSE and the
  README upstream attribution are unchanged. Stored filenames/IDs are unchanged.
- NOSTEROS_ACCESS_TOKEN and NOSTEROS_DB take precedence; legacy fallback emits
  one warning per variable per process without values. DB override remains
  restricted to existing CLI consumers, not authenticated workspace storage.
- Valid legacy beta cookies are accepted, reissued as nosteros_access and
  expired on the response, including POSTs without redirecting/replaying them.
  Existing legacy Paperclip cockpit titles are still recognized to avoid duplicates.
- Typecheck and production build pass. Full Windows tests: 3,625 pass,
  4 failed assertions in 7 known baseline files; no new failures.
- Added tests for precedence, warning redaction, cookie exchange, removal of
  the old variable and stale token rejection. No live secrets were changed.
- Railway dashboard is signed out on this PC; live variable/log inspection
  is unavailable pending login. Task 2 remains separate.

### Task 2: internal tick hardening
- Traced all three self-calls through proxy, apiSessionError and workspaceJob.
  Before this change an unbound operator returned 403, not 401; production
  base URL vs loopback origin is not rejected for valid internal POSTs.
- Reproduced/covered authentication failure conditions: a missing internal
  secret causes the old timer to send unauthenticated requests; surrounding
  whitespace is stripped by HTTP headers but was not stripped by the server
  comparison. Normalize the configured internal secret consistently.
- Actual Railway 401 cause is NOT confirmed: this PC's Railway session is
  signed out (project shows Login/404). Requested login and left the tab open;
  no production variables, private logs or secret values were accessed.
- Missing internal secret now disables HTTP ticks with one configuration
  warning. 401/403 stops further calls to that route until process restart,
  preventing a persistent authentication failure loop without bypassing auth.
- Valid internal requests with no operator binding return a 200 skipped
  result, do not initialize auth/storage or run connectors, and produce no
  false warmup success log. Member/API access rules are unchanged.
- Self-calls remain on loopback, with both internal header and beta cookie;
  redirects are rejected, caching disabled and requests limited to 20 seconds.
- Added production-shaped tests through both actual auth layers for all three
  paths, including HTTPS configured base URL, whitespace, quiet unbound timers,
  missing secret and authentication circuit breaker. Focused suite: 18/18 pass.
- Final typecheck/build pass. Full Windows suite: 3,628 passed, 5 failed
  assertions in 8 documented baseline files (includes seed timeout); no new
  test failures. Diff whitespace check passes.
- Task 1 live public probe confirmed HTTP 401 beta wall, title nosterOS · Private
  and the new mark after 6d7c705. Task 2 live log confirmation remains pending
  dashboard access. No merge to main, secret migration, DNS or bootstrap run.
- Operator next step: copy the existing beta token into NOSTEROS_ACCESS_TOKEN
  then remove the old variable. Confirm NOSTEROS_INTERNAL_SECRET is configured
  (never paste it); environment changes restart the auth circuit breaker.
