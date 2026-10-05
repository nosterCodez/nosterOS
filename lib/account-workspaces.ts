import type Database from 'better-sqlite3';

export function invitationIsCurrent(value: unknown, now = Date.now()): boolean {
  const expiry = value instanceof Date ? value.getTime() : typeof value === 'number' ? value
    : typeof value === 'string' && /^\d{13}$/.test(value) ? Number(value)
    : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
  return Number.isFinite(expiry) && expiry > now;
}
export function createAccountWorkspaces(db: Database.Database) {
  db.exec('CREATE TABLE IF NOT EXISTS omega_workspace_preferences(user_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL)');
  const memberships = (userId: string) => db.prepare('SELECT m.organizationId AS id FROM member m JOIN organization o ON o.id=m.organizationId WHERE m.userId=?').all(userId) as { id: string }[];
  return {
    initial(userId: string) {
      const allowed = memberships(userId);
      const saved = db.prepare('SELECT workspace_id AS id FROM omega_workspace_preferences WHERE user_id=?').get(userId) as { id: string } | undefined;
      return saved && allowed.some(w => w.id === saved.id) ? saved.id : allowed.length === 1 ? allowed[0].id : null;
    },
    remember(userId: string, id: unknown) {
      if (typeof id !== 'string' || !memberships(userId).some(w => w.id === id)) return;
      db.prepare('INSERT INTO omega_workspace_preferences(user_id,workspace_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET workspace_id=excluded.workspace_id').run(userId, id);
    },
    maySignIn(address: string) {
      const email = address.trim().toLowerCase();
      if (db.prepare('SELECT id FROM user WHERE lower(email)=?').get(email)) return true;
      const list = process.env.NOSTEROS_SIGNUP_ALLOWLIST;
      if (!list?.trim() && process.env.NODE_ENV !== 'production') return true;
      const allowed = (list ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (allowed.includes(email) || allowed.includes(email.slice(email.lastIndexOf('@')))) return true;
      const pending = db.prepare("SELECT expiresAt FROM invitation WHERE lower(email)=? AND status='pending'").all(email) as { expiresAt: unknown }[];
      return pending.some(row => invitationIsCurrent(row.expiresAt));
    },
  };
}
