# M8: Nightly backups and a staging copy

Status: Batch 1 code deployed to production with Noe's waiver; backups inactive; infrastructure/drills pending
Review by Claude: yes (data safety, secrets)
Queue position: 1 of the lead-gen program (M8 → M9 → M10 → M11 → M12)

## Goal
Before clients rely on OmegaOS, make sure no single mistake, bad deploy, or
volume failure can lose workspace data. Add encrypted nightly backups with a
tested restore, and a staging environment where every risky change runs
before production.

## Context
- All data is SQLite on a 500 MB Railway volume at `/data`:
  `control.db` plus `workspaces/<id>/*.db`. Today there is no copy anywhere else.
- Workspace credentials are already envelope-encrypted (M3), and the key-encryption
  key lives only in Railway env. Backups must never contain that key.
- Budget: Railway alert $8, hard limit $10. Anything that adds recurring cost
  needs Noe's approval before it is created (see Stop rules).

## Decisions already made
1. **Method:** better-sqlite3 `db.backup(dest)` (online backup API). Never
   copy live `.db` files with `fs.copyFile`; WAL makes that unsafe.
2. **Archive:** one nightly archive `omegaos-<UTC date>-<shortsha>.tar.gz`
   holding every database plus `manifest.json` (file list, sizes, SHA-256s,
   schema versions, app commit). The archive is encrypted with AES-256-GCM
   using `OMEGA_BACKUP_KEY` (32 random bytes, base64). Format: `OBK1` magic,
   12-byte IV, ciphertext, 16-byte tag. `OMEGA_BACKUP_KEY` must differ from
   every other secret. Missing key = backups refuse to run, loudly.
