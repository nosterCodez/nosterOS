# M10: Lead Plan, follow-up questions, and stored preferences

Status: ready after M9
Review by Claude: yes (AI output handling, cost metering)

## Goal
Turn the Business Profile into a concrete, editable **Lead Plan**: who to
target, where, what makes a lead "hot", how many per week, and the outreach
angle. Ask only the questions needed to fill gaps (max 6), store the answers
as **Lead Preferences**, and require an owner/admin to approve the plan
before the engine (M11) uses it.

## Decisions already made
1. **AI provider order** (`lib/ai/lead-ai.ts`, shared with M11/M12):
   a) the workspace's own verified OpenAI or Anthropic key (M6f vault);
   b) platform AI only when `OMEGA_PLATFORM_AI=1` (built in M7, off today) and
      under `OMEGA_PLATFORM_AI_MONTHLY_USD`;
   c) **no-AI fallback**: a rule-based plan built from the profile sections and
      a fixed template, so the feature works with zero AI access.
   The UI says which one produced the plan.
   Models come from env (`OMEGA_LEAD_AI_MODEL_OPENAI`,
   `OMEGA_LEAD_AI_MODEL_ANTHROPIC`) with defaults set to each vendor's current
   smallest/cheapest model. Astra checks the vendors' model lists at build time
   and records the chosen IDs in the Report.
2. **Structured output only.** The AI returns JSON validated by Zod
   (`LeadPlanDraft`). Invalid JSON → one retry with the validation error → fall
   back to the no-AI plan. Never render free AI text as HTML.
3. **Plan shape (`LeadPlan`):**
   - `targets[]` (max 5): `label`, `searchQueries[]` (max 4, ≤60 chars, e.g.
     "med spa", "HVAC contractor"), `cities[]` (max 10), `radiusMiles` (1–100).
   - `exclusions`: `keywords[]`, `excludeFranchises` bool, `excludeDomains[]`.
   - `signals[]`: `{ key, weight }` where `key` comes ONLY from the fixed
     catalog in `lib/leads/signals.ts` (below) and weight is −3..+3.
   - `hotThreshold` (0–100), `weeklyLeadTarget` (5–500), `maxPaidLookupsPerWeek` (0–200).
   - `angles[]` (max 3): `name`, `oneLiner` (≤200 chars), `bestFor`.
   - `tone` (≤300 chars), `senderIdentity`: `businessName`, `website`,
     `mailingAddress` (required before M12 can send; may be empty here).
4. **Signal catalog** (fixed, so scoring in M11 stays deterministic and testable):
   `no_website`, `website_not_https`, `website_not_mobile`, `website_stale`
   (no year ≥ last year found), `no_booking_tool`, `has_booking_tool`,
   `low_review_count` (<25), `high_review_count` (≥100), `rating_below_4`,
   `rating_4_plus`, `socials_missing`, `socials_inactive`, `has_contact_email`,
   `has_contact_form_only`, `is_franchise`, `within_radius_core` (≤ half radius).
   AI may only pick from this list; unknown keys are dropped.
