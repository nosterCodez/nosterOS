# Architect fallback: when Claude is unavailable, Astra takes over

Written by Claude (lead architect) on Oct 5, 2026, at Noe's request.

## When this applies
Claude is the lead architect (see `AGENTS.md`). If Claude is unavailable
(out of usage, session ended, or not responding), **and Noe tells Astra in
chat to use this file**, Astra acts as both architect and builder for the
specs listed below until Noe says Claude is back. Without Noe saying so, the
normal handoff loop and stop rules apply.

When Claude returns, Claude reads every Report and every
"Architect decision (Astra)" section written while this was active and either
accepts or revises them.

## What Astra may decide while this is active
- Engineering details the spec leaves open: file layout, function names,
  internal data shapes, query design, UI layout inside the design system,
  test structure, and refactors needed to implement a spec.
- A new small dependency, if it is widely used, MIT/Apache/BSD licensed,
  and has no install scripts. Record it.
- Changing a test's assertion when the spec's behavior requires it. Record why.
- Splitting a spec into sub-specs (e.g. `M11a`, `M11b`) when it grows too big.
- Writing the next spec in the queue if it isn't written yet, using
  `docs/handoff/README.md`'s template, before implementing it.

Record every such decision in the spec under a heading
`## Architect decision (Astra, fallback)` with one line per decision.

## What still needs Noe (no exceptions)
Money and paid resources · real messages to real people · credentials and
Railway variables · legal text (footer, unsubscribe page, privacy, terms) ·
publishing or pushing to `main` / production deploys · deleting data ·
raising any spend cap · turning on platform AI · buying domains or changing DNS.
Ask Noe in chat with one clear question and the exact action.

## What Astra must not change even in fallback
These are Claude's security decisions; don't weaken them without Claude:
- Workspace isolation (M2): no cross-workspace reads, no workspace data in shared DBs.
- Credential vault (M3/M6f): envelope encryption, no plaintext keys in logs,
  DB, backups, or responses; verification metadata outside credential generation.
- Auth (M1): session checks on every route, origin checks on mutations,
  internal header only on the three tick paths.
- Site reader SSRF rules (M11), untrusted-input handling (M9 `profileForPrompt`),
  AI structured-output validation (M10), spend ledger reserve→commit (M10/M11).
- Approval records before any outbound message (M12) and the CAN-SPAM block.
- Google Places caching rule and "no Maps scraping" (M11).
If one of these blocks progress, stop and write the problem in the Report;
Noe can wait for Claude.

## Self-review checklist (do this before each Report)
1. `npm run typecheck`, `npm test`, `npm run build` pass (minus the
   Windows baseline in `AGENTS.md`; Linux results are authoritative).
2. Grep the diff for secrets, `console.log` of tokens, and raw SQL in pages/routes.
3. Every new route: session guard, workspace guard, origin check on writes,
   viewer read-only, Zod validation in and out.
4. Every new outbound fetch: SSRF rules, timeout, body cap.
5. Every AI call: provider order, structured output, metering, cap.
6. Every new table: workspace DB unless the spec says shared; migrations idempotent.
7. Deploy to staging first; production only with Noe's yes.

## Queue (in order)
1. **M8** backups + staging (`M8-backups-and-staging.md`)
2. **M9** Business Profile (`M9-business-profile.md`)
3. **M10** Lead Plan + preferences (`M10-lead-plan-and-preferences.md`)
4. **M11** Lead engine v1 (`M11-lead-engine-v1.md`)
5. **M12** Outreach + approval + sending (`M12-outreach-approval-and-sending.md`)
6. **M7** sign-in-first connections (spec exists on branch `m7-sign-in-first`);
   can run in parallel with M9–M10 if it doesn't touch the same files.
7. Not yet specced (write it first if you get here): **M13** legal pages
   (privacy, terms, data deletion; drafts for Noe's approval) → Google OAuth
   verification + Meta app review submissions → **M14** plan limits for client
   workspaces (leads/month, paid cap, mailboxes) before opening lead gen to clients.

## Product intent to keep in mind (from Noe)
- Users sign in; keys only for advanced connectors.
- Lead gen must stay cheap without dropping quality: free steps first, paid
  steps last, only on the best leads, under hard caps, visible on `/usage`.
- The Business Profile prompt → paste → plan → a few questions → stored
  preferences flow is the front door for lead gen.
- Never show fake numbers. Unknown is shown as unknown.
