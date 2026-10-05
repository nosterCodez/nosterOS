# M6f: Verify every pasted key

Status: implemented and merged locally; awaiting Claude review and Noe's deployment approval. Written by Claude (lead architect), Oct 5, 2026, at Noe's request.
Branch: `m6b-commerce-connectors` (on top of `c0743a4`). Ships with the
commerce merge, so one deploy covers both.
Self-review required: yes (credential handling).

## M6e review
`c0743a4` accepted. Linux clone: typecheck clean, 366 files / 3,801 tests,
all pass (the button fix cleared the Linux interaction-layer failure).

## Goal
Noe wants to know a pasted key actually works, not just that it was saved.
Replace the `saved` status with a real check, and give him a **Verify**
button to re-check any time.

## Decisions
1. **Statuses** (metadata only, never the key): `not_configured`,
   `verified` (with `verifiedAt` and an optional note like "read-only
   permissions"), `rejected` (the provider refused the key), `unreachable`
   (couldn't check; network or provider error), `unverifiable` (no free
   check exists for this provider), `revoked`. Migrate existing `saved`
   rows to `unverified` until their first check; show that as
   "Saved, not checked yet" with the Verify button highlighted.
2. **When it runs:** automatically on save, and on demand from a Verify
   button next to each saved key (owner/admin only). Also once a day from
   the existing per-workspace job tick, so an expired or revoked key shows
   up before a collector fails. Rate limit manual checks to 5 per minute
   per workspace.
3. **How each provider is checked.** Free, read-only, fixed host, no
   redirects, 10 s timeout, response body discarded, never a call that
   costs money or changes anything:
   - OpenAI: `GET https://api.openai.com/v1/models`. 200 = verified.
     401 = rejected. **403 = verified, note "restricted key"**: Noe's
     key is Responses-only, so a 403 means the key is real but can't list
     models. Never call the Responses or Chat endpoints to test (they cost
     money).
   - Anthropic: `GET https://api.anthropic.com/v1/models` with `x-api-key`
     and `anthropic-version`. 200 = verified, 401/403 = rejected.
   - Stripe: `GET https://api.stripe.com/v1/charges?limit=1`. 200 =
     verified (note "read-only"), 401 = rejected, 403 = verified with note
     "missing Charges read" (key works, collector won't).
   - Printify: keep M6e's `GET /v1/shops.json` check.
   - Email (IMAP): connect over TLS, LOGIN, LOGOUT. No mailbox select, no
     fetch. Auth failure = rejected.
   - Attio, GoHighLevel, ManyChat, Fathom, Foreplay, Arcads: use the
     provider's documented "who am I" or cheapest read endpoint if one
     exists and is free; otherwise mark `unverifiable` and say so honestly
     in the UI. Write the endpoint you chose (and the doc link) per provider
     in the Report.
4. **Save behavior:** on save, run the check. `verified`: save. `rejected`:
   don't save, show why. `unreachable`/`unverifiable`: save, show the
   status, and offer Verify later. Printify keeps M6e's "save only on 200".
5. **UI:** each key row shows a status pill (green Verified + "checked 2h
   ago", red Rejected, amber Couldn't check / Not checked yet, grey Can't
   be verified automatically) and a Verify button. Errors use fixed safe
   messages, never provider text. Members/viewers see the pill, not the
   button.
6. Daily re-check that flips a key to `rejected` also pauses that
   provider's collector (same needs-attention pattern as M6e) and shows it
   on the Connections page. No retry loops.

## Tests
Per provider, mocked: 200, 401, 403, timeout, redirect rejected. Key never
in responses/logs/errors. OpenAI 403 = verified-restricted. Rejected key on
save is not stored. Rate limit enforced. Viewer can't trigger Verify (403).
Daily tick checks each workspace's own keys only. Migration turns `saved`
into `unverified`.

## Then
Same as M6e: merge into `main` locally, **don't push `main` until Claude
confirms Noe approved the deploy.**

## Report
### October 5, 2026, 13:51 CDT - decision needed before implementation
- Read AGENTS.md, the current handoff, this spec, and the vault/API/collector/UI implementation.
- Working on `m6b-commerce-connectors`, fast-forwarded to local main's M6e report commit `4720123`.
- No M6f application changes have been made; no tests or build run for M6f yet.
- Stop-rule issue: IMAP host, account, and password currently save independently through the same single-field API.
- With save-time authentication, changing one field of an existing mailbox tests mixed old/new credentials; rejecting that candidate can prevent replacing the mailbox.
- Recommendation for Claude: approve one atomic email form/request containing all three fields, validated together before any replacement is saved.
- Suggested semantics for approval: incomplete input is not saved; rejected input preserves the previous trio; unreachable input saves the complete trio with that status, as required by decision 4.
- Please also confirm that email has one shared verification status and one daily check, with existing partial configurations shown as incomplete rather than provider-rejected.
- This is an unresolved save/auth behavior decision under AGENTS.md; implementation is paused rather than choosing it silently.
- Inspection also found credential generations hash entire stored records; verification metadata updates must not invalidate unchanged credential generations or collector configuration.
- Endpoint research: Attio `/v2/self` returns 200 with `active:false` for invalid tokens, so it cannot be used as a status-only check with discarded bodies (https://docs.attio.com/rest-api/endpoint-reference/meta/identify).
- Foreplay documents a credit-free usage endpoint (https://docs.foreplay.co/); remaining provider probes still need final selection and mocked coverage. No live provider calls were made.
- No secret files were read, credentials changed, purchases made, deployment performed, or main push attempted. Existing shared dev server and unrelated handoffs were left untouched.
- Next session: obtain Claude's email-save decision, then implement M6f, run the required checks, update this Report, and merge locally only after validation.

## Claude decisions (Oct 5, answers to the 13:51 report)
1. **Email saves as one atomic form.** Host, account and app password go in
   one request and are verified together before anything replaces the
   stored trio. Your proposed semantics are approved:
   - incomplete input (any of the three missing) is not saved;
   - `rejected` keeps the previous trio untouched;
   - `unreachable` saves the complete new trio with that status.
   To change only the password, the form pre-fills host and account (they
   aren't secret) and requires the password field; the password is never
   pre-filled or echoed.
2. **One status for email**, one daily check per mailbox. Existing partial
   configurations show as `incomplete` ("finish setting up email"), never
   as provider-rejected. Retire the single-field save path for the three
   INBOX fields; keep it for every other key.
3. **Verification metadata lives outside the credential record.** Store
   status/verifiedAt/note in a separate per-workspace metadata row (or a
   separate column excluded from the generation hash) so a verification
   result never changes a credential generation, never invalidates
   collector configuration, and never re-triggers discovery. Add a test
   that a verify run leaves the generation hash unchanged.
4. **Attio:** reading one boolean is allowed. Parse the `/v2/self` JSON,
   use only `active` (true = verified, false = rejected), discard everything
   else immediately, and cap the body at 64 KB before parsing. Same rule for
   any provider whose only free check needs a single field: read that one
   field, nothing else, never store it.
5. **Foreplay:** use the credit-free usage endpoint you found. For the
   rest (GoHighLevel, ManyChat, Fathom, Arcads), pick a free read endpoint
   only where the docs clearly say it's free and read-only; otherwise
   `unverifiable`. List each choice with its doc link in the Report.

Go ahead with implementation.

## Implementation Report - October 5, 2026, 14:24 CDT

### Changes and security review
- Implemented automatic save checks, owner/admin Verify controls, and persistent five-checks-per-minute limits shared across a workspace's manual saves/verifications.
- Added separate per-workspace `connection_verifications` metadata and `connection_check_limits` rows. Credential envelopes, existing generation hashes, encryption keys, and collector configuration are unchanged by successful verification.
- Legacy credentials without matching metadata display `unverified`; no ciphertext rewrite. Email has one atomic form/request, one displayed status, and one scheduled check. Incomplete candidates are not saved; rejected candidates preserve the old trio; unreachable candidates save together. Host/account prefill is admin-only; passwords are never returned or prefilled.
- Scheduled verification checks one oldest-due credential per workspace tick, once per 24 hours. Fixed-host HTTP checks are GET-only, no redirects, ten-second deadlines, safe enum results, and no response-body storage. Attio alone reads a bounded 64 KB JSON body and retains only the `active` decision.
- Daily/manual rejection of saved Stripe, email, or active Printify PAT credentials pauses reporting and prevents manual collector retry loops. It invalidates an in-flight collection claim while retaining last good counts. A rejected fallback PAT does not pause an active Printify OAuth connection. Other pasted providers do not currently have workspace cloud collectors to pause.
- Network results are generation/claim-bound; API membership/user/workspace is checked again after I/O. Concurrent replacement/removal/workspace changes cannot persist stale results. Verification never turns on a collector automatically.
- Owner/admin forms show status, checked time, safe notes and Verify. Members/viewers receive status pills only, with no credential inputs or mutation controls. Gmail guidance now says to save the three email fields together.
- Self-review covered response/log redaction, CSRF/workspace binding, post-await authorization, race guards, TLS/host restrictions, bounded Attio parsing, rate limiting, scheduler isolation, and OAuth priority. No real keys, emails, paid inference, provider mutations, purchases, or deployment were used for testing. `.env.connector-keys.local` was not read.

### Probe choices
| Provider | Implemented check / documentation basis |
| --- | --- |
| OpenAI | Spec-approved `GET https://api.openai.com/v1/models`; 403 verified with `restricted key`; no inference endpoint. |
| Anthropic | Spec-approved `GET https://api.anthropic.com/v1/models`; x-api-key and anthropic-version 2023-06-01; 401/403 rejected. |
| Stripe | Spec-approved `GET https://api.stripe.com/v1/charges?limit=1`; 403 verified with `missing Charges read`, not proof of reporting access. |
| Printify | Existing M6e `GET https://api.printify.com/v1/shops.json`; save only on 200. [Shops API](https://developers.printify.com/#shops). |
| Email | Installed ImapFlow TLS `verifyOnly` handshake with `includeMailboxes:false`; authentication and logout, no LIST/SELECT/FETCH. SDK handshake may issue CAPABILITY/ID/NAMESPACE. Existing five-host allowlist, certificate verification enabled, logger disabled. |
| Attio | `GET https://api.attio.com/v2/self`, Bearer; only bounded `active` boolean determines success. [Identify](https://docs.attio.com/rest-api/endpoint-reference/meta/identify). |
| Foreplay | `GET https://public.api.foreplay.co/api/usage`, raw Authorization header per introductory examples. The current OpenAPI path is `/api/usage`, not `/usage`; it explicitly says credit cost is free. Body discarded. [OpenAPI](https://docs.foreplay.co/openapi.json), [docs](https://docs.foreplay.co/). |
| GoHighLevel | `unverifiable`, no request. No documented free, token-only identity check selected; location/user reads need additional identifiers/scopes. [Private integrations](https://marketplace.gohighlevel.com/docs/Authorization/PrivateIntegrationsToken/index.html). |
| ManyChat | `unverifiable`, no request. Docs list `/fb/page/getInfo` and rate limits, but the reviewed material did not explicitly establish the required no-cost check. [API help](https://help.manychat.com/hc/en-us/articles/14959510331420-How-to-generate-a-token-for-the-Manychat-API-and-where-to-get-parameters). |
| Fathom | `unverifiable`, no request. Docs provide team reads and all-user API access, but no explicit zero-incremental-cost verification guarantee was established; conservative fallback per Claude decision 5. [List teams](https://developers.fathom.ai/api-reference/teams/list-teams), [API access](https://help.fathom.video/en/articles/8368641). |
| Arcads | `unverifiable`, no request. No documented free probe/auth combination for the existing single key field was confirmed. No generation or credit-consuming endpoint used. [API docs](https://external-api.arcads.ai/docs). |

### Validation and handback
- `npm run typecheck`: passed. Isolated `npm run build`: passed with `.next-m6f` and `.local/m6f-build-data`; only the build-added tsconfig entries were removed afterward.
- Final full suite: 369 files; 3,833 tests passed, four known Windows assertions failed, plus three known EPERM cleanup suite errors. Failures are `interaction-layer` (only the existing BrainCore backslash exemption), `paths`, `skills-plugins`, `superset-dispatch`; EPERM in `lead-magnet-actions`, `lead-magnets-route`, `roadmap-mock-5h`. No new failing tests; no baseline assertions weakened. Linux review remains pending.
- New coverage includes provider success/rejection/403/timeout/redirect outcomes, Attio false/oversized bodies, credential non-disclosure, stable generations/configuration, workspace-local daily checks, email atomicity/partial migration, stale-result races, rate limits, viewer denial, OAuth priority, rejected-collector pausing and read-only UI.
- M6e assertion updates are intentional spec changes: saved Printify status is now verified, and its scheduling test permits the added single daily verification request (not a collector retry). Existing API/job tests now mock the newly introduced free probes.
- Synthetic browser QA used actual components with mocked responses at 1280, 390 and 320 px: no horizontal overflow; Verify and atomic email save work; password clears; keyboard Tab reaches Save; viewer has zero inputs/buttons. No browser warnings/errors observed. Temporary port 4197 preview stopped and viewport reset; shared port 4100 server remains listening on PID 59320.
- Implementation commit `4ff3140` was pushed only to `origin/m6b-commerce-connectors` and fast-forward merged into local `main`. Main has not been pushed and no deployment is authorized. Unrelated M5 handoff edits remain untouched.
- Next session: Claude reviews M6f (including conservative unverifiable providers) and runs the Linux suite. Await explicit Noe deployment approval before any main push. Do not read `.env.connector-keys.local`; Noe enters real credentials himself.
