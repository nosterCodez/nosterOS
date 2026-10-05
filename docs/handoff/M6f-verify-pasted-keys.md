# M6f: Verify every pasted key

Status: ready. Written by Claude (lead architect), Oct 5, 2026, at Noe's request.
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
