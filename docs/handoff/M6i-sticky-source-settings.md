# M6i: Source settings stick (auto-read checkbox and reconnects)

Status: implemented on local main; awaiting Claude review and deploy relay. Written by Claude (lead architect), Oct 5, 2026.
Reported by Noe: "if I select automatically read these metrics, it doesn't
actually save; I always have to check them again."

## Root causes found in review (main @ cace87a)
1. The checkbox only changes local state. It persists only if the user also
   clicks **Save settings** (`components/CloudConnections.tsx`, `configure`
   action). Nothing tells the user that, so toggling and leaving loses it.
2. Every OAuth reauthorization writes a new token `generation`
   (`completeAuthorization` → `generation: randomUUID()`). `sourceView`
   treats `record.credentialVersion !== generation` as `needs_setup`, so
   after any "Reconnect Google" all three Google sources (Search Console, GA4,
   YouTube) silently need their resource and auto-read saved again.

## Decisions
1. **Auto-save the checkbox.** Toggling sends `configure` immediately with the
   current saved resource (not unsaved edits in the resource field), shows
   "Saved" or the safe error, and reverts the box on failure. Keep the Save
   settings button for resource changes only. The button stays disabled until
   the resource field differs from what's saved.
2. **Carry settings across reauthorization.** When an OAuth provider is
   reauthorized in the same workspace, every source of that provider with an
   existing record keeps its `resource` and `enabled`, moved to the new
   generation (new revision, snapshot kept, error cleared). The next
   collection validates access as it does today. If the new account can't
   see the saved resource, the existing permission error shows and
   scheduling pauses (no retry loop). Do this inside the same transaction
   that saves the new tokens, or right after with the same version checks, so
   a concurrent disconnect still wins.
3. Disconnect still clears and disables, as today. Pasted-key sources (Stripe,
   email, Printify token) already keep settings when the key is replaced
   with one that verifies. Confirm with a test, and fix if not.

## Tests
Toggle persists across a reload without pressing Save; failed toggle reverts;
viewer can't toggle (403); reconnecting Google keeps SC/GA4/YouTube resource
and auto-read; reconnect plus a concurrent disconnect ends disconnected;
replacing a verified Stripe key keeps auto-read.

## Then
Merge to main locally; Claude relays Noe's deploy go.

## Report
- Oct 5, 2026, 16:51 CDT: implemented directly on local main after M6h; no push/deploy.
- Auto-read immediately saves the saved resource, shows the existing safe result/error, and reverts on failure.
- Unsaved resource edits remain local; Save settings is disabled unless the resource differs.
- OAuth token replacement and all existing provider-source generation updates share one transaction.
- Reauthorization retains resource, enabled, snapshot and last-attempt; resets error/claim and revises each source.
- Permission/authentication failures pause OAuth scheduling; delayed failures cannot pause a replacement grant.
- Verified Stripe/email/Printify replacements now preserve settings; saving a fallback PAT does not revise active OAuth.
- Added 11 automated cases: shared-Google preservation/isolation, rollback, disconnect races, permission pause, key replacement and viewer 403/persistence.
- Focused: 83/83 pass across seven files; npm run typecheck passes; isolated npm run build passes.
- Full Windows suite: 3865 passed, 4 known baseline assertion failures, 3 known EPERM teardown failures (371 files).
- Baselines: interaction-layer (BrainCore Windows path), paths, skills-plugins, superset-dispatch; lead-magnet-actions, lead-magnets-route, roadmap-mock-5h teardown.
- Chrome synthetic fixture verified toggle/reload, rollback on 403, unsaved-resource isolation, resource-only Save and viewer controls absent; no real provider calls.
- Ignored .local/m6i-* contains fixture/logs; temporary fixture stopped after QA; shared port-4100 dev server left untouched.
- No Railway variables or private keys touched; Noe owns Meta domain/Etsy callback corrections. M6h and M6i remain local pending explicit deployment approval.
