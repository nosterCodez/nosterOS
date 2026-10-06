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
