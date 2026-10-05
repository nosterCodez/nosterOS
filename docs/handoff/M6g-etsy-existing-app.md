# M6g: Authorized existing Etsy app setup

Status: in progress
Review by Claude: yes

## Goal and authorization

After M6f, use the existing Personal Access `nosterlogistics` app for OmegaOS,
as explicitly authorized by Noe through Claude on October 5, 2026.
Do not use banned app rows, create an app, push main, or change Railway.
Preserve the original callback and add:
`https://os.noepenaa.com/api/connections/oauth/etsy/callback`.
Save only the app's client ID and shared secret under `OMEGA_ETSY_CLIENT_ID`
and `OMEGA_ETSY_CLIENT_SECRET` in the private `.env.connector-keys.local`.
Noe will install these in Railway himself. Do not read unrelated credentials.

## Report - October 5, 2026, 14:34 CDT

- M6f completed before this task; local main at `f409920`, not pushed/deployed.
- Chrome confirmed the correct app has Personal Access; a separate banned
  namesake and banned `omegaos` app were left unchanged.
- Original callback: `https://logistics.noepenaa.com/api/etsy/callback`.
- Both callbacks are prepared in the edit form, but Save has NOT been clicked.
  An action-time confirmation for the added OAuth destination is pending in chat.
  The existing Chrome edit tab is left open for this handoff.
- A temporary loopback-only form reported both Etsy credentials saved to
  `C:/Users/noster/Documents/GitHub/nosterOS/.env.connector-keys.local`.
  The helper preserved unrelated entries; file and helper are Git-ignored.
- File ACL inspection showed only Noe's Windows account has access.
  Independent content read-back was blocked by sandbox/private-file policy;
  no workaround was attempted. Saved status is based on the helper response.
- SECURITY: a dashboard-control inspection unintentionally included the shared
  secret in an intermediate tool result. No secret values are in this report.
  Noe was informed; rotate the shared secret before production use, coordinating
  all existing consumers. Rotation is not performed or authorized by this task.
- Temporary helper stopped; its browser tab and the extra dashboard tab closed.
- No app code changed; typecheck/tests/build were not rerun for this setup-only task.
- Next: confirm/save callback, verify it persists, resolve secret rotation, then
  Noe installs credentials in Railway. No live OAuth or reporting test performed.
