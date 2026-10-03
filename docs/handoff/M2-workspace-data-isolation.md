# M2: One data directory per workspace

Status: ready (after M1)
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
- Status:
- Commits:
- Typecheck / tests / build:
- Seed classification:
- Caches converted:
- Call sites changed:
- Migration results (dry run and real, on a copy):
- Self-review:
- Decisions you made beyond this spec, and why:
- Questions for Noe:
