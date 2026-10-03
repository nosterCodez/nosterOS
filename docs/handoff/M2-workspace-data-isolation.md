# M2: One data directory per workspace

Status: in progress on m2-isolation; not merged
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
- Migration results (dry run and real, on a copy): Not implemented or run. Original data files untouched. Owner email/account must be confirmed before running a real-data copy migration.
- Self-review: workspaceDir rejects all but Better Auth 1.7.7's default 32-character ASCII alphanumeric IDs before joining paths. Tests reject empty, traversal, absolute and wrong-length IDs. Separate workspace app/bank records remain separate; payment stores start empty. Session tests prove unauthenticated/missing-active/insufficient-role/mismatched-workspace requests never open a database. Full cache/route/fan-out security review remains pending until those conversions exist.
- Decisions you made beyond this spec, and why: Preserve existing shared callers during this foundation checkpoint rather than partially route real data into unmigrated workspace folders. Keep legacy PayKit behavior for existing callers/tests through an explicit seed parameter; new workspace stores disable it. Updated architecture to the directory-per-workspace and explicit-context decisions in this spec. Retained Next's auto-generated AGENTS instructions.
- Questions for Noe: Which email owns the nosterCodes workspace? It must be a real M1 account, not a test identity. Separate pending approval: generate private local auth/internal/beta secrets in .env.local. Until answered, browser verification used only temporary DATA_DIR and nonproduction fixture values, with SMTP/background jobs disabled and loopback binding.
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

## Report checkpoint: Oct 3, architect follow-up received
- Current implementation remains `c3b7584` plus the invitation-expiry correction in this commit; M2 is not merged or deployment-ready.
- Received the chat decision to add `requireOperatorWorkspace()` to connector/host-reading surfaces and defer connector-cache partitioning to M3. The requested "Claude review of the 12:59 checkpoint" section and its 31-route list are NOT in the local spec as of this checkpoint; requested a sync before implementing that boundary.
- Incoming local spec replaces the previous two checkpoint reports with an older foundation report. Preserved the incoming edits; authoritative prior implementation reports remain available in `git show c3b7584:docs/handoff/M2-workspace-data-isolation.md`. The older foundation report above does not describe the current code.
- Added `DEPLOY-railway.md` as supplied. Railway source, deployment, secrets, DNS and billing were not touched; Claude will connect source after merge.
- Investigated the Railway note: the actual Better Auth adapter stores invitation `expiresAt` as TEXT, confirmed through a real createInvitation integration test.
- Replaced SQLite's mixed-type expiry comparison with explicit parsing of adapter ISO timestamps and legacy millisecond timestamps; invalid, expired, boundary-time and non-pending invitations do not permit registration.
- Expanded allowlist tests for future/expired ISO text, malformed dates and legacy timestamps. Verification requests now use distinct fixture IPs so rate limits cannot masquerade as successful authorization rejections.
- Focused auth verification: 11/11 tests pass. Typecheck passes. Full Windows suite: 3,547 passed, 4 failed assertions; 327 passing files, 7 failing files, all matching the documented Windows baseline.
- Production build passes without warnings. No claims of completed operator gating, migration rehearsal or browser isolation checks are made.
- Checked the configured local data root without printing secrets: control.db is absent, so Noe's first local sign-in is still needed before the real-data migration rehearsal.
- Next: sync the missing architect review/route list; implement and test the operator boundary and complete audit; after owner sign-in perform copy migration rehearsal and two-workspace browser checks; only then merge. M3 has not started.
