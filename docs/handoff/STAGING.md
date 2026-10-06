# Staging and backup runbook

Status: Batch 1 implementation checkpoint; no staging environment or backup bucket
has been created. No live backup or restore has been run. Online snapshots, encrypted
archive/storage, runner/lock/status, scheduling, retention and CLI restore are
implemented and pass fixture tests. The owner panel still needs its existing
operator-feature gate: two connector-boundary assertions fail until that is resolved.
Noe approved private temporary snapshots in chat, followed by immediate encryption
and cleanup. Do not rely on this branch in production before review and staging.
The instructions below are a setup checklist, not a claim these resources exist.

## Approval and cost checkpoint

Checked October 5, 2026 against https://railway.com/pricing:
- Object storage: $0.015 per GB-month; bucket operations and bucket egress free.
  Eleven 60.5 MB archives would occupy about 0.666 GB, roughly $0.01/month.
  This is an estimate before compression, not a measured archive or price guarantee.
- Volume: $0.00000006 per GB-second. Budgeting 0.5 GB for a 30-day month is
  about $0.078/month. CPU: $0.00000772 per vCPU-second; RAM: $0.00000386 per
  GB-second. Service egress: $0.05/GB. Hobby has a $5 monthly minimum with
  $5 usage included; added usage may increase the account bill above that.
- Example staging estimate: 20 awake hours/month averaging 0.25 GB RAM and
  0.05 vCPU costs about $0.10 compute plus $0.078 volume, excluding egress.
  Always awake at those averages would instead be about $3.58/month including
  volume. Actual usage determines the bill; do not approve a fixed price from this example.
- https://docs.railway.com/deployments/serverless says outbound traffic can
  prevent sleeping. Existing ticks and collectors must be considered. Keep
  staged connectors/automatic collection off unless deliberately testing them;
  consider disabling existing warmup/cron/failover timers on staging via approved
  configuration. Sleeping also means in-process jobs do not run until awake.
- Noe must approve bucket, staging environment/volume, and the cost allowance
  before provisioning. Preserve the existing $8 alert / $10 hard limit; never
  raise limits automatically. Recheck actual usage after the first staging session.

## Setup checklist (Noe or explicitly authorized operator)

1. Complete Step 1A and obtain Claude's data-safety review before relying on backups.
2. Approve a Railway backup bucket, then create it in the existing project.
   Configure distinct production and staging archive namespaces; never share a prune prefix.
3. Approve a separate staging environment/service and its own small /data volume.
   Do not clone the production volume or copy production credentials into staging.
4. Set branch staging as that service's source, enable sleeping, keep the beta
   access wall and restricted signup. Do not change production's source branch.
5. Set the environment label to staging and turn the outbound-disable flag on.
   Use fresh auth, internal, access, vault and backup secrets, not production values.
6. Store the backup key and vault recovery key separately in a password manager;
   archives cannot replace these keys. Keep secret values out of chat, git and reports.
7. Set the staging canonical origin to https://staging.os.noepenaa.com. Noe adds
   the GoDaddy staging.os CNAME to the exact domain Railway supplies. Do not guess it.
8. Configure only an approved sending-only system mail credential. Sign-in and
   invitations are the only email exemptions; a real test email still needs Noe's approval.
9. Add staging callbacks to Google/Meta/Etsy only when needed for connector testing
   and approved; preserve the existing production callback URLs.

## Variable names (no credentials)

Implemented staging controls: `OMEGA_ENV`, `OMEGA_OUTBOUND_DISABLED`.
Backup encryption: `OMEGA_BACKUP_KEY`.
Store configuration: `OMEGA_BACKUP_S3_ENDPOINT`, `OMEGA_BACKUP_S3_BUCKET`,
`OMEGA_BACKUP_S3_ACCESS_KEY_ID`, `OMEGA_BACKUP_S3_SECRET_ACCESS_KEY`,
`OMEGA_BACKUP_S3_REGION`. Object namespaces are production/, staging/, development/,
derived from the server-side OMEGA_ENV value, never a visitor-supplied prefix.
Commit identity: `RAILWAY_GIT_COMMIT_SHA`, with `OMEGA_BACKUP_APP_COMMIT` fallback.
Existing isolation/auth: `DATA_DIR`, `NOSTEROS_BASE_URL`, `BETTER_AUTH_SECRET`,
`NOSTEROS_MASTER_KEY`, `NOSTEROS_INTERNAL_SECRET`, `NOSTEROS_ACCESS_TOKEN`,
`NOSTEROS_OWNER_EMAIL`, `NOSTEROS_SIGNUP_ALLOWLIST`, `NOSTEROS_OPERATOR_FEATURES`.
System mail: `RESEND_API_KEY`, `SYSTEM_MAIL_FROM`, or the existing SMTP variables.
Existing optional idle controls: `FOUNDER_OS_SKIP_WARMUP`,
`FOUNDER_OS_DISABLE_CRON`, `FOUNDER_OS_DISABLE_FAILOVER`, `NEXT_TELEMETRY_DISABLED`.
Never copy production environment exports into staging wholesale.

