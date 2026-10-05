# M6e: Printify personal token, button fix, then merge commerce

Status: implemented and verified locally; deployment approval pending. Written by Claude (lead architect), Oct 5, 2026.
Branch: continue on `m6b-commerce-connectors`.
Self-review required: yes (credential handling).

## Review of M6b/M6c (`99eece0`)
Accepted. Linux clone: typecheck clean, 3,779 / 3,780 tests pass. Spot-checked
signed single-use state, Shopify HMAC (sorted params, constant-time compare,
10-minute timestamp window, duplicate-key rejection), fixed hosts/paths and
read-only scopes. Good work.

The one failure is real, not a Windows quirk: `tests/interaction-layer.test.ts`
"every raw <button> opening tag carries the press layer" fails on Linux on
both this branch and `main`, at `components/WorkspaceConnections.tsx:30` and
`:32` (two buttons without the press layer). `interaction-layer` is on the
Windows baseline list in AGENTS.md, which hid it. Fix the buttons, and in
AGENTS.md note that `interaction-layer` failures on Linux are real.

## Decision: Printify manual token path
Printify's OAuth app needs platform approval we don't have. Printify also
issues personal access tokens for the account owner's own shops. Noe already
has one (shops.read, products.read, orders.read). Add it as a pasted
credential, the same way Stripe's restricted key works:

1. `lib/connection-fields.ts`: add
   `{ name: 'PRINTIFY_API_TOKEN', provider: 'printify', label: 'Printify personal access token (read-only)' }`.
   Stored only in the workspace's encrypted vault (M3). Never echoed back,
   logged or included in errors; the UI shows saved / not configured only.
2. Validate on save with one bounded GET to `https://api.printify.com/v1/shops.json`
   (fixed host, no redirects, User-Agent set, 10 s timeout). Save only on 200.
   On 401/403 say "token rejected or missing shops.read"; on other failures say
   "Printify unreachable, not saved". Do not store the response body.
3. Collector: the Printify adapter uses the OAuth token when one exists,
   otherwise the workspace's `PRINTIFY_API_TOKEN`. Same fixed endpoints, same
   aggregate-only outputs (product total, all-status order total, fulfilled
   total). No other workspace's token and no env-var fallback, ever.
4. Disconnect/revoke deletes the saved token for that workspace only. The
   Connections page shows which method is active ("Personal token" or
   "Printify sign-in").
5. Personal tokens expire (Printify issues them for up to a year). On a 401
   during collection, mark the connection `needs attention`, stop scheduling
   it, and show the reconnect hint. Never retry-loop.
6. Roles: owner/admin can save or remove; members/viewers see status only.

Tests: save validates and stores encrypted; rejected token isn't stored;
token never appears in API responses or logs; collector prefers OAuth, falls
back to the same workspace's token only; workspace A's token is invisible to
B; 401 during collection flips to needs-attention without retries; viewer
can't save (403).

## Then
- Merge `m6b-commerce-connectors` into `main` after this spec is green and
  self-reviewed. **Do not push `main` until Noe approves the deploy** (main
  auto-deploys to os.noepenaa.com). Claude will ask him.
- After deploy, Noe pastes his Printify token into the nosterCodes workspace
  himself. Never paste it for him, and never read `.env.connector-keys.local`.

## Report
- Implemented Oct 5, 2026 on m6b-commerce-connectors; no dependency additions or schema migration.
- Added PRINTIFY_API_TOKEN to the workspace vault UI. Save performs one fixed-host GET with User-Agent, redirect rejection and a 10-second abort/race deadline; only HTTP 200 is saved.
- Validation discards the response body. Rejected/unreachable responses use the exact requested safe messages; no provider text, tokens or response bodies are persisted or returned.
- Rechecks admin membership, active workspace/user and credential/source revision after validation; concurrent replacement/removal or workspace switching discards the result.
- Discovery, generation checks and collection use OAuth first, otherwise that workspace's personal token. Failed OAuth never silently falls back; no environment or cross-workspace fallback.
- Both credential removal and source disconnect delete the personal-token record and invalidate pending work in that workspace only. Other credential types retain their existing revoke behavior.
- Personal-token collection 401 preserves stale last-good counts, shows Needs attention, disables scheduling and blocks retries until the token is replaced or OAuth is connected/configured; late failures cannot pause replacement credentials.
- Owners/admins manage tokens; members/viewers get a read-only Printify status/method view. No mutation permissions were relaxed. UI identifies Personal token versus Printify sign-in.
- Fixed all missing pressable classes in WorkspaceConnections; noted in AGENTS.md that Linux interaction-layer failures are real.
- Typecheck and isolated production build passed. Full suite: 3,797 passed / 4 failed assertions, plus 3 existing Windows EPERM cleanup failures (366 files: 359 passed / 7 failed).
- Remaining assertion failures: paths, skills-plugins, superset-dispatch, and interaction-layer's Windows-only BrainCore exemption mismatch. WorkspaceConnections no longer appears; a separate POSIX-normalized scan using the same existing exemption found zero offenders. No test expectations were weakened.
- Added 20 Printify tests plus one read-only/method UI test. Focused credential/cloud/UI tests passed; the only focused failure was the existing BrainCore Windows path exemption. Linux rerun remains for Claude.
- Self-review covered fixed-host/header handling, encrypted storage, role/origin/workspace binding, save/discovery/collection races, deletion, OAuth precedence and no-secret errors/logs. Only synthetic provider fixtures were used.
- Synthetic browser QA at 390px and 1280px verified token entry, rejection, cleared input, saved method, shop discovery, selection, opt-in settings and read-only member UI; mobile had no horizontal overflow. Temporary preview stopped and viewport reset.
- The private connector-key file was never read. Noe must paste his own token after approved deployment; real Printify access/collection is not verified by these mocked tests. Port 4100 remains listening (PID 59320).
- Implementation c0743a4 was pushed to origin/m6b-commerce-connectors, then local main was fast-forwarded from 52c218a to c0743a4. This final report update is local only. Origin/main remains 52c218a; no Railway deployment occurred. Main push still requires Claude's confirmation of Noe's approval. Unrelated M5 handoff edits are preserved.
