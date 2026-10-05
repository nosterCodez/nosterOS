# M7: Sign-in first, keys only for advanced

Status: ready after the commerce deploy. Written by Claude (lead architect), Oct 5, 2026.
Self-review required: yes (OAuth, credentials, platform keys).

## M6f review
`4ff3140` accepted. Linux clone: typecheck clean, 369 files / 3,837 tests all
pass. Probe choices and the conservative `unverifiable` calls are approved.

## Goal (Noe, Oct 5)
Every OmegaOS user should connect services by clicking "Sign in with X" and
approving. Nobody should need an API key unless they choose an advanced
connector. The Connections page must say honestly which sign-ins work today
and which are waiting on a platform approval.

## Decisions
1. **Connections page layout.** Each provider card leads with one primary
   button, "Sign in with <Provider>". Pasted keys move under a collapsed
   "Advanced: use your own API key" section on the cards that support
   them. Providers with no sign-in option at all (Attio, GoHighLevel,
   ManyChat, Fathom, Foreplay, Arcads) are grouped under "Advanced
   connectors".
2. **Honest availability per provider**, driven by config, not hardcoded:
   - `available`: sign-in works for any user;
   - `owner_only`: works only for the platform owner's own accounts (e.g.
     Etsy Personal Access, Google OAuth in testing mode with listed test
     users). Other workspaces see "Coming soon, waiting on <Provider>
     approval";
   - `pending_approval` / `unavailable`: button disabled with the reason.
   Add `OMEGA_<PROVIDER>_AUDIENCE=owner|public` env flags. Default `owner`
   for every provider until Noe flips one to `public` after the platform
   approves.
3. **Stripe sign-in.** Add Stripe Connect OAuth (Standard accounts,
   `read_only` scope) as the primary Stripe path, so users approve instead
   of creating restricted keys. Keep the restricted-key field under
   Advanced. Platform credentials: `OMEGA_STRIPE_CONNECT_CLIENT_ID` plus the
   existing platform secret key, set by Noe in Railway. Same state, vault,
   role and workspace-binding rules as the other OAuth providers. Read-only
   collection only; never create charges, transfers or payouts.
4. **Email.** Keep the IMAP app-password path for now, labeled "Advanced"
   with plain setup steps. A "Sign in with Google" mailbox needs Gmail's
   restricted scopes and a paid security assessment, so that's a later
   decision for Noe. Don't build it now.
5. **AI (OpenAI/Anthropic) without user keys.** Neither offers user sign-in
   for API access. Build the switch but leave it off:
   `OMEGA_PLATFORM_AI=off|on` plus a per-workspace monthly cap
   (`OMEGA_PLATFORM_AI_MONTHLY_USD`, default 0 = disabled). When on, agents
   and the Conductor use the platform key from the server environment, with
   per-workspace usage metering, a hard cap that stops calls, and the
   workspace's own pasted key taking priority when present. Default `off`:
   turning it on costs Noe money, so it's his decision later.
6. **Setup checklist for Noe.** Add an owner-only "Platform setup" panel
   (nosterCodes workspace only) listing each provider's platform status:
   credentials present (yes/no, never values), callback URL to register,
   audience, last successful sign-in. This replaces hunting through Railway.

## Tests
Audience flags gate the button for non-owner workspaces; owner_only works for
the owner workspace and is refused (server-side, not just hidden) for others;
Stripe Connect state/workspace binding, read_only scope check, token in vault,
no write calls; platform AI off by default, cap enforced, own key preferred,
metering per workspace; platform setup panel never returns secret values and
is invisible outside the operator workspace.

## Report

### Preflight - October 5, 2026, 14:43 CDT

- Created `m7-sign-in-first` from local main `cace87a`; no main push or deployment.
- M6f acceptance and Linux results above are Claude's review; not rerun here.
- M6g remains incomplete: the Etsy callback Save is awaiting action-time approval;
  credential storage and the secret-exposure/rotation warning are in its report.
- Read current OAuth, operator binding, LLM and cost-accounting implementations.
- `lib/connectors/llm.ts` uses the AI Gateway and operator credential resolution,
  not the workspace OpenAI/Anthropic keys. Its six-step tool loop has no spending
  reservation. `lib/agent-costs.ts` is explicitly estimated accounting and falls
  back to a default price for unknown models; it cannot enforce a hard USD cap.
- Stopped under AGENTS.md's architecture/data-model/security decision rule before
  changing application behavior. No paid requests, key reads or external setup.
- Typecheck/tests/build not run: preflight and documentation only.

### Decisions needed from Claude

1. Approve direct OpenAI/Anthropic adapters for workspace keys and opted-in
   platform keys, or specify the intended Gateway/BYOK path. Specify the default
   provider/model selection when both workspace keys exist. Proposed platform
   configuration: explicit provider/model allowlist with verified price ceilings;
   unknown models or missing rates fail closed, never use estimated default rates.
2. Approve a persistent per-workspace monthly reservation ledger (UTC month,
   integer monetary units, atomic reserve before each billable step including
   Conductor routing/tool iterations). Proposed policy: reserve a conservative
   upper bound using bounded inputs/output limits; settle only with reliable usage;
   retain reservations on ambiguous failures/missing usage, and never auto-refund
   an in-flight reservation after a crash. This prevents parallel calls exceeding
   the cap. Own-key calls do not consume the platform subsidy budget and never
   silently fall back to a platform key on failure.
3. The spec header says ready after commerce deploy, while chat requests starting
   the branch now. Branch/preflight are done; confirm implementation may proceed
   before deploy and the pending Etsy callback/rotation are resolved.

No decisions above have been treated as approved or implemented.
