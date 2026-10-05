# M6j: Etsy 403 diagnostic and authenticated shop fallback

## Approved request
Claude's Oct 5 chat reports live Etsy discovery HTTP 403 / unrecognized_provider_error.
Keep Etsy's JSON error string up to 160 characters, masking emails and digit runs
over six; owner/admin only, logged with workspace ID. Confirm endpoint/scopes against
Etsy docs. Add a fallback that resolves user_id/shop_id through users/me. Push only
a review branch; Claude reviews and relays deployment. No Railway variable changes.

## Implementation scope
- Preserve the normal owner lookup; on 403 only, GET users/me then shops/{shop_id}.
- Require identity match against the token prefix and returned shop, bounded reads,
  the existing total deadline and generation/session/workspace rechecks.
- Mask actual echoed request credentials and control characters as well as the
  approved email/digit masking before truncation. Do not retain other JSON fields.
- Update diagnostic assertions for the explicitly approved message extension;
  keep legacy-code compatibility, role isolation and no-secret assertions.

## Documentation findings
- Current official OpenAPI inherits api_key for getShopByOwnerUserId (no explicit
  shops_r requirement there); getMe explicitly requires api_key + OAuth shops_r.
- Etsy's own staff guidance says to send the Bearer token with owner lookup as well.
- Token prefix is the granting user ID; app already sends full Bearer and key:secret.
- OmegaOS requests shops_r. Existing vault records do not persist response.scope;
  no live token scope was independently inspected. Successful getMe will establish
  that this grant can read that scope-protected endpoint; token exchange alone does not.
- Sources: https://www.etsy.com/openapi/generated/oas/3.0.0.json,
  https://developers.etsy.com/documentation/essentials/authentication/,
  https://github.com/etsy/open-api/discussions/753 (Etsy staff answer).

## Report
- Oct 5, 2026, 17:45 CDT: implemented on m6j-etsy-discovery-review, based on the deployed M6h/M6i code plus local deployment checkpoint edaa567.
- Etsy-only error message field is optional for older records, limited to 160 characters after email/long-digit/request-credential masking and control-character removal.
- Error parsing retains the existing 64 KB input cap; other body fields are discarded. Email masking scans tokens without pathological backtracking on long strings.
- Existing credential-generation binding, owner/admin visibility and workspace-tagged logs apply to the message. React renders it as escaped text, never HTML.
- Original owner-shop path remains; its 403 alone triggers getMe first, then getShop using getMe's shop_id. Maximum three GETs with full Bearer and keystring:secret headers.
- Both fallback user_id and returned shop ownership/ID must match; malformed/missing IDs fail closed. Disconnect checks run between fallback reads and before returning results.
- Added 19 regression cases covering fallback, bounded call count, non-403 errors, identity mismatches, malformed IDs, disconnect races, masking, provider isolation and safe rendering; updated old code-only assertions per this approved request.
- Focused run: 62/62 passed across five files. Final typecheck and isolated production build passed; full Windows run: 3,908 passed / 4 baseline assertion failures, 375 files total.
- Seven failed suites are the known Windows baseline: interaction-layer BrainCore path exemption, paths, skills-plugins, superset-dispatch, plus EPERM cleanup in lead-magnet-actions, lead-magnets-route and roadmap-mock-5h. No new failure outside this list.
- Verified public Etsy OpenAPI/authentication docs. getMe requires shops_r; owner-shop endpoint inherits API-key security without an explicit scope, while Etsy staff guidance calls for Bearer as well. Current code requests shops_r.
- Actual live token scopes and the raw live 403 cause were NOT independently verified; saved records lack granted scope. No secret reads/exports or new live provider calls were made; successful token exchange alone is not proof all application endpoints accept the app.
- Logs are ignored .local/m6j-test-output.txt and .local/m6j-build-output.txt. Removed only generated tsconfig includes; shared dev server and unrelated handoff edits preserved.
- Review branch only; main is not pushed and Railway variables are unchanged. After Claude review/deploy go, validate Find accounts in production and inspect the sanitized diagnostic if fallback also fails.
