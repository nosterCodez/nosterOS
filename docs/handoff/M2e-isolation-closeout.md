# M2e: Workspace isolation closeout (batch 1 task 2)

Status: in progress
Review by Claude: no

## Goal
Verify deployed two-workspace boundaries and close the remaining M2 audit gaps.

## Do
Review routes, long-lived database access and seed/brain CLI targets. Maintenance
scripts must require an existing explicit workspace, never fall back to the legacy
database or home directory. Add offline two-user authorization/data tests, inspect
operator versus nonoperator pages in the live browser with a clearly named QA
workspace, and preserve existing data. Tests never send real email or call connectors.

## Don't
No main merge or M3 in this batch. No customer invitations, new paid services,
real connector credentials, deletion, or fabricated business results.

## Report
- Implemented explicit registered-workspace targets for seed and brain-doc scripts.
- Context DB reads acquire on use; asynchronous DB consumers now hold pool leases.
  The conductor timeout keeps its underlying work leased after the response race.
- Added real Better Auth two-user/two-workspace test with captured local mail only.
- Live QA workspace created: Isolation QA - Oct 4, owned by Noe; marker workflow
  created only there and absent when switching back to nosterCodes. No deletion.
- Client workspace home correctly shows the operator-unavailable empty state.
- Found acceptance gap: seedStructure still inserts upstream sample workflows,
  whose fictional hours/dollar amounts appear as real workflow dashboard values.
  Existing records are preserved; resolving display/seed provenance is next.
- Also observed upstream Alex greeting and founder-os/Vantage labels still visible.
- Verification: 18 focused boundary/auth/storage tests pass. Full Windows suite:
  3,643 pass, 4 failed assertions across 7 known-baseline files; smoke mock fixed
  without weakening assertions. Typecheck and production build pass.
- Self-review: lazy DB getter only after membership/role checks; async leases use
  the resolved workspace ID and release in finally. No env fallback or new secret.
- React review: server-only leases; existing parallel loads and serialized client
  props retained. No visual layout, client dependency or hook changes.
- Direct browser API navigation was blocked by the browser; no live API 403 claim.
- Remaining before M2 acceptance: sample-data provenance/display, final indirect
  cache/connector source audit, and review repeated operator/session resolution
  against concurrent active-workspace changes. No main merge or M3.
