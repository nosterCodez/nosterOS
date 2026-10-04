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