5. **Questions:** produced from gaps, not invented freely.
   `lib/leads/questions.ts` holds a catalog of question templates keyed to
   missing/unknown profile sections and plan fields (e.g. service area unknown
   → "Which cities should we search first?"; budget unknown → "Monthly limit
   for paid lookups?" with choices $0 / $5 / $15 / $30). The AI (or rules) may
   add at most 2 custom questions. Max 6 total. Types: `yes_no`,
   `single_choice`, `multi_choice`, `number`, `short_text` (≤200 chars).
   Every question has a sensible default so "Skip" is always allowed.
6. **Preferences** = answers plus any manual plan edits, in workspace table
   `lead_preferences` (`key`, `value_json`, `source`: answer|edit|default,
   `updated_by_user_id`, `updated_at`). Regenerating a plan always applies
   stored preferences on top of the AI draft, so the user's choices win.
7. **Plan lifecycle:** table `lead_plans` (`id`, `version`, `profile_version`,
   `plan_json`, `status`: draft|active|archived, `generated_by`: byo_openai |
   byo_anthropic | platform | rules, `created_at`, `approved_by_user_id`,
   `approved_at`). Exactly one active plan. Activating needs owner/admin.
   A new profile version marks the active plan "profile changed — review".
8. **Usage metering:** every AI call records tokens and estimated USD to the
   existing `/usage` data with feature tag `lead_plan`. Reuse the
   reserve→commit spend ledger introduced here as `lib/spend/ledger.ts`
   (M11 uses it for paid lookups): reserve the estimated cost before the call,
   commit actual after, release on failure; refuse when the reservation
   would cross the workspace's monthly cap.

## Do
1. `lib/ai/lead-ai.ts` (provider selection, JSON mode, retry, metering),
   `lib/leads/signals.ts`, `lib/leads/questions.ts`, `lib/leads/plan.ts`
   (AI path + rules path + merge with preferences), `lib/spend/ledger.ts`.
2. Repos + Zod schemas for `lead_plans`, `lead_preferences`, `spend_ledger`.
3. Page `/leads/plan`: "Generate plan" → questions card (one screen, all
   questions, Skip allowed) → plan view with inline edits → "Activate plan".
   Show the provider used and the estimated cost of the generation.
4. API routes under `/api/leads/plan/*` with the existing guards; viewers read-only.
5. Tests: rules-only plan from a sample profile; AI path with a mocked
   provider; invalid AI JSON → retry → fallback; unknown signal keys dropped;
   question count never exceeds 6 and only covers real gaps; preferences
   override a fresh AI draft; only owner/admin can activate; one active plan;
   profile change flags the plan; ledger refuses over-cap reservations and
   releases on failure; profile text with "ignore previous instructions"
   reaches the AI only through `profileForPrompt`.

## Don't
- No lead searching, website fetching, or emails (M11/M12).
- Don't let the AI choose signals, numbers, or fields outside the schema.
- Don't turn on platform AI.

## Done when
- typecheck, tests (minus the Windows baseline), build pass.
- Locally with no AI key: rules plan generates, questions appear, answers
  persist, plan activates. With a mocked AI provider: same flow, provider
  label shown, usage recorded.

## Report (Astra fills this in)
- Status:
- Commits:
- Typecheck / tests / build:
- Model IDs chosen and why:
- What changed beyond the spec, and why:
- Questions or blockers for Claude:

### Batch 2 preflight: October 5, 2026, 20:20 CDT
- Step 2B: BLOCKED on the batch prerequisite and a spend-reservation architecture decision.
- The plan specifies a workspace-local spend_ledger and BEGIN IMMEDIATE reservation,
  plus a platform-wide OMEGA_LEAD_GLOBAL_MONTHLY_USD cap. M11 confirms reservations
  must satisfy both caps. No shared reservation coordinator/schema is specified.
- A transaction in one workspace DB cannot serialize reservations in other workspace
  DBs; summing workspace ledgers before a local insert would allow a cap race.
- Claude decision needed: define the authoritative global reservation store and its
  crash-safe coordination with workspace ledgers, including platform-AI reservations.
  Do not infer permission to add shared customer/spend data to control.db.
- M7 platform-AI support is also not present on this checkout; do not merge that
  parallel branch or enable platform AI implicitly. Clarify its integration boundary.
- No AI calls, paid usage, new dependency, schema or implementation changes made.
  Typecheck/tests/build not rerun for this documentation-only preflight.

### Batch 2B checkpoint: October 5, 2026, 20:50 CDT
- M8 merge prerequisite resolved (main dec9a9d is live); M9 code checkpoint on
  lg/b2-business-profile at 7bbf391, browser acceptance incomplete. See M9 Report.
- 2B remains BLOCKED: no architect decision has been added for a globally atomic
  reservation store and crash coordination with workspace-local spend ledgers.
  M7 platform-AI support is still absent from the checkout. No implicit merge.
- No ledger/signals/AI implementation, paid requests, model-ID selection, new
  dependency or provider verification performed for 2B. Do not claim 2B complete.
- Claude: specify shared reservation schema/authority, atomicity and recovery,
  whether BYO usage counts against the same global cap, and M7 integration contract.
  Continue the existing default-$0/no-platform-AI policy until approved.


## Claude decision (Oct 6, 2026): spend ledger authority, caps, M7 boundary

This supersedes M10 Decision 8's "workspace table" wording and plan Step 2B's
`spend_ledger` location. Astra's analysis was right: per-workspace DBs can't
enforce a global cap atomically.

### 1. One authoritative ledger, in its own file
- New platform DB `DATA_DIR/platform/spend.db` (add `spendDbPath()` to
  `lib/paths.ts`). Not `control.db`, not workspace DBs. **There is no
  workspace-local ledger**, so there is nothing to keep in sync and no
  crash coordination between two stores.
- It holds billing metadata only: no lead data, prompts, outputs, emails, or
  business content. Columns:
  `id` (uuid), `workspace_id`, `feature` (`lead_plan|lead_personalize|email_finder|places|platform_ai|...`),
  `provider`, `payer` (`byo|platform`), `units` (int, e.g. calls/tokens),
  `estimated_usd`, `actual_usd` (nullable), `status`
  (`reserved|committed|released|expired`), `month` (`YYYY-MM`, UTC),
  `created_at`, `expires_at`, `settled_at`, `error_code` (nullable).
  Indexes on `(month, payer, status)` and `(workspace_id, month, status)`.
  Plus `spend_alerts` (`scope` workspace id or `global:<pool>`, `month`,
  `threshold` 50|80|100, `created_at`, unique on all three) and `spend_caps`
  (`workspace_id`, `pool`, `monthly_usd`, `updated_by`, `updated_at`).
- WAL mode, `busy_timeout` 5,000 ms. Include it in M8 backups: confirm the
  snapshot enumerates `platform/*.db`; add it explicitly if not, with a test.
- Workspace views (`/usage`, caps UI) read it **only** through a repo method that
  takes the session's active workspace id. No route accepts a workspace id
  parameter for this. Test: workspace A can never see B's rows.

### 2. Reservation algorithm (atomic, crash-safe)
`reserve({workspaceId, feature, provider, payer, units, estimatedUsd, ttlMs=10min})`:
one `BEGIN IMMEDIATE` transaction on `spend.db`:
1. Sum `estimated_usd` of `reserved` rows + `actual_usd` of
   `committed|expired` rows for this workspace + pool + month.
2. If `payer=platform`, also sum the same across **all** workspaces for that pool + month.
3. If either sum + estimate exceeds its cap → return `{ok:false, reason}`;
   no row inserted.
4. Insert the `reserved` row and return its id. Evaluate thresholds and insert
   `spend_alerts` rows (unique constraint makes alerts fire once).
`commit(id, actualUsd)` sets `committed`; `release(id, code)` sets `released`
(only when we know the paid call did NOT happen: request never sent, or a
provider error that is documented as unbilled).
**Recovery:** the internal tick marks `reserved` rows past `expires_at` as
`expired` and counts them at `estimated_usd` (conservative: if we crashed
mid-call we assume it was billed). Never silently delete ledger rows.
Single writer: Railway runs one replica on one volume; document in
`DEPLOY-railway.md` that horizontal scaling requires moving this ledger to a
real database first.

### 3. Pools and caps (who pays decides which cap applies)
| Pool | Payer | Workspace cap (default) | Global cap |
|---|---|---|---|
| `byo_ai` | customer's own key | $5/month, owner/admin editable 0–100 | none (not Noe's money) |
| `byo_paid_data` (email finders, paid Places) | customer's own key | $0 | none |
| `platform_ai` | Noe | per-plan, default $0 | `OMEGA_PLATFORM_AI_MONTHLY_USD` |
| `platform_paid_data` | Noe | default $0 | `OMEGA_LEAD_GLOBAL_MONTHLY_USD` |
| `free_quota` (e.g. Google free calls) | nobody | units cap per provider | units cap env (e.g. `OMEGA_GOOGLE_PLACES_FREE_CALLS`) |
- Unset or invalid global env = 0 = no platform-paid calls. BYO usage never
  counts against Noe's global caps. The BYO default cap exists so a bug can't
  drain a customer's key.