3. **Destination:** an S3-compatible bucket through a small `BackupStore`
   interface (`put`, `list`, `get`, `delete`), configured with
   `OMEGA_BACKUP_S3_ENDPOINT`, `_BUCKET`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`,
   `_REGION`. First choice is a Railway bucket in the same project. Include a
   `LocalDirBackupStore` used only in tests and dev.
4. **Schedule:** the existing internal tick runs the backup once per UTC day
   after 08:00 UTC (≈3 AM Central). Use a lock row so two instances can't
   run it at once.
5. **Retention:** keep 7 daily and 4 weekly (Sunday) archives; prune others
   only after the new archive's upload is verified (re-download the manifest
   and compare hashes).
6. **Restore:** `npm run backup:restore -- --archive <name> --to <dir>`
   decrypts, verifies every SHA-256, runs `PRAGMA integrity_check`, and writes
   into a new directory. It never overwrites `/data` directly. Swapping a
   restored copy into production is a manual, Noe-approved step documented in
   `docs/handoff/DEPLOY-railway.md`.
7. **Visibility:** the owner-only platform panel shows last backup time,
   size, archive count, and last error. A failed or missing backup for more
   than 36 hours shows a warning on `/doctor`.
8. **Staging:** a Railway environment named `staging` in the same project,
   deploying branch `staging`, with its own volume, its own
   `BETTER_AUTH_SECRET`, its own vault key, and its own backup prefix
   (`staging/`). Domain `staging.os.noepenaa.com` (CNAME, Noe adds it in GoDaddy).
   Staging sets `OMEGA_OUTBOUND_DISABLED=1` (new flag) which makes every
   outbound-message path (system mail excepted, so sign-in still works) refuse
   with a clear error, and `OMEGA_ENV=staging`, which shows a yellow "STAGING"
   strip in the Topbar. Enable Railway app sleeping on staging to keep cost near zero.
9. **Flow from now on:** feature branch → `staging` (Astra deploys freely, no
   approval needed) → Noe/Claude check → `main` (still needs Noe's explicit yes).

## Do
1. `lib/backup/` with `archive.ts` (snapshot + manifest + encrypt/decrypt),
   `store.ts` (interface, S3 store using `@aws-sdk/client-s3`, local store),
   `run.ts` (lock, snapshot all DBs, upload, verify, prune, record status),
   `restore.ts`. Adding `@aws-sdk/client-s3` is approved.
2. Status table `backup_runs` in `control.db` (id, started_at, finished_at,
   status, archive_name, bytes, error_code, error_message masked to 200 chars).
3. Wire into the internal tick; add `npm run backup:now` and `npm run backup:restore`.
4. Owner-only panel section and `/doctor` check.
5. `OMEGA_OUTBOUND_DISABLED` and `OMEGA_ENV` handling, with the Topbar strip.
6. Write `docs/handoff/STAGING.md`: how to deploy to staging, how to promote,
   how to restore, and the env var list (names only, never values).
7. `.env.example`: every new variable with a one-line comment.
8. Tests: round-trip (snapshot → encrypt → decrypt → identical rows); wrong
   key fails; tampered byte fails the GCM tag; manifest hash mismatch fails
   restore; retention keeps exactly 7 daily + 4 weekly; prune never runs when
   upload verification fails; lock prevents double runs; backup refuses
   without `OMEGA_BACKUP_KEY`; archive never contains env values (grep the
   tarball for the vault key in a test); outbound paths refuse when
   `OMEGA_OUTBOUND_DISABLED=1`.

## Stop rules (hand back to Noe through the Report)
- Creating the Railway bucket, the staging environment, or its volume adds
  cost. Prepare everything in code, then list exactly what Noe needs to click
  or approve. Don't create paid resources yourself.
- Generating `OMEGA_BACKUP_KEY` and setting variables: Noe does it or
  explicitly approves it. Remind Noe to also save the backup key in his
  password manager; without it the backups are unreadable.

## Don't
- No stored/uploaded plaintext backups. Noe approved a narrow exception on Oct 5
  ("alright, continue" in reply to the temporary-snapshot question): private SQLite
  temporary files outside the live data tree, immediate encryption and cleanup.
  No backups into the same volume as the only recovery copy.
- Don't log keys, bucket credentials, or archive contents.
- Don't change the production deploy flow beyond adding staging.

## Done when
- typecheck, tests (minus the Windows baseline), build pass.
- In dev with `LocalDirBackupStore`: `backup:now` produces an archive;
  `backup:restore` reproduces every DB with passing integrity checks.
- After Noe approves resources: one real production backup visible in the
  panel, and a restore drill into a scratch directory on staging recorded below.

## Report (Astra fills this in)

### Batch 1 report: October 5, 2026, 19:44 CDT
- Steps: 1A encrypted backups + restore = PARTIAL / BLOCKED (snapshot exception
  below); 1B staging support = code done, infrastructure and browser smoke pending.
- Branch / last implementation commit: `lg/b1-backups-staging` @ `1d88b36`;
  backup foundations `bdec969`. Based on Batch 0 docs as the plan explicitly requires.
  Report/config commit follows. No main push or production deployment.
- Implemented: independent backup-key validation; OBK1 AES-256-GCM encryption;
  tar.gz manifest with database paths, sizes, SHA-256, schema versions and commit;
  bounded parsing with no arbitrary path extraction, links or duplicate entries;
  encrypted local-development and S3 stores, environment namespaces, bounded reads,
  request timeout, paginated listings and conditional no-overwrite uploads;
  seven daily plus four older Sunday retention selection; scratch-only restore
  with hashes and SQLite integrity checks before filesystem writes.
- Not implemented: online SQLite snapshot creation; backup_runs migration/repo and
  lock; upload verification orchestration/pruning; tick schedule; backup CLI;
  owner platform panel and doctor freshness warning. No live backup exists.
- BLOCKED: M8 requires db.backup(dest), which writes a temporary plaintext SQLite
  snapshot, but also says "No plaintext backups, ever." Asked Noe to approve
  private temporary snapshots outside the live data volume, immediate encryption,
  and cleanup. No answer yet; no exception assumed and no snapshot code written.
  Claude should confirm the exception and cleanup expectations before that resumes.
- Typecheck clean. Full suite: 382 files, 375 passed / 7 failed; 3,945 tests,
  3,941 passed / 4 failed. Same Windows baseline as Batch 0: interaction-layer
  (BrainCore path, not these buttons), paths, skills-plugins, superset-dispatch;
  EPERM cleanup suites lead-magnet-actions, lead-magnets-route, roadmap-mock-5h.
  New tests: 20/20 in six files. Existing assertions were not changed.
- Build passes using `.next-lg-b1-final`, isolated DATA_DIR and disabled background
  ticks. An earlier attempt hit Turbopack's internal Google font query resolution;
  a fresh dist directory passed, and the final post-dependency build also passed.
  Generated tsconfig includes removed; shared dev server 4100 left untouched.
- Audit: production dependencies 0 advisories. Full npm audit reports 10 in
  existing development tooling (3 moderate, 6 high, 1 critical); no unrelated
  dependency upgrades made. Vitest UI server was not started.
- Staging: not deployed; no environment, bucket, volume, DNS, variable, key or
  real message changes. Badge tested by server rendering, not a browser screenshot.
- Restore test: fixture SQLite row recovered with integrity_check=ok; wrong key,
  malformed database, path/hash mismatches, existing target and live-data target
  rejected. This is NOT the required db.backup -> upload -> restore drill.
- Sender audit: SMTP replies/mail-guard, Slack, ManyChat, Zernio publishing and
  Google Calendar notification modes all call the central guard before sending.
  Fixed validated magic-link/workspace-invitation mail remains exempt. No invoice
  sender exists; read-only invoice integrations unchanged. Paperclip internal
  board actions and browser mailto/WhatsApp handoffs are not server mail senders.
  Full list and boundaries: STAGING.md. Injected connector env cannot lift host ban.
- Noe actions needed, in order:
  1. Resolve temporary snapshot exception above (question already shown in chat).
  2. Approve Railway backup bucket: $0.015/GB-month; about $0.01/month for eleven
     60.5 MB archives, estimated, not a measured bill. No provisioning yet.
  3. Approve staging environment/0.5 GB volume and compute allowance: volume about
     $0.078/month; example compute+volume about $0.18/month at 20 awake hours or
     $3.58/month always awake at 0.25 GB RAM/0.05 vCPU, excluding egress. Actual
     usage is metered; current $8 alert/$10 cap remain. Sleeping is not guaranteed
     when background polling creates outbound traffic. Rates and sources in STAGING.md.
  4. Approve fresh backup/auth/vault/internal/beta secrets and environment variables;
     retain backup/vault recovery keys in a password manager. No values generated.
  5. Add staging.os DNS to Railway's assigned domain; optional approved connector
     callbacks and system-mail setup. Never clone production credentials/data.
  6. After completion/review/staging checks, explicitly approve main/production.
- Decisions beyond spec: Noe approved tar-stream and its types in chat ("bet i
  approve it"); AWS SDK already approved in M8. Shared guard uses a .mjs module
  re-exported from .ts so plain-Node mail scripts use the exact same policy.
  `.env.example` contains blank placeholders only: M8's explicit requirement wins
  over the plan's general prohibition on committing .env* files.
- Self-review: no new routes/tables/AI calls; no secrets/raw SQL added to pages;
  storage endpoint is administrator configuration, HTTPS only; bounded responses,
  timeouts, no raw provider errors logged. Namespace prevents cross-environment
  pruning. No archive files written by tests except disposable encrypted fixtures
  and explicit restore fixtures. Unrelated handoff edits preserved.
- Risks for Claude: archive packing is buffered, so peak memory must be measured
  before the full-volume production drill. Retention chooses seven dates plus four
  older Sundays; deletion is not wired yet. No Linux rerun performed this session.
- Ready for production? NO. Stop here; continue Batch 1 after the decision above.
  Batch 2 has not started. Logs are under ignored `.local/lg-b1-*` paths.

### Batch 1 continuation report: October 5, 2026, 20:07 CDT
- Steps: 1A runtime/CLI = implemented and fixture-tested; owner UI = checkpoint,
  BLOCKED on operator gate review; 1B code = implemented, live staging pending.
- Branch: `lg/b1-backups-staging`; runtime `f34f7be`, UI checkpoint `636a485`;
  documentation commit follows. No main/production push and no Batch 2 work.
- Noe resolved the temporary snapshot exception in chat. db.backup now creates
  private generated scratch files outside live data; source databases remain WAL,
  temporary copies switch to DELETE journal mode for self-contained validation.
  Files are removed after reading, and the generated directory in finally cleanup.
  Abrupt process termination remains an explicit cleanup caveat, documented in STAGING.
- Added idempotent backup_runs table/repo/Zod validation with a partial unique
  running-row index and BEGIN IMMEDIATE claim. One attempt per UTC date; a crashed
  runner keeps its lock for reviewed manual recovery, never an unsafe auto-takeover.
  archive_count is stored with the successful run for offline status display.
- Runner verifies a re-downloaded/decrypted manifest and every file hash before
  pruning. Upload/verification failures never prune. Fixture pruning retains seven
  daily dates plus four older Sundays. Error messages are constants, not provider text.
- Internal cron tick schedules after 08:00 UTC and checks configuration safely;
  unconfigured/failing service gets one generic warning per UTC day per process.
  Cron loopback timeout is 120 seconds (others stay 20); auth boundaries unchanged.
- backup:now and backup:restore commands added. Local store requires development
  mode and a destination outside live data. Fixture CLI runs from a disposable cwd
  with synthetic credentials, avoiding the real .env.local. No cloud calls or sends.
- Fixture drill PASS: online snapshot -> encrypted local store -> CLI restore ->
  identical rows and integrity_check=ok. Missing/wrong keys, invalid DB, hash/path
  tampering, existing/live target, overlapping lock and failed upload are covered.
  Full production-size memory/load measurement and real S3 restore drill remain pending.
- Typecheck PASS. Build PASS using .next-lg-b1-complete, isolated build data and
  disabled timers, before the final Doctor guard-order correction and smoke-list entry.
  Generated tsconfig includes removed. Shared dev server 4100 left running untouched.
- Focused backup/staging tests: 33/33 passed, followed by the additional cron-timeout
  regression and unchanged internal-tick auth tests (8/8). No real messages used.
- Last full suite: 386 files, 377 passed / 9 failed; 3,959 tests, 3,952 passed /
  7 failed. Baseline: interaction-layer BrainCore path, paths, skills-plugins,
  superset-dispatch; EPERM cleanup suites lead-magnet-actions, lead-magnets-route,
  roadmap-mock-5h. New failures were Doctor guard order (2 assertions) and missing
  platform page in the smoke registry (1). Doctor and smoke-list fixed in code;
  assertions unchanged, new page added to coverage. Focused rerun: smoke 34/34,
  backup-status 2/2, connector-boundaries 59/61; the two remaining failures now
  correctly identify the new platform page missing the shared operator gate.
- Stop rule reached: second failed connector-boundary pass. Proposed exact fix,
  awaiting Noe/Claude approval: begin PlatformPage with operatorWorkspaceForPage
  and OperatorUnavailable, then retain platformBackupStatus's additional bound
  operator-owner/email check. This makes it unavailable with operator features off.
  Do not weaken connector-boundaries assertions. New page currently protects owner
  identity/membership but does not yet enforce the global operator feature flag.
- Owner panel draft shows last success/time/size, archive count at last success,
  latest run, last fixed error and interrupted-lock notice. Doctor's warning keeps
  its existing operator entry gate. No browser smoke of authenticated UI performed.
- Self-review: no raw SQL in pages/routes, no new public API or broader internal
  header path, no plaintext keys/logs, no unrelated file edits. Archive parsing and
  store boundaries retained. Data inventory refuses symlinks, unsupported DB paths,
  changing file inventory and usage above 400 MB (80% of the documented 500 MB cap).
- Noe actions: 1. Resolve the exact operator gate decision above. 2. Approve bucket
  and staging cost allowance from STAGING.md (previous report's rates unchanged).
  3. Approve separate secrets/variables and retain recovery keys in a password manager.
  4. Set staging DNS and optional approved callbacks/system mail. 5. Only after green
  tests, review and staging drill, separately approve main/production.
- Staging: NOT deployed; no bucket/environment/volume/DNS/key/variable changes.
  Restore promotion and abandoned-lock procedure documented, not executed.
- Ready for production? NO. Preserve this checkpoint for review; remain in Batch 1.

### Batch 1 code-completion report: October 5, 2026, 20:14 CDT
- Steps: 1A encrypted backups/restore = code complete, fixture drill passed;
  1B staging support = code complete. Live infrastructure and drills remain blocked.
- Branch / last implementation commit: `lg/b1-backups-staging` @ `c2468aa`;
  report commit follows. Batch 2 has not started.
- Noe's continuation approved the proposed gate fix. PlatformPage now applies
  operatorWorkspaceForPage before the additional bound-operator owner/email check.
  Regression test proves a disabled gate prevents owner/context and database reads.
  Existing connector-boundary assertions were not changed or weakened.
- Typecheck PASS. Focused backup-status/connector-boundaries/smoke: 98/98 PASS.
  All 35 new backup/staging tests pass. Full suite: 386 files, 379 passed / 7 failed;
  3,961 tests, 3,957 passed / 4 failed. Only documented Windows baseline failures:
  interaction-layer (BrainCore backslash path), paths, skills-plugins,
  superset-dispatch; EPERM cleanup lead-magnet-actions, lead-magnets-route,
  roadmap-mock-5h. Linux review has not been run by this session.
- Build PASS with isolated .next-lg-b1-verified and .local/lg-b1-build-data;
  generated tsconfig includes removed; shared server 4100 untouched. Logs remain
  ignored under .local/lg-b1-verified-*.txt. No test/build session left running.
- Staging: NOT deployed. No cloud bucket, environment, volume, key, variable or
  DNS changes; no production backup, S3 drill or authenticated browser smoke yet.
- Noe actions needed: 1. Approve backup bucket and staging environment/volume
  costs from STAGING.md (bucket roughly $0.01/month at the example size; staging
  roughly $0.18/month for the example 20 awake hours or $3.58 always awake,
  excluding egress; actual usage is metered, not a guaranteed fixed price).
  2. Approve separate secrets/variables and retain recovery keys privately.
  3. Configure staging DNS and optional approved callbacks/system mail.
  4. After Claude review and staging checks, explicitly approve main/production.
- Decisions beyond spec: only the previously approved private temporary snapshot
  exception and dependencies; this continuation restores the established operator
  gate rather than introducing another authorization policy.
- Self-review: no secret values, raw provider error logs or SQL in pages/routes;
  no new public write endpoint or expanded internal-header permission. Owner gate
  is additive; shared backup_runs is explicitly specified. Storage uses a bounded
  HTTPS administrator endpoint; no AI calls or real messages. Unrelated files preserved.
- Risks for Claude: buffered archive peak memory still needs production-size
  measurement; databases are individually consistent, not atomically snapshotted
  together. Crash scratch cleanup and running-lock recovery require the documented
  manual review. Review data safety before deployment; fixture tests are not a live drill.
- Ready for production? NO. Batch 1 code is ready for review; infrastructure and
  live acceptance remain pending. STOP here until Noe continues; no Batch 2 work.

### Code-only deployment authorization: October 5, 2026, 20:22 CDT
- Noe explicitly superseded the hold: "actully no deploy it , i waive it".
- Scope: waive review/staging gates and deploy existing tested Batch 0/1 code;
  no approval inferred for paid resources, backup keys, variables, DNS or live drills.
- Read-only Railway check confirms production follows main, no staged changes,
  and no OMEGA_BACKUP_* configuration. Backups will remain inactive after deploy.
- Code verification is unchanged from the 20:14 report; deployment outcome pending.

### Production deployment result: October 5, 2026, 20:25 CDT
- Main fast-forwarded and pushed to `dec9a9da5384c3fbc3a19aa2a6c1003d244cbb4d`.
- Railway deployment `655eadf8-ac73-4dce-8d3d-f46a69536201` SUCCESS at
  2026-10-06T01:24:44.239Z; service nosteros-web, production, branch main.
- Railway build passed; runtime reports Next ready in 103ms; initial log sample
  has no startup error. This is a startup check, not extended runtime monitoring.
- Anonymous HTTPS GET / and /settings/platform both returned HTTP 401 and
  title "OmegaOS - Private" (site uses a middle-dot separator), as expected.
  Private beta gate remains intact. No authenticated owner-panel smoke performed.
- No Railway variables, secrets, resources, DNS, spending limits or credentials
  changed. Backup variables absent before deploy; no cloud backup/drill performed.
- M8 merge prerequisite for M9 is now satisfied. Batch 2 implementation remains
  unstarted; global spending coordination still needs Claude's decision per M10.
- This result is committed/pushed on the batch branch only to avoid a redundant
  production deployment. Main stays at dec9a9d; unrelated dirty docs preserved.
