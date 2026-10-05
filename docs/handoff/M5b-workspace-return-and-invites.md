# M5b: Returning accounts and emailed team invitations

Status: deployment approved by Noe; release verification in progress
Review: Astra security self-review

## Request
Noe wants the same account on a new device to return to its existing workspace,
and team invitation emails to open the shared workspace and its connections.

## Decisions
- Noe approved deployment in chat after the implementation report. Release the
  tested M4/M5 + M5b branch through main to the existing private Railway beta;
  preserve accounts, volume, secrets and disabled/unconfigured providers.
  A real invitation test to a named recipient remains separate from deployment.
- Based on 40bea33, on codex/m5b-workspace-return-invites. No production deploy
  or real recipient test is authorized by this implementation request alone.
- Persist last selected workspace by authenticated user ID in the control DB;
  restore only after checking current membership. One membership can be chosen
  automatically. Multiple memberships without a valid preference show a chooser.
- Never merge users, copy workspaces/credentials or grant access by an unverified
  email. Existing duplicate workspaces remain intact.
- Invite links use signed, expiring invitation entry tokens, not the shared beta
  secret or connector keys. Entry validates pending status against the database;
  accepting still requires verified sign-in as the invited email and assigned role.
- Expose only the email sign-in page/request/verification and signed invitation
  entry through the beta wall. Application pages and other APIs stay gated.
  Unapproved addresses receive no sign-in email; response remains generic.
- Issue the beta cookie after valid invitation entry or successful magic-link
  verification, never from an arbitrary query token or failed sign-in.
- Reuse existing system mail provider; no new costs, keys, legal copy or sends
  during tests. Owner/admin invitation action remains the real-send approval.
- Team members read shared dashboard data; only admins/owners configure sources.
  Invite/revoke/resend remains role-checked by Better Auth. No plaintext key access.
- Await invitation mail in the documented Better Auth after hook, not its
  sendInvitationEmail callback: the installed callback wrapper swallows failures.
  Surface a sanitized 503 on failure; keep pending invitation for explicit resend.
- The beta challenge links to email sign-in. Google OAuth is not added to the
  beta exceptions; that provider is not configured in production yet.
- Update the rebrand compatibility test to use get-session rather than sign-in
  for stale-cookie denial: sign-in is now public; session API remains beta-gated.

## Verification
Test fresh-device sign-in, saved preference, revoked membership, multiple/zero
memberships, wrong-email/unverified/cancelled/expired/replayed invitations,
beta gate bypass boundaries, email failure/resend and connector permissions.
Run typecheck, full tests, build and document remaining live checks.

## Report
- Implemented on codex/m5b-workspace-return-invites, based on M4/M5 commit 40bea33; production remains unchanged.
- Added control-database workspace preferences keyed by user ID. New sessions restore only current memberships; no duplicate workspace creation, merging or deletion.
- Added existing-workspace chooser and pending invitations to onboarding; separate workspace creation remains explicit through ?new=1.
- Invitation emails now contain a signed 48-hour entry link; pending status and expiry are checked before beta admission, then verified recipient acceptance grants the assigned role.
- Magic-link verification grants beta admission only from a freshly issued, server-verified session. Added email sign-in to the beta entrance; unrelated APIs remain gated.
- Added explicit workspace IDs to invitation requests, resend controls, wrong-account sign-out, and sanitized email-failure feedback. No connector credentials or shared beta token in emails.
- Security review covered wrong email, unverified email, revoked membership, expired/canceled/accepted/replaced links, tampering, sign-in replay, role restrictions, and unknown-address no-send behavior.
- All 12 new real-auth tests passed with in-memory databases and captured mail; full suite: 3,696 passed, 4 failed assertions out of 3,700 (348 files passed, 7 failed).
- Remaining failed files match the Windows baseline: interaction-layer, lead-magnet-actions, lead-magnets-route, paths, roadmap-mock-5h, skills-plugins, superset-dispatch. Typecheck and production build passed.
- Browser fixture checks passed at 390px and 1280px: no document overflow, choose workspace, invite payload, resend and acceptance. Compiled CSS with fallback font and mocked HTTP; not production inbox verification.
- Updated stale-beta-cookie test to use the still-protected get-session endpoint and smoke mocks; reviewed email-entry platform-secret boundary separately without relaxing connector access rules.
- No real emails, credentials, account records, purchases or Railway settings changed. Existing localhost:4100 server left running; temporary preview stopped. Next: approve deployment and a real invitation/new-device inbox test.
