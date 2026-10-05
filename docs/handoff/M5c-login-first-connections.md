# M5c: Login-first connections

## Request and decisions
- Noe wants provider sign-in instead of pasting API keys.
- Reuse native OAuth and the existing encrypted workspace vault. No new dependency or paid broker.
- Work on codex/m5c-login-first-connections; do not deploy without approval.
- Make provider sign-in primary; hide manual credentials under Advanced connections.
- Add verified Google Search Console, Analytics and YouTube resource discovery using existing read-only scopes.
- Meta, TikTok and Etsy retain existing OAuth; Meta/Etsy resource IDs remain an advanced setup limitation in this increment.
- Stripe and IMAP remain manual-only, explicitly labeled. Do not imply login support exists.
- Platform app registration/approval is still required before real provider login works. No real credentials, consent, purchases or messages in this change.

## Security and acceptance
- Discovery requires workspace admin, same-origin POST and matching workspace header.
- Use only fixed provider endpoints, bounded validated responses and a total time budget.
- Recheck membership/workspace after I/O; discard results after credential generation changes.
- Never return tokens, follow arbitrary pagination URLs, enable collection automatically or select an account silently.
- Preserve consent, manual fallback, disconnect confirmation, empty/error/loading states and keyboard access.
- Update view tests to distinguish disconnected login-first cards from authorized collection controls.
- Run focused tests, typecheck, full suite, build and desktop/mobile interaction checks.

## Report
- Built login-first provider cards; disconnected accounts no longer show technical settings forms.
- Moved manual credentials into a collapsed Advanced connections section; manual-only services are labeled honestly.
- Added Google website/property/channel discovery and an accessible selector without changing OAuth scopes.
- Discovery has bounded paging, response validation, fixed hosts, no-store responses and workspace/admin/generation rechecks.
- Empty, loading, failure, manual-selection and disconnect states are retained; collection remains opt-in.
- Added discovery and API isolation tests; updated view tests for the intentional login-first behavior.
- Focused suite: 18/18 tests pass. Typecheck and production build pass.
- Final full suite: 3,704 passed, four failed assertions; 349 files passed and seven failed, all recorded Windows baseline files.
- Corrected the new button-style audit findings; remaining interaction-layer findings are unchanged BrainCore/WorkspaceConnections baseline.
- Chrome fixture checks pass at 390px and 1280px: selection, unchecked collection consent, disabled setup, keyboard login, disconnect and empty/error states; no overflow.
- Browser verification used real components with mocked accounts/API, not real provider authorization; temporary preview server was stopped.
- No provider app, secret, purchase, real message, scope expansion or deployment was performed. Existing dev server was left untouched.
- Platform OAuth registration/approval remains required; Stripe/email login and Meta/Etsy resource discovery are not implemented here.
- Prepared on codex/m5c-login-first-connections for review; main/live release remains unchanged.

## Approved deployment: October 4, 2026, 21:13 America/Chicago
- Noe explicitly approved deployment in chat; no provider credential or permission changes were included.
- Fast-forwarded main to d47e9c7 and pushed to the existing Railway auto-deploy source.
- Railway deployment a6828b36-76c6-4a27-9508-fb5d37820eac reached SUCCESS on nosteros-web.
- Re-ran the focused connection suite on the release: 18/18 tests passed.
- Verified https://os.noepenaa.com/integrations in the existing signed-in nosterCodes browser session.
- Live page shows Continue with provider buttons, collapsed Data and permissions, and collapsed Advanced connections.
- Disconnected sources no longer display resource inputs and collection controls by default.
- Provider sign-in remains disabled pending platform app setup; Stripe/email remain explicitly manual-only.
- No workspace data, secrets, billing, account permissions, DNS or local dev-server processes were changed.
- The earlier implementation-only report is superseded by this deployment record; real OAuth consent remains untested.
