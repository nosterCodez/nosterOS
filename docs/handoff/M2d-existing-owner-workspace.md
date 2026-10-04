# M2d: Bind the owner's existing workspace

Status: in progress
Review by Claude: no

## Goal
Complete batch 1 task 1 without duplicating Noe's onboarding-created workspace.

## Context and decision
On October 4 Noe requested tasks 1-2 together, then 3-4, then 5 alone.
Production bootstrap refused an existing unbound nosterCodes workspace as designed.
Read-only inspection confirms verified configured owner is its sole owner/member,
and metadata kind is founder. Add explicit --adopt-workspace <id>, never automatic
name-based adoption, and convert founder to agency preserving all other metadata.

## Do
Require the exact validated workspace ID, exact nosterCodes name, sole membership
belonging to the configured verified owner, and no pending invitations. Fail on
another operator binding, ambiguous names, invalid metadata, or client kind.
Update metadata and binding in one transaction; preserve all workspace files,
existing membership and slug. Keep no-argument behavior unchanged and idempotent.
Obtain confirmation immediately before granting live operator access.

## Don't
No direct database workaround, deleting data, public endpoint, credentials, emails,
main merge or M3. Existing local data remains untouched.

## Done when
Offline guard/rollback/idempotency tests, typecheck, full suite and build pass
(document Windows baseline), then approved production binding verified.

## Report
- Implemented explicit adoption; default bootstrap still refuses conflicts.
- Five new regression cases failed before implementation; 14 focused checks pass.
- Typecheck/build pass; full Windows suite: 3,640 pass, 4 fail, 7 failing files,
  all within AGENTS baseline. No baseline assertions changed.
- Security review: exact ID/name, verified configured sole owner, no invitations,
  metadata validation, conflicting bindings, transaction rollback and repeat-run
  no-op checked. No public route, secret output, file changes or new dependency.
- Production adoption pending explicit access confirmation and deployment.
