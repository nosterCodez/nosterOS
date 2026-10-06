import Link from 'next/link';
import type { PlatformBackupStatus } from '@/lib/backup/status';

export function BackupWarning({ status }: { status: PlatformBackupStatus | null }) {
  if (!status) return null;
  return <aside className="my-4 border border-os-border p-4 text-sm" aria-label="Backup health">
    <p className={status.stale ? 'text-os-warn' : 'text-os-ok'}>
      {status.stale ? 'Backup warning: no successful backup within 36 hours.' : 'A verified backup was recorded within 36 hours.'}
    </p>
    <Link className="pressable mt-2 inline-block underline text-os-text" href="/settings/platform">View backup status</Link>
  </aside>;
}
export function BackupStatus({ status }: { status: PlatformBackupStatus }) {
  const last = status.lastSuccess;
  return <section aria-labelledby="backup-heading" className="border-t border-os-border py-6">
    <h2 id="backup-heading" className="text-lg font-semibold">Encrypted backups</h2>
    <BackupWarning status={status} />
    <dl className="grid grid-cols-1 gap-6 text-sm sm:grid-cols-2 xl:grid-cols-4">
      <div><dt className="text-os-muted">Last successful backup</dt><dd className="mt-2 break-words">{last?.finished_at ?? 'No successful backup recorded'}</dd></div>
      <div><dt className="text-os-muted">Archive size</dt><dd className="mt-2">{last?.bytes == null ? 'Unknown' : `${(last.bytes / 1024 / 1024).toFixed(2)} MiB`}</dd></div>
      <div><dt className="text-os-muted">Archives at last successful run</dt><dd className="mt-2">{status.archiveCount ?? 'Unknown'}</dd></div>
      <div><dt className="text-os-muted">Latest run</dt><dd className="mt-2">{status.latest?.status ?? 'Not run'}</dd></div>
    </dl>
    {status.lastError && <p className="mt-5 text-sm text-os-warn">Last recorded error: {status.lastError}</p>}
    {status.running && <p className="mt-5 text-sm text-os-muted">Run started {status.running.started_at}. Interrupted runs require operator review before releasing the lock.</p>}
    <p className="mt-5 text-xs text-os-muted">Schedule: daily after 08:00 UTC while the service is awake. Restore never overwrites live data.</p>
  </section>;
}
