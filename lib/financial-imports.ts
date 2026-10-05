import type Database from 'better-sqlite3';
import { z } from 'zod';
import { FinancialRow, ImportFormat } from '@/lib/financial-csv';
const Account = z.string().trim().min(1).max(80);
const Summary = z.object({ source: ImportFormat, account: z.string(), currency: z.string(), count: z.number().int(), incoming: z.number().int(), outgoing: z.number().int(), net: z.number().int(), start: z.string(), end: z.string(), importedAt: z.string() });
export type ImportSummary = z.infer<typeof Summary>;
export function createFinancialImports(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS financial_import_rows (
    source TEXT NOT NULL, account TEXT NOT NULL, id TEXT NOT NULL,
    date TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL, imported_at TEXT NOT NULL, PRIMARY KEY(source,account,id))`);
  return {
    save(source: ImportFormat, accountName: string, input: FinancialRow[]) {
      const account = Account.parse(accountName).toLowerCase(); ImportFormat.parse(source);
      const rows = z.array(FinancialRow).min(1).max(2000).parse(input);
      return db.transaction(() => {
        let inserted = 0, duplicates = 0;
        const at = new Date().toISOString();
        const count = db.prepare('SELECT COUNT(*) AS count FROM financial_import_rows').get() as { count: number };
        const get = db.prepare('SELECT date,description,amount_cents,currency FROM financial_import_rows WHERE source=? AND account=? AND id=?');
        const put = db.prepare('INSERT INTO financial_import_rows VALUES (?,?,?,?,?,?,?,?)');
        for (const row of rows) {
          const existing = get.get(source, account, row.id) as { date: string; description: string; amount_cents: number; currency: string } | undefined;
          if (existing) {
            if (existing.date !== row.date || existing.description !== row.description || existing.amount_cents !== row.amountCents || existing.currency !== row.currency) throw new Error('Transaction ID conflict: existing data differs. Nothing was imported.');
            duplicates++; continue;
          }
          if (count.count + inserted >= 50000) throw new Error('Workspace import limit reached (50,000 rows).');
          put.run(source, account, row.id, row.date, row.description, row.amountCents, row.currency, at); inserted++;
        }
        return { inserted, duplicates };
      }).immediate();
    },
    summary(month = ''): ImportSummary[] {
      if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid month.');
      return db.prepare(`SELECT source,account,currency,COUNT(*) AS count,
        SUM(CASE WHEN amount_cents>0 THEN amount_cents ELSE 0 END) AS incoming,
        SUM(CASE WHEN amount_cents<0 THEN -amount_cents ELSE 0 END) AS outgoing,
        SUM(amount_cents) AS net,MIN(date) AS start,MAX(date) AS end,MAX(imported_at) AS importedAt
        FROM financial_import_rows WHERE (?='' OR substr(date,1,7)=?) GROUP BY source,account,currency ORDER BY account,currency`).all(month, month).map(row => Summary.parse(row));
    },
  };
}
