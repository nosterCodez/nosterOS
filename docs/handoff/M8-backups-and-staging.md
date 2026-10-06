# M8: Nightly backups and a staging copy

Status: Batch 1 partial; snapshot-policy decision and infrastructure approvals pending
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
- No plaintext backups, ever. No backups into the same volume as the only copy.
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
