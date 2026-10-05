# M5g: Analytics API activation and actionable errors

Status: done (live one-time sync verified under M5h; recurring collection remains off)
Review by Claude: no; Astra owns implementation and security review.

## Goal
Fix GA4 discovery/reporting blocked by disabled Google APIs and stop presenting every HTTP 403 as an expired login.

## Decisions / scope
- Enable Analytics Admin and Data APIs in the existing Google project; no new credentials, scopes, billing, or services purchased.
- Noe approved Analytics Data API terms at action time in chat.
- Distinguish HTTP 401 from permission-denied responses and recognized Google SERVICE_DISABLED errors.
- Parse only bounded error bodies from fixed Google hosts; expose static messages, never provider error text, metadata, or credentials.
- Preserve encrypted workspace isolation, existing successful snapshots, and opt-in scheduled collection.
- Do not activate other provider APIs or change their terms/access as part of this fix.

## Done when
Live Analytics discovery and an authorized sync verified; error regression tests, typecheck, full tests (document Windows baseline), and production build pass.

## Report
- Analytics Admin and Data APIs show Enabled in the existing Google Cloud project.
- Live Find accounts returned two properties without another sign-in; saved marketing.noepenaa.com (556188283) in nosterCodes. Scheduled collection remains off pending Noe's answer.
- Implemented bounded 64 KiB Google ErrorInfo parsing; SERVICE_DISABLED has static administrator guidance; HTTP 401 and generic 403 now differ.
- Regression first run failed 3/4 as expected; after implementation all 27 focused connector tests pass.
- Typecheck and production build pass. Full suite: 3,712 passed, four assertions failed; seven failed files are the documented Windows baseline (three EPERM teardown failures plus interaction-layer, paths, skills-plugins, superset-dispatch).
- Updated the pre-existing HTTP 401 assertion from permission to authentication to match the deliberate distinction.
- Security self-review: fixed-host allowlist, redirects blocked, 8-second fetch timeout, bounded bodies, static errors only; credentials, permissions, encryption and workspace boundaries unchanged.
- Commit 9acf8d5 pushed to main; Railway nosteros-web deployment f975df10-3f63-4332-8280-52c2a04377d1 reached SUCCESS on Oct 4, 2026 at 22:45 Central.
- Post-deploy browser reload and Find accounts succeeded; selected marketing property remained saved. No reconnect was needed.
- Pending: real report sync. The current sync contract requires enabled collection; asked Noe to opt into 15-minute read-only updates and have not received that answer yet. Do not claim report metrics verified.
- No costs, emails, extra scopes or new credentials. Local dev server left untouched. Other provider API activations remain outside this fix.
- Follow-up Oct 4 23:18 Central: M5h decoupled one-time sync from recurring opt-in and fixed a recognized empty GA4 report response. Live sync now completes and Overview persists the empty report. No recurring opt-in required for a manual sync; schedule remains off.
