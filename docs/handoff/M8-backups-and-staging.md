# M8: Nightly backups and a staging copy

Status: ready
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
- Status:
- Commits:
- Typecheck / tests / build:
- What Noe needs to approve or click:
- Restore drill result:
- What changed beyond the spec, and why:
- Questions or blockers for Claude:
