# M5i: Meta account connections

Status: blocked (platform activation; code implemented)
Review by Claude: no (Astra self-review)

## Goal
Let workspace admins sign in with Facebook and select Pages, linked Instagram
professional accounts, and ad accounts without manually finding their IDs.

## Context
OAuth and read-only collectors exist, but Meta platform credentials are not
configured and resource discovery is Google-only. Meta developer registration
is required in the current Chrome account; accepting its terms awaits Noe.

## Do
1. Add bounded, validated Meta resource discovery and account pickers.
2. Preserve admin/origin/workspace checks and revalidate the actual provider's
   connection generation after discovery. Never return tokens to the browser.
3. Map Meta authentication and permission failures to safe actionable errors.
4. Set up the developer app only with required approvals; store secrets privately.
5. Test discovery, workspace isolation, disconnect races, and honest empty states.

## Don't
No publishing/messaging/ads-management permissions, purchases, fake metrics,
automatic asset selection, automatic collection enrollment, or public app launch.

## Decisions
- Reuse Facebook Login scopes: pages_show_list, pages_read_engagement,
  instagram_basic, ads_read. Instagram requires a linked professional account.
- Follow cursors on a fixed Graph host, never provider-returned next URLs.
- Bound discovery to five pages, 500 entries and 15 seconds; show truncation.
- Meta app review and business verification may still be needed for users
  outside the app's development roles; do not claim universal availability.

## Done when
Typecheck, tests (excluding documented Windows baseline), build, and browser
verification pass. Record any platform/setup blockers rather than claiming live.

## Report
- Oct 4, 2026: implemented Meta Page, linked Instagram, and ad-account discovery.
- Added account pickers and read-only/shared-sign-in explanation to the existing UI.
- Discovery revalidates Meta authorization, not Google's, plus current admin/session.
- Added safe Graph error-code handling for expired login, permissions, and throttling.
- Security review: fixed HTTPS host, no redirects, bounded cursors/payloads, no tokens
  in picker output or URL query, explicit resource selection, no automatic opt-in.
- Tests cover missing credentials, workspace isolation, role/origin rejection,
  disconnected authorization, hostile next URLs, malformed IDs, limits and empty lists.
- Initial five new discovery tests failed before implementation; all now pass.
- Typecheck and production build pass. Full suite: 3,726 pass, four failed assertions
  and three teardown failures across the same seven documented Windows baseline files.
- No live Meta authorization, saved assets, sync, or browser end-to-end success claimed.
- Current Chrome account needs Meta developer registration; approval request is pending
  at the Platform Terms / Developer Policies Continue button. Tab 453120328 kept open.
- No app or credentials created; no Railway variables, scopes or real account data changed.
- Code is a local checkpoint; pushing main auto-deploys, so deployment remains pending.
- Next: approved registration, create/configure read-only Meta app, confirm supported
  Graph version/callback, private Railway secrets, then live consent/discovery/sync tests.
- Before activation verify Meta token lifetime and required token type against app setup;
  existing OAuth collector/token handling is unchanged by this checkpoint.
