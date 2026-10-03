# M2: One data directory per workspace

Status: in progress on m2-isolation; not merged, not customer-safe
Self-review required: yes (data isolation is the core security property)

## Goal
Every workspace reads and writes only its own data. After M2, code cannot
touch workspace data without saying which workspace it's for, and a new
workspace starts empty instead of with FounderOS demo content. Read
`docs/architecture/multi-tenant.md` first.

Important: until M3, connectors still read credentials from global
environment variables, so every workspace would see the owner's Stripe,
Gmail and so on. Keep the beta outer wall (`FOUNDER_OS_ACCESS_TOKEN`) on and
only invite the nosterCodes team until M3 ships.

## Decisions (made by Claude; don't reopen without a concrete problem)
1. **A directory per workspace, not just a file.** Today there are four
   SQLite files (`founder-os.db`, `bank.db`, `ledger.db`, `paykit.db`,
   resolved in `lib/data.ts`, `lib/bank.ts`, `lib/ledger.ts`,
   `lib/paykit-history.ts`) plus file stores (`lib/foreplay/store.ts`
   ad-intel, AdPilot data). All of it is workspace data. Layout:
   ```
   DATA_DIR/control.db                      (M1, shared)
   DATA_DIR/workspaces/<workspaceId>/nosteros.db
   DATA_DIR/workspaces/<workspaceId>/bank.db, ledger.db, paykit.db
   DATA_DIR/workspaces/<workspaceId>/ad-intel/ ...
   ```
   Add `workspaceDir(id)` to `lib/paths.ts`. It must validate the id
   against the exact id format Better Auth generates (a strict regex, no
   `.`, `/` or `\`) and throw otherwise, before any `path.join`. Test it
   with `../`, absolute paths and empty strings.
2. **Explicit context, no hidden global.** Remove the zero-argument
   `getDb()` singleton. Add `requireWorkspace(minRole?)` in
   `lib/session.ts`: it resolves the session (M1), the active workspace and
   the member's role, redirects to `/onboarding` when there's no active
   workspace (pages) or returns 403 (API), and returns
   `WorkspaceCtx = { user, workspace: {id, name, kind}, role, db }`.
   Pages and routes call it, then pass `ctx.db` (or `ctx`) down. Library
   functions that called `getDb()` internally take a `db: FounderDb`
   parameter instead. The compiler then flags every call site (about 63
   files in `app/` and 12 in `lib/`), and nothing can fall back to a
   default workspace. Don't use AsyncLocalStorage for this: React Server
   Components render children outside the page function's async scope, so
   it would silently lose the workspace.
3. **Open handles.** `openWorkspaceDb(id)` keeps an LRU of at most 50 open
   workspace DB handles and closes on eviction. The same pattern applies to
   bank, ledger and paykit.
4. **Seed split.** `seedDatabase` mixes structure the app needs with fake
   demo content. Split it into `seedStructure(db)` (things the app needs to
   work, e.g. the agent roster, departments, skills, workflow templates,
   default agent crons) and `seedDemo(db)` (made-up clients, funnel
   contacts and touches, social and email-list snapshots, DMs, trading,
   brand deals, proposals, lead magnets, metric snapshots, demo people and
   anything else invented). Classify every seeded table and list the
   classification in the Report. New workspaces get `seedStructure` only.
   `seedDemo` runs only when `DEMO_GATE=1`. The `SEED_VERSION` re-seed must
   never add demo rows to a non-demo workspace.
5. **Caches keyed by workspace.** Every module-level data cache becomes a
   `Map<workspaceId, entry>` (or takes the workspace id in its key). Found
   so far (verify the list is complete, and ignore constant lookup Sets):
   `lib/brain-constellation.ts` (memoryCache, wikiCache),
   `lib/agents/ambient.ts`, `lib/call-archive.ts` (job),
   `lib/connectors/brand-deals.ts`, `paperclip.ts` (cockpitIssueId),
   `slack.ts`, `zernio.ts` (3 caches), `claude-usage.ts`, `manychat.ts`,
   `beehiiv.ts` (2), `plaud.ts`, `email.ts` (unreadCache, emailCache),
   `whatsapp.ts` (2), `codex-usage.ts`.
6. **Background work.** The cron tick, collectors, the failover tick and
   the analytics refresh loop over every workspace from `control.db`, open
   that workspace's context, run its due jobs, and catch errors per
   workspace so one failure doesn't stop the rest. Log the workspace id on
   every job line.
7. **Migration of today's data.** `scripts/migrate-to-workspaces.ts`,
   idempotent, with `--dry-run`:
   - creates (or finds) the "nosterCodes" workspace, kind `agency`, owned
     by the user whose email is `NOSTEROS_OWNER_EMAIL` (that user must
     already exist from M1; if not, stop with a clear message);
   - copies `founder-os.db` → `nosteros.db` using SQLite's online backup
     API, plus `bank.db`, `ledger.db`, `paykit.db` and the `ad-intel`
     folder, into that workspace's directory; verifies row counts per
     table match; only then renames the originals to `*.migrated`;
   - re-running after success does nothing and says so.
   The nosterCodes workspace keeps its existing data, demo rows included.
   Removing those is a later, deliberate cleanup.

## Do
Implement decisions 1–7. Update `docs/architecture/multi-tenant.md` where
it says "one file per workspace" to "one directory per workspace".

## Don't
- Don't touch credential handling (M3) or add connection UI (M4).
- Don't delete any original data file. Rename only after a verified copy.
- No AsyncLocalStorage-based workspace resolution.

## Tests (one file per module, existing in-memory/temp-dir patterns)
- Two workspaces A and B: rows written through A's context (agent runs,
  metric points, a bank statement, a lead magnet) never appear through B,
  and B's are never visible in A.
- `workspaceDir` rejects traversal and malformed ids.
- A new workspace has zero rows in every table classified as demo, and
  the structural tables the app needs are present.
- Each converted cache: a value cached for A is not served for B.
- Tick: with three workspaces, one throwing, the other two still run, and
  logs carry workspace ids.
- Migration: dry run writes nothing; a real run copies, verifies counts,
  renames originals; a second run is a no-op; a mismatched count aborts
  without renaming.
- Pages and API routes: an audit test that fails if any file under `app/`
  imports from `lib/data` without going through `requireWorkspace` (or
  your equivalent single entry), so new routes can't skip it.

## Done when
- typecheck, tests (minus the Windows baseline) and build pass.
- Locally: run the migration on a copy of your real `data/` folder first
  (`--dry-run`, then for real), sign in as Noe, and confirm the nosterCodes
  workspace shows the same data as before. Create a second workspace and
  confirm it's empty (no demo clients, no fake revenue) and that nothing
  from nosterCodes appears.
- Report includes: the seed classification table, the final cache list,
  the count of call sites changed, and the self-review (what an attacker
  would try, and the test that blocks each attempt).

## Report
- Status: IN PROGRESS, foundation checkpoint only. This is not an isolated multi-tenant app yet. Existing pages/APIs still use the shared getDb(), and existing connector caches/file stores remain shared. Do not deploy publicly or invite customers.
- Commits: `02eafa4` records the spec and updated handoff. Foundation changes and this report are the next commit; M1 implementation is `bcd0fd3`.
- Typecheck / tests / build: Foundation typecheck passes. Full Windows suite: 3,519 passed / 4 failed; 321 passing files / 7 failing files, all remaining failures match the documented Windows baseline. Production build passes. Nine new foundation tests cover path validation, separate databases, empty demo tables, no fabricated payment history, LRU eviction and workspace authorization.
- Seed classification: Structural defaults currently implemented: departments, agents, agent_crons, tools, workflows, skills, personas; seed_meta stores their version. Demo-only seeded data: people, lead_magnets, sop_tasks, agent_tasks, agent_runs, roadmap_items, metrics, domains, phases, social_accounts, social_snapshots, social_dms, social_dm_snapshots, social_dm_messages, email_list_snapshots, social_posts, funnel_contacts, funnel_touches, proposals, trading_snapshots, trading_positions, trading_activity. Other runtime/history tables are not populated by seedStructure. The legacy seedDatabase still exists for old callers/tests; complete its split/removal during caller conversion. Workspace PayKit initialization explicitly suppresses the invented historical customer snapshot unless DEMO_GATE=1.
- Caches converted: None of the existing data caches yet. New app/bank/ledger/paykit handle pools use fully resolved workspace paths (paykit also uses account) as keys and cap at 50 with close-on-eviction. Before request-context wiring, account for handles held across awaits so concurrent requests cannot evict an in-use handle.
- Call sites changed: 0 legacy getDb call sites converted. Added requireWorkspace(minRole, headers, page-or-api) returning explicit user/workspace/role/db and rejecting missing or mismatched membership. Audit found 75 app/lib files mentioning getDb, including seed comments. No AsyncLocalStorage introduced.
- Migration results: offline migration is now implemented and tested on temporary fixtures (see checkpoint below). A real-data copy migration has not run. Original data files untouched. Owner email is confirmed; Noe's real local account still needs its first sign-in.
- Self-review: workspaceDir rejects all but Better Auth 1.7.7's default 32-character ASCII alphanumeric IDs before joining paths. Tests reject empty, traversal, absolute and wrong-length IDs. Separate workspace app/bank records remain separate; payment stores start empty. Session tests prove unauthenticated/missing-active/insufficient-role/mismatched-workspace requests never open a database. Full cache/route/fan-out security review remains pending until those conversions exist.
- Decisions you made beyond this spec, and why: Preserve existing shared callers during this foundation checkpoint rather than partially route real data into unmigrated workspace folders. Keep legacy PayKit behavior for existing callers/tests through an explicit seed parameter; new workspace stores disable it. Updated architecture to the directory-per-workspace and explicit-context decisions in this spec. Retained Next's auto-generated AGENTS instructions.
- Noe's approvals received: owner email is `noster@nostermarketing.com`; local auth/internal/beta secrets generated privately. No production secrets created. The initial M1 browser checks used temporary fixtures; the current preview uses the private local configuration with background jobs disabled and loopback binding.
- Next implementation: finish seed classification/split; convert all pages/routes and library callers to explicit ctx/db; workspace-scope all four stores and AdPilot/ad-intel; audit and partition connector/brain caches; fan out background work; implement idempotent verified-copy migration and complete the two-workspace end-to-end tests. Re-run full checks, self-review and fill final Report before calling M2 complete.

## Claude architect decisions (Oct 3, second session): unblocks the rest of M2

Answers to the Report's questions, plus review of `cac3e84`:
1. **Owner of the nosterCodes workspace:** `noster@nostermarketing.com`
   (Noe decided this earlier). Set `NOSTEROS_OWNER_EMAIL` to it locally.
   Noe signs in once with that email by magic link (console link, no SMTP
   needed locally) before you run the real migration.
2. **Local secrets:** approved. Generate random values for
   `BETTER_AUTH_SECRET`, `NOSTEROS_INTERNAL_SECRET` and
   `FOUNDER_OS_ACCESS_TOKEN` with `crypto.randomBytes(32)` into `.env.local`
   on Noe's PC only. Never print them in chat, logs or reports, never
   commit them. Production values are generated separately at deploy time.
3. **Handle eviction (your open note).** Don't close an evicted handle
   immediately. Move it to a "closing" list and close it after 60 seconds
   (`setTimeout(...).unref()`), so a request that holds `ctx.db` across an
   `await` never hits a closed connection. If the same key is requested
   during the grace period, revive that handle instead of opening a second
   one. Test with fake timers.
4. **Structure re-seed must not overwrite user edits.** The repos use
   `INSERT OR REPLACE`, so a `SEED_VERSION` bump would reset a workspace's
   edited agents, disabled crons, workflows and skills. `seedStructure`
   inserts only rows whose id is missing (add `insertIfMissing` or
   `INSERT OR IGNORE` variants used only by seeding). Test: edit an agent,
   bump the version, re-seed, edit survives.
5. **Retire `seedDatabase`.** Old tests that need demo rows call
   `seedStructure` + `seedDemo` explicitly with `DEMO_GATE=1` set in that
   test. Nothing in `app/` or `lib/` may call `seedDatabase` after M2
   (add it to the audit test).
6. **Root layout** (`paletteAgents()` uses `getDb()`): call
   `requireWorkspace` there on non-public pages and pass `ctx.db`.
7. **Order of work** so the app is never half-migrated on `main`: do the
   library signature changes and call-site conversion on a branch
   `m2-isolation`, merge to `main` only when every route/page goes through
   `requireWorkspace`, the audit test is green and the migration script is
   tested. Small commits on the branch are fine.
8. **nosterLogistics:** retired. Remove it from `lib/businesses.ts` in M2.
   It has no stored data of its own in the metric store yet; if you find
   rows keyed to it, keep them and list them in the Report rather than
   deleting.

After M2 is merged and reported, go straight to M3 (write the spec
yourself per HANDOFF-TO-ASTRA.md). Railway stays blocked on Noe approving
the paid project, so don't wait on it.

## Report checkpoint: Oct 3, local setup and migration safeguards
- M2 remains incomplete: no legacy shared-data callers or connector caches converted yet; not safe for customer workspaces or public deployment.
- Committed requested reel reference and new-Claude handoff in `0ff3f22`. No visual redesign or GLADOS rebrand performed in this checkpoint.
- Generated 48-byte random local auth/internal/beta secrets in gitignored `.env.local`; set approved owner email and a team email signup allowlist. Values were never printed or committed; setup script preserves nonempty values.
- Implemented offline SQLite online-backup migration, per-table row-count/integrity verification, file-tree hashing, ownership checks, preserved originals, repeat-run no-op and a migration lock. Custom storage overrides fail closed rather than silently omit data.
- Migration tests: dry run changes no files; missing owner, corrupted backup, occupied target, wrong ownership and stale lock fail safely; verified migration preserves originals; recreated legacy data is detected. Failed/interrupted copies are retained for inspection, never automatically deleted or overwritten.
- Original data migration not run. The real local owner account database is not initialized; Noe must sign in once before the real-data-copy rehearsal. App/job shutdown is required before running migration with `--server-stopped`.
- Added explicit reference-counted handle leases and scoped helpers. Engineering adjustment to the 60-second grace suggestion: leases do not assume an async request finishes within 60 seconds; leased handles cannot be evicted, and a fully busy pool fails at its capacity instead of opening unbounded connections. Request-context integration remains pending.
- Applied M1 review follow-ups: signup allowlist/invitation hook, production invite-only default, timing-safe beta comparison, safe destination-preserving sign-in redirect. Boot constants split out to avoid importing Node crypto into Edge instrumentation.
- Security self-review: exact-domain matches reject lookalikes; expired/canceled invitations cannot register; missing workspace/role checks still precede storage access; corruption/ownership/overwrite/lock migration tests pass. Complete route/cache isolation review remains outstanding.
- Verification: typecheck passes; production build passes with zero warnings. Full Windows suite: 3,535 passed, 4 failed; 324 passing files, 7 failing files, all failures in the documented baseline. Final focused security/storage suite: 43/43 pass.
- Local preview restarted from real local configuration at `http://localhost:4100`, bound to loopback, launcher PID 28632, background warmup/jobs disabled. Sign-in returns 200, unauthenticated root redirects, unauthenticated agents API returns 401.
- Next: library signature/caller conversion on `m2-isolation`, insert-only structure seeding, workspace-scoped files/caches/background tasks, complete migration rehearsal and two-workspace browser verification; then M3. Paid deployment remains separate and unapproved.

## Report checkpoint: Oct 3, 12:59 CDT - explicit data conversion
- Status: PARTIAL, on `m2-isolation`. Do not merge or deploy this checkpoint. M3 has not started; Railway still awaits Noe. M1 follow-ups and both architect review sections were already preserved in `f76ec76` before this branch.
- Converted 100 legacy `getDb()` call expressions across 73 app/lib files; zero remain. The production data accessor requires explicit context and has no singleton. Root layout resolves workspace context and passes its database to the palette. Existing unit tests use a test-only demo fixture, never an app fallback.
- Structure seed now uses transactional insert-if-missing variants for departments, agents, agent_crons, tools, workflows, skills and personas. Edited defaults and custom rows survive version refreshes; missing defaults return. Duplicate tool defaults resolve last-declaration-wins before insertion. `seedDatabase` is retired; demo population requires `DEMO_GATE=1`.
- Seed classification remains the foundation classification above; demo population no longer prunes or overwrites the seven structural tables. Existing tests that demanded deletion of customized structure or automatic demo proposals/lead magnets were updated to the approved preservation/empty-workspace contract.
- Handle pools retain reference-counted leases and add the requested 60-second delayed close with revival. Active handles are capped at 50 and pending closes at 50; saturation fails instead of early-closing an in-use handle. Fake-timer tests cover revival and delayed close.
- Financial page/uploads now use workspace bank, ledger and PayKit stores; async PayKit and upload operations use scoped leases. AdPilot campaigns, ad-intel snapshots, watchlists and saved ads now require validated workspace IDs and ignore legacy shared path overrides at runtime. Originals were not touched.
- Caches converted: brain memory/wiki and page client roster keyed by workspace; ambient agent briefs keyed by database identity in a WeakMap. Brain constellation reads workspace brain-store/vault paths and only uses a fabricated fallback in demo mode. Migration of existing external brain/vault folders remains outstanding.
- Internal cron, failover and analytics requests now fan out through workspace jobs with leases, per-workspace failure handling and ID-prefixed logs; member requests remain active-workspace-only. Three tests cover failed middle job, independent results, denied requests and internal route allowlisting. Connectors invoked by these jobs still need cache/credential isolation; do not enable them for customer workspaces.
- Removed retired nosterLogistics from active business configuration. Read-only inspection found zero legacy metric_points rows keyed to it; no stored data was deleted.
- Verification: typecheck and production build pass, build has no warnings. Final full Windows suite: 3,546 passed / 4 failed assertions, 327 passing / 7 failing files; all seven failures match the documented Windows baseline. New audit blocks app singleton/raw-store/test-fixture imports and retired seeder calls; it is NOT yet the complete route/connector isolation audit.
- Self-review: new tests prove cache A cannot serve B, ad watchlists/saves do not cross workspaces, path traversal fails, customized structure survives reseeding, and member job requests cannot fan out. The broader connector cache/file access surface remains unreviewed and incomplete, so no full isolation claim is made.
- Remaining: scope all listed connector caches, brain providers/retrieval/archive and other host-file readers; validate every page/API entry (including connector-only routes); finish background collection and long-lived request leases; harden malformed control metadata handling; expand full two-workspace API/data coverage. Seed/brain CLI scripts also still need explicit workspace targets.
- Real migration/rehearsal and two-workspace signed-in browser verification have not run. Local owner control database is not initialized; Noe needs first local sign-in. Preview remains running at localhost:4100: beta-authenticated sign-in 200, unauthenticated app redirect 307, agents API 401. Secrets were not printed or committed.

## Claude review of the 12:59 checkpoint (Oct 3, 3:00 PM CDT)
Pulled `m2-isolation` (`c3b7584`) into a Linux clone: typecheck clean,
334 files / 3,550 tests pass. Good checkpoint. The lease design (in-use
handles can't be evicted, saturation fails closed) is better than my
60-second suggestion; accepted.

One decision to close the biggest remaining hole cheaply:
- **Operator-only gate for connector routes until M3.** 31 API routes don't
  touch workspace data but read global env credentials (comms/email, brain,
  conductor, calls archive, oauth, admin/keys, connections/connect, social
  history/upload, adscout/mine, analytics refresh, life map, ventures,
  brand-deals, board tasks/agent run, skills, workflows/draft,
  funnel/lead-message). Add `requireOperatorWorkspace()` in `lib/session.ts`:
  passes only when the active workspace is the nosterCodes workspace (the one
  the migration created, recorded in control.db, kind `agency`, owner
  `NOSTEROS_OWNER_EMAIL`); otherwise 403 for APIs and an "Available after
  your connections are set up" empty state for pages. Use it on every route
  and page whose data comes from env-configured connectors or host files.
  The audit test should fail if a route reaches a connector without either
  `requireWorkspace` + workspace-scoped data or `requireOperatorWorkspace`.
  M3 replaces this gate route by route as connectors read per-workspace
  credentials. This lets M2 merge without waiting for every connector cache
  to be partitioned; caches only reachable through operator-gated routes
  can stay as they are until M3.
- `/api/auth/[...all]` stays public as before.

Merge `m2-isolation` once that gate, the remaining audit, the real-data
migration rehearsal (after Noe's first local sign-in) and the two-workspace
browser check are done. Railway project now exists but has no source; see
`docs/handoff/DEPLOY-railway.md`. Don't connect it; Claude will after merge.
