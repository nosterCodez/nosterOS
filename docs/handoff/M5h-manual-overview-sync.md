# M5h: Load Overview without requiring automatic collection

Status: in progress
Review by Claude: no; Astra architect/builder

## Goal
Overview renders but has no snapshots. GA4 is authorized and configured, yet paused collection disables even a manual sync. Separate one-time reads from recurring opt-in.

## Decisions
- Only the existing authenticated admin sync action requests manual mode; scheduler remains opt-in and skips paused sources.
- Manual reads preserve credential-generation checks, active claim exclusion, revision fencing, time budgets, and the existing 15-minute cooldown.
- Follow-up: failed manual reads may retry after 60 seconds; successful reads and scheduled collection retain 15 minutes. This permits correcting setup without a 15-minute debugging lockout; tested explicitly.
- Completion relies on the acquired claim and revision: configuration changes/disconnect invalidate both, including when a manual read started paused.
- Manual sync does not change enabled state, request new permissions, or schedule future reads.
- Show actionable source state and connection links on Overview; never substitute zero for missing data.
- Verify one-time GA4 marketing property sync and Overview in production. No new services, costs, credentials, emails or other account activation.

## Done when
Tests cover paused manual success, scheduler skip, cooldown, concurrent disconnect, workspace/admin protections and UI state; typecheck/build/full suite checked. Live Overview verified.

## Report
- Investigation: runtime logs show no Overview crash; browser renders 0/10 sources. GA4 saved selection exists but collection is paused.
- Implemented explicit manual mode on admin sync; scheduler behavior and 15-minute rate limit unchanged. Manual completion leaves enabled=false.
- Overview now gives source-specific state and links to the relevant connection; saved paused sources can use Sync now without toggling automatic collection.
- Focused tests: 29 passed. Typecheck and production build pass. Full suite: 3,714 passed, six failed assertions; nine failed files all in documented Windows baseline (including api/seed timeouts).
- Security review: no new endpoints/scopes, existing admin/origin/workspace checks preserved, credential generation and claim/revision fencing retained. Tests prove no stale writes after reconfiguration/disconnect and no cross-workspace reads.
- React review: no new client data fetching or dependencies; server snapshot rendering stays scoped and unknown values remain unknown; actions retain keyboard/focus and live-status semantics.
- Pending deployment and real GA4/Overview verification.
- Deployment 5fb7348 succeeded; live one-time sync reached a validation/persistence failure. Added bounded stage/schema diagnostics without values, provider messages, credentials or account IDs to isolate it. Not claiming live metrics yet.
- Diagnostics on cb08f7b identified collect/schema invalid_type at metricHeaders. Handle a recognized analyticsData#runReport with no rows/count as empty (null values), while rejecting unrecognized payloads and missing headers on populated reports. Show an explicit empty-period message; live verification pending.
- Final predeploy checks: typecheck/build pass; 28 focused tests pass; full suite 3,718 passed/four failed assertions, seven failed files all documented Windows baseline. Google response contract checked against its official RunReportResponse reference.
