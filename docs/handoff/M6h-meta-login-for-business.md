# M6h: Meta app is live in development mode, support config_id

Status: ready. Written by Claude (lead architect), Oct 5, 2026. Small; can go on main after Noe's deploy approval (Claude relays).

## Facts
- Noe created the Meta app **OmegaOS**, App ID `4154010854733834`, unpublished
  (development mode). Use cases added: Measure ad performance data with
  Marketing API; Manage everything on your Page; Manage messaging & content
  on Instagram. Product: Facebook Login for Business. Graph API version
  shown: `v26.0`.
- In development mode, people with an app role (Noe) can authorize their own
  Pages, Instagram professional accounts and ad accounts without App Review.

## Decision
Facebook Login for Business uses a **configuration ID** (`config_id`) that
bundles the permissions, instead of the `scope` parameter. Support both:
- New optional env `OMEGA_META_CONFIG_ID`. When set, the authorize URL sends
  `config_id=<id>` and omits `scope`; when unset, keep today's `scope` list
  (`pages_show_list,pages_read_engagement,instagram_basic,ads_read`).
- After token exchange, keep the existing granted-permission check (the
  token must hold the four permissions above); a configuration missing one
  fails closed with the existing "permission" error.
- Validate the env value as digits only. Add tests for both paths.
- Owner-only audience (per M7) until Meta approves App Review.

Noe's Railway values: `OMEGA_META_CLIENT_ID=4154010854733834`,
`OMEGA_META_API_VERSION=v26.0`, `OMEGA_META_CLIENT_SECRET` (Noe pastes),
`OMEGA_META_CONFIG_ID` (Noe creates the configuration).

## Report

### October 5, 2026, 16:16 CDT
- Implemented on local `main`; no push, deployment, Railway variable changes,
  new credentials, paid requests, or app publication.
- Optional digits-only `OMEGA_META_CONFIG_ID` replaces `scope` with `config_id`
  in Meta authorization URLs. Empty/unset keeps the existing four-scope path;
  invalid values fail setup before writing pending state. Other providers unchanged.
- Spec discrepancy found: there was no existing Meta granted-permission check
  in the current callback. Implemented the explicitly specified requirement:
  GET the versioned `/me/permissions` using a Bearer header; require all four
  permissions to be `granted` before storing tokens. Missing, declined, expired
  or malformed grants fail closed; previous tokens remain intact.
- Preserved state/session/workspace binding, single-use state, encrypted vault
  storage, post-I/O membership recheck and concurrent disconnect protection.
  No scope expansion or changes to collectors. Owner-only audience enforcement
  remains M7 work; this does not claim public Meta approval or live connectivity.
- Added 21 new tests. Focused OAuth run: 38/38 passed. Typecheck passed.
- Full Windows run: 370 files, 3,854 passing tests, 4 known Windows assertion
  failures plus 3 known EPERM cleanup suites. Failures: BrainCore path exemption
  in interaction-layer, paths, skills-plugins, superset-dispatch; cleanup:
  lead-magnet-actions, lead-magnets-route, roadmap-mock-5h. No new regressions.
- Production build passed using `.next-m6h-meta` and `.local/m6h-meta-build-data`;
  removed only generated tsconfig includes afterward. Shared dev server untouched.
- Noe completed Meta password re-entry in Chrome. Captured App Secret privately,
  then closed the revealing tab. Appended `OMEGA_META_CLIENT_SECRET` via a
  temporary loopback-only form to the existing `.env.connector-keys.local`.
  Existing private-file contents were NOT read; save form confirmed success.
  No secret printed/committed or copied to Railway. Helper stopped and tab closed.
- The connector file and helper are Git-ignored. Existing configuration wizard
  was left untouched. No configuration ID was created or installed by this task.
- Codex has no available tool to close an individual file side-panel tab;
  asked Noe to close the exposed keys tab. Do not claim it was closed.
- Meta reference pages were inaccessible to web documentation lookup; actual
  provider authorization remains untested. Tests use synthetic token responses.
- Next: Claude reviews code and Linux suite, Noe completes the four-permission
  configuration, then Claude relays deployment approval. Do not push main yet.

### Railway staging checkpoint - October 5, 2026, 16:23 CDT
- Noe approved six named production variables and one combined Apply through Chrome; no code-push approval relayed.
- Correct target confirmed in Chrome: project nosterOS, production, service nosteros-web.
- Staged `OMEGA_META_CLIENT_ID`, `OMEGA_META_API_VERSION`, `OMEGA_META_CONFIG_ID` only.
- Railway visibly reports Apply 3 changes; no Apply/Deploy clicked and no redeploy triggered.
- Private-file transfer helper creation was rejected by the safety reviewer because of the earlier private-file restriction.
- No alternative read, indirect transfer or credential-value output attempted after rejection.
- Asked Noe to stage `OMEGA_META_CLIENT_SECRET`, `OMEGA_ETSY_CLIENT_ID`, `OMEGA_ETSY_CLIENT_SECRET` himself, without deploying yet.
- Railway Variables tab remains open so all six can be applied together after the missing three are staged.
- Meta Basic settings App domains field is empty; cannot confirm os.noepenaa.com is saved. No Meta fields edited.
- Login Settings navigation did not change pages on two attempts; stopped under AGENTS.md. Redirect URI remains unverified.
- Meta Basic settings tab left open; no credential reveals, permissions, app publication or unrelated variables changed.
- M6h code remains local at `d82f196`; no main push. Public deployment still lacks this config_id implementation.
- Next: resolve credential handoff and Meta domain/callback setup, then one combined Railway Apply; separately obtain code deploy approval.
