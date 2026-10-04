import Database from 'better-sqlite3';
import { controlDbPath } from '@/lib/paths';

/** Only the offline migration writes this binding; organization APIs cannot. */
export function operatorWorkspaceId(): string | null {
  const owner = process.env.NOSTEROS_OWNER_EMAIL?.trim().toLowerCase();
  if (!owner) return null;
  let db: Database.Database | undefined;
  try {
    db = new Database(controlDbPath(), { readonly: true, fileMustExist: true });
    const row = db.prepare(`SELECT o.id, o.metadata FROM nosteros_operator b
      JOIN organization o ON o.id=b.organizationId
      JOIN user u ON u.id=b.ownerUserId
      JOIN member m ON m.organizationId=o.id AND m.userId=u.id
      WHERE b.id=1 AND lower(u.email)=? AND m.role='owner'`).get(owner) as { id: string; metadata: string } | undefined;
    if (!row || !/^[A-Za-z0-9]{32}$/.test(row.id) || JSON.parse(row.metadata).kind !== 'agency') return null;
    return row.id;
  } catch { return null; }
  finally { db?.close(); }
}
