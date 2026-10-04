# M3: Encrypted workspace connections

Status: in progress
Review by Claude: no; Astra security self-review required

## Scope and decisions
Noe requested M3 after the M2 main merge (9bca947). No new dependencies or services.
Each workspace SQLite database gets a connections table and one wrapped data key.
AES-256-GCM uses fresh 96-bit IVs, 128-bit tags and versioned authenticated context
binding both the workspace and credential name. A separate 32-byte master key wraps
each workspace's random data key. Neither plaintext keys nor partial secrets leave APIs.
Platform auth/mail secrets remain environment configuration, never editable in the UI.

Owners/admins can list metadata, save/replace approved credential fields and soft-revoke.
Members/viewers cannot manage connections. Cross-origin writes and workspace selectors
in request bodies are rejected. No automatic credential migration or external API calls.
Saved means stored, not connected/verified; OAuth onboarding remains M4, collectors M5.

`lib/creds.ts` becomes explicit-workspace-only, with no environment fallback/cache.
Legacy integrations retain a clearly named operator credential module and stay behind
the bound operator workspace AND NOSTEROS_OPERATOR_FEATURES=1. Do not remove connector
gates until each consumer's credentials, caches and file access are workspace-scoped.
Old environment-writing HTTP connection/OAuth/key flows are disabled, not repurposed.
All workspaces get the secure Connections UI; host diagnostics stay on a gated page.

## Verification
Test encryption round-trip, ciphertext tampering, swapping workspace/slot/key envelopes,
randomized ciphertext, missing/invalid/wrong master key, independent data keys, revocation,
no env fallback, role/origin/body controls, and no secret in API responses/audit metadata.
Full suite/typecheck/build, attacker-style diff review, desktop/mobile UI checks.
Noe approved generating the production master key privately and switching the existing
private beta to main after M3 testing. No accounts/data are removed or services purchased.
Local key generation is also approved. Keys must be backed up separately from databases.

## References
- https://nodejs.org/api/crypto.html (GCM, setAAD, getAuthTag)
- https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html

## Report
- Implementation complete; deployment/browser verification pending at this checkpoint.
- Workspace databases now hold authenticated encrypted credential envelopes and one wrapped random data key.
- Owners/admins can save, replace and soft-revoke approved fields; APIs return metadata only, never key fragments.
- Strict bodies, 8 KB streaming body limit, origin/role checks and stale-workspace headers protect mutations.
- Resolver requires an explicit workspace, reads freshly, and has no environment or host-file fallback.
- Legacy consumers moved to operator-creds; all remain behind the operator binding AND explicit feature flag.
- Old shared-key/connect/OAuth HTTP mutations now return 409 without writes, redirects or token exchanges.
- Secure Connections replaces the customer page; existing host diagnostics moved to /integrations/host.
- Typecheck and production build pass. Full suite: 3,654 pass; four failed assertions in seven known Windows-baseline files, unchanged from M2.
- New tests cover role/origin denial, stale forms, independent workspaces, tampering, key loss/change, random IVs, revocation, and no secret response/fallback.
- Security self-review: GCM tags/AAD bind workspace and field; transactions serialize key creation; no credential caches, logs, browser serialization or provider calls.
- Legacy test assertions changed intentionally: retired endpoints must not mutate shared state; host layout tests follow their moved page; smoke covers the new routes.
- Local master key generated privately in ignored .env.local. Production gets a different key; retain its backup separately from databases.
- No user data removed, real messages sent, provider credentials connected, or paid services added. M4 OAuth and M5 collectors remain future work.

## Operations
- NOSTEROS_MASTER_KEY is exactly 32 random bytes in hex, configured only server-side.
- Never replace an existing master key casually: stored workspace keys depend on it. Losing it requires clients to reconnect.
- Back up this key separately from database backups with restricted access. Restore the matching key with restored workspace databases.
- Hosted beta keeps NOSTEROS_OPERATOR_FEATURES=0; legacy host/global-cache connectors are not customer-ready.
- Stripe accepts restricted-key prefixes only; actual read-only permissions will be verified during provider onboarding, not claimed by storage alone.