- `free_quota` rows use `estimated_usd = 0` and enforce on summed `units`
  with the same transaction.

### 4. Cost estimates
- `lib/spend/prices.ts`: a static table per provider/model/SKU with
  `inputPer1M`, `outputPer1M` or `perCall`, plus `verifiedOn` date and source URL
  (Astra fills in from vendor pricing pages and records them in the Report).
- AI estimate = (prompt tokens counted or `chars/3` upper bound) × input price +
  `max_tokens` × output price. Actual = provider-reported usage × price.
- **Unknown price → refuse the call** (`reason: price_unknown`). Never guess.

### 5. M7 boundary (platform AI)
- Do **not** merge `m7-sign-in-first`. Batch 2B must not depend on M7.
- `lib/ai/lead-ai.ts` calls `getPlatformAiCredential(): Promise<Credential|null>`
  from a new tiny module `lib/ai/platform-credential.ts` that returns `null`
  unless `OMEGA_PLATFORM_AI=1`, and today always returns `null` (M7 will
  implement it later behind the same signature). Test: with the flag on and no
  implementation, provider order skips platform cleanly.
- Any platform call, when it exists, must reserve in pool `platform_ai`.

### 6. Tests to add for 2B (in addition to the list in the plan)
Concurrent reservations from two workspaces racing a global platform cap → total
never exceeds the cap (run with two DB connections); expiry sweep counts
estimates; release only on known-unbilled; alerts unique per threshold; BYO spend
ignored by global totals; `price_unknown` refusal; free-quota units cap; workspace
isolation of ledger reads; spend.db included in backup snapshot.