## Smoke checks and promotion

After provisioning and completing the batch: push reviewed batch branch, merge
into staging, confirm Railway SUCCESS and record deployment ID. Verify the
private sign-in gate, STAGING badge, independent workspace data, and every mocked
message refusal; confirm fixed auth emails only with approval. Run full checks.
Do not treat a staging deployment as approval to deploy main. After Noe's explicit
yes: fast-forward main to the reviewed commit, push, verify Railway SUCCESS and
the expected public private-beta 401 page; record commit and deployment ID.

## Backup and restore commands (live drill pending)

The fixture-only CLI drill passes: online SQLite snapshot, encrypted local store,
restore to a new directory, identical rows and integrity checks. No real data was used.
After deployment and resource approval, run backup:now, verify uploaded encrypted archive
and manifest, then run backup:restore with the archive name and a new scratch
directory outside the live data path. The restore must reject an existing target,
validate hashes and PRAGMA integrity_check for every database, and leave production
untouched. Record archive identity, DB count and integrity results only, not rows
or secrets. A staging scratch restore must not be served as staging workspace data.
Never overwrite /data or activate a restored copy without separate Noe approval.
Retain original vault keys securely for future recovery; generating a new vault
key will not decrypt restored workspace connections. Do not import a production
vault key into staging's running app. Scratch cleanup also requires approval.

Commands (never put keys in command arguments):
```sh
npm run backup:now
npm run backup:restore -- --archive omegaos-YYYY-MM-DD-abcdefgh.tar.gz --to /scratch/new-restore
```
Use an actual archive name from the status record or bucket, not the placeholder.
For development fixtures only, both commands accept `--local-dir <existing-directory>`;
OMEGA_ENV must be development and the destination must be outside DATA_DIR. The
automated CLI test uses a temporary cwd, synthetic key and databases; it does not
load the real project's .env.local. Normal manual CLI use loads .env.local if present.

The tick starts after 08:00 UTC and records at most one attempt per UTC date. A failed
attempt is visible and the next scheduled attempt is the next day. Uploads are never
overwritten. Interrupted runs retain the unique running-row lock; no unsafe automatic
timeout takeover occurs. Stop all backup runners before an explicitly approved operator
marks an abandoned run failed. A restored control.db contains the snapshot's running
row and requires the same reviewed recovery step before backups are re-enabled.

Temporary snapshots are private generated children of the OS temp directory, outside
the live data tree. They are deleted after reading and in finally cleanup on errors;
they are not an independent recovery copy. Abrupt process/host termination can prevent
finally cleanup. Review leftover omega-snapshot-* directories after an interruption;
never bulk-delete temp paths or promise cryptographic secure erasure. Persisted archives
are encrypted. The live database stays WAL; only the isolated snapshot uses DELETE
journal mode for self-contained restore validation. Databases are individually consistent,
not a single atomic transaction across all workspace files. Inventory changes abort a run.

## Sender audit

- Comms SMTP: lib/connectors/email.ts -> lib/mail-guard.mjs -> central guard.
- Comms Slack: lib/connectors/slack.ts -> central guard before SDK construction.
- Social DMs: lib/connectors/manychat.ts -> central guard before sendContent.
- Social post publishing/scheduling: lib/connectors/zernio.ts -> central guard.
- Calendar invite updates: lib/connectors/gcal-write.ts -> central guard for
  notification modes; non-notifying calendar updates retain existing behavior.
- System mail: lib/system-mail.ts validates only magic-link/workspace-invitation
  templates and origin before sending via Resend/SMTP; exempt as M8 specifies.
- Invoice/payment/DocuSign integrations currently read reports/envelopes; no
  invoice-send path found. No new invoice sender was invented.
- Paperclip issue/comment actions target the internal agent board, not a direct
  customer email/DM sender. Any future external delivery path must use the guard.
- Browser mailto/WhatsApp links hand off to the user's client; they do not send
  through the server. The flag is not an OS-wide firewall or external agent sandbox.