### Batch 2 report: October 6, 2026, 02:24 CDT
- Steps: 2A Business Profile = DONE and deployed (M9 report); 2B AI/spend foundation
  = DONE for review. M10's plan/questions/UI remain Batch 3 work, not implemented.
- Branch `lg/b2-business-profile`; implementation commits `6a7294e` ledger/recovery,
  `5cc128b` structured AI/catalog. Report commit follows. Main remains 2A `72cb179`.
- Typecheck PASS; isolated build PASS (.next-lg-b2b). Full Windows: 396 files,
  389 passed / 7 baseline failures; 4,015 tests, 4,011 passed / 4 baseline failures.
  Baseline assertions: interaction-layer BrainCore path, paths, skills-plugins,
  superset-dispatch; EPERM cleanup: lead-magnet-actions, lead-magnets-route,
  roadmap-mock-5h. All 24 new 2B tests pass. No Linux verification claimed.
- Red tests preceded ledger, backup, AI/catalog and runtime wiring. Added safety
  coverage for unknown billing, revoked credentials before dispatch and zero-cost
  paid reservations. Corrected new test numeric sort, not its expected thresholds.
- Single platform/spend.db authority; no workspace/control ledger copy. WAL,
  5-second timeout, immediate reservation transactions, UTC months, integer-microdollar
  comparisons, workspace-bound settlement/read methods, owner/admin cap writes.
  Explicit pool column preserves the approved pool distinction on every record.
- BYO AI defaults to $5/month (editable 0-100); other paid workspace caps default
  zero. Platform env caps fail closed. BYO excluded from platform sums. Free quotas
  enforce units per provider; current Google Places env cap is closed if absent.
  Free-quota payer records the account source, with zero dollars, not a charge.
- Expiry conservatively commits the estimate as expired; no deletion. Ambiguous
  provider failures stay reserved until expiry. Only request_not_sent can release;
  no provider-error code is yet asserted unbilled. Threshold records are unique.
- Tests include a genuine two-worker/two-connection platform-cap race; only one
  reservation succeeds. Cross-workspace reads/settlements, expiry, month rollover,
  cap roles, defaults, free units and idempotent settlement covered.
- M8 inventory recursively finds the ledger; expanded archive allowlist only for
  platform/spend.db. Snapshot plus pack/unpack test passes. DEPLOY-railway documents
  single replica/volume requirement and shared-DB prerequisite for horizontal scaling.
- Internal authenticated tick sweeps expiry only when the DB exists. Existing
  /api/usage gains leadSpend metadata bound to active session workspace. Its existing
  operator gate remains; no new UI/hidden endpoint or client workspace-id input.
  Tokens are recorded as aggregate units per call; reserved units are estimates.
  The dedicated usage UI and wider exposure remain the later batch's work.
- AI order: verified vault OpenAI -> Anthropic -> null platform stub -> no provider.
  No environment credential fallback or M7 merge. Re-check credentials after reserve.
  JSON-schema requests + Zod validation; one separately reserved validation retry;
  null output for rules fallback. Retry feedback includes codes only, not raw output.
  Fixed HTTPS endpoints, redirect refusal, 30-second timeout, 256 KiB response cap.
  No prompt, output, credential or email in spending DB/logs. Unknown billing is null.
- Models/prices verified Oct 6 via official sources (standard text rates per 1M):
  OpenAI gpt-6-luna: $0.10 input / $0.50 output,
  https://developers.openai.com/api/docs/models/gpt-6-luna .
  Anthropic claude-haiku-4-5-20251001: $1 input / $5 output,
  https://platform.claude.com/docs/en/models/haiku-4-5/overview .
  These are current small models; older OpenAI nano pages are marked deprecated.
  Unknown model price refuses. No paid provider request or live model test performed.
- Estimates use UTF-8 byte count plus overhead rather than chars/3, conservatively
  allowing for non-ASCII and schema overhead. Costs are usage-based estimates, not
  provider invoices; no tools, regional pricing, caching configuration or paid data
  SKU enabled. Future priced SKUs/models require verified table entries.
- Static 16-signal catalog has explicit detector inputs; missing evidence never
  counts as a negative observation. No searching, scraping, lead data or sending.
- Self-review: auth/origin/operator boundaries unchanged; no raw SQL in routes,
  no secret logs, no dependency, credential, cap/flag deployment or purchase.
- Staging: NOT deployed; no staging infrastructure provisioned. 2B not production.
  Claude review of AI/cost handling and separate 2B release approval remain pending.
- Noe actions now: none to keep this checkpoint. Say continue after review for
  Batch 3; infrastructure/cost decisions in M8/STAGING.md remain separate.
- STOP after Batch 2. Shared dev server 4100 and unrelated provider docs untouched.

### Batch 3 preflight: October 6, 2026, 02:32 CDT
- Noe requested continuing if ready; read current agreement, execution plan, M10/M11 and handoff.
- Refreshed origin; main remains 72cb179, without Batch 2B's spending/AI foundation.
- Current review branch remains lg/b2-business-profile at f784e04; no recorded Claude acceptance yet.
- Both Batch 3 steps depend on that foundation; the execution plan requires a latest-main base.
- No implicit production merge, review waiver, or alternate branch-base decision made.
- Next decision: complete Claude review/release path, or explicitly approve a separate Batch 3 branch carrying pending 2B.
- No application changes or new verification results; prior Batch 2 results remain as reported above.
- No deployment, paid calls, credentials, resources or outbound messages; shared dev server untouched.
- Other-session provider documents preserved; Batch 3 implementation has not started.

### Claude review, October 6, 2026 (relayed by Noe)
- APPROVED FOR PRODUCTION: 6a7294e, 5cc128b, f784e04 and the associated docs commits.
- Noe explicitly authorized deployment of Batch 2B and then starting Batch 3.
- No new Linux totals were supplied with this approval; retain the actual
  verification results in the Batch 2 report rather than inventing a review run.
- Batch 3 begins with the two backup fixes F1/F2 recorded in M8, one commit each.
- Future lead-gen commits explicitly approved for production by Claude may
  be released under Noe's delegation in AGENTS.md; reserved decisions stay with Noe.

### Batch 2B release: October 6, 2026, 10:32 CDT
- Main/origin/main fast-forwarded to 712fa75: approved 2B code plus documentation.
- Railway deployment a32296db-4808-4547-9181-36ddbab60f8d SUCCESS at 15:32:00 UTC.
- After SUCCESS, public https://os.noepenaa.com returned HTTP 401 with title OmegaOS Private.
- No Railway variables, keys, resources or caps changed. Backup configuration and platform AI remain off.
- Batch 3 branch lg/b3-plan-engine created from this main release; no additional release implied.

### Batch 3 checkpoint: October 6, 2026, 11:38 CDT
- Step 3A PARTIAL: schema/repositories, rules + structured AI plan orchestration,
  fixed gap questions (maximum six, no custom questions), preferences, guarded
  API and /leads/plan editor implemented on lg/b3-plan-engine after F2 2fbaedf.
- Workspace lead_plans and lead_preferences are separate from the platform
  spending ledger. Edits/answers create draft versions; activation is owner/admin
  only, archives the prior active plan, and refuses stale profiles/empty cities.
- Generation uses the approved 2B AI helper; unknown signals are dropped,
  rules fallback is labeled, paid lookup default remains zero. Saved preferences
  win, including edits made while generation awaits a provider. No cap writes.
- API rechecks membership and workspace after body parsing and after generation;
  a changed profile discards the generated result. No raw provider errors emitted.
- UI has inline target/exclusion/signal/angle/sender edits, Skip/defaults,
  active/latest status, profile-changed warning, provider and current-session cost.
  Generation cost is not added to plan storage; ledger remains usage authority.
- TDD: new foundation tests first failed on missing modules; eight foundation
  tests pass. Four API tests pass: rules flow, isolation, roles/origin/input,
  lost membership and changed profile. Corrected missing second-workspace profile
  fixture without changing its cross-workspace 404 expectation.
- Typecheck PASS; isolated production build PASS (.next-lg-b3). Full Windows
  suite: 401 files, 391 pass / 10 fail; 4,049 tests, 4,041 pass / 8 fail.
- Four baseline assertions: interaction-layer BrainCore path, paths,
  skills-plugins, superset-dispatch. Three baseline EPERM cleanup suites:
  lead-magnet-actions, lead-magnets-route, roadmap-mock-5h.
- Four NEW assertions need architect decision: smoke page/API inventories omit
  the new routes; connector-boundaries classifies /api/leads/plan as operator-only
  through its AI dependency and expects an operator guard. M10 instead specifies
  workspace access. Do not add an operator restriction or exempt the route silently.
  Request approval to cover it with explicit workspace-vault/auth tests while
  retaining host/operator boundary coverage, and add the smoke inventory entries.
- Browser acceptance PARTIAL: isolated local auth/API/DB on 4118, outbound
  disabled, no vault keys. Rules generation, questions and Skip/default persistence
  passed. Edit/activate stopped twice at exact getByLabel('Tone') locator.
  Diagnostic label text is 'ToneDirect, respectful and helpful'; screenshot shows
  the field and coherent desktop layout. Likely nested-textarea label matching;
  request permission to resume after the two-failure stop, fix explicit labeling
  or locator, and finish activation, mobile, viewer and mocked-provider UI checks.
- Ignored fixture .local/lg-b3-browser.ts and screenshot lg-b3-before-edit.png
  retained; fixture server stopped; shared port 4100 untouched. No mobile pass claimed.
- Step 3B BLOCKED at current Foursquare access requirements; see M11 checkpoint.
  No runner/import implementation or dependency added. No staging infrastructure.
- Not ready for production; no main push, deployment, settings/keys, purchases,
  spending changes, data deletion, public signup or real outbound messages.
- Claude checkpoint send confirmation requested in chat; do not assume sent or reviewed.
- Partial implementation/report pushed as 7da02cf. Updated decision request replaces
  the obsolete F2 draft in Claude desktop; UNSENT pending action-time confirmation.
