import { expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { parseFinancialCsv } from '@/lib/financial-csv';
import { createFinancialImports } from '@/lib/financial-imports';
const csv = 'id,date,description,amount,currency\na,2026-10-01,"Sale, online",120.25,USD\nb,2026-10-02,Refund,-20.10,USD';
test('strict CSV preserves quoted fields and integer cents', () => {
  const result = parseFinancialCsv(csv, 'standard');
  expect(result.rows.map(r => r.amountCents)).toEqual([12025, -2010]);
  expect(result.rows[0].description).toBe('Sale, online');
});
test('invalid dates, money, headers and syntax reject the entire import', () => {
  for (const value of [csv.replace('2026-10-01', '2026-02-30'), csv.replace('120.25', '12.345'), csv.replace('currency', 'other'), csv + '\nc,2026-10-01,"unfinished,2,USD', csv.replace('120.25', '=1+2'), csv.replace('USD', 'JPY')]) {
    expect(() => parseFinancialCsv(value, 'standard')).toThrow();
  }
});
test('PayPal uses net and explicitly counts excluded non-completed rows', () => {
  const result = parseFinancialCsv('Transaction ID,Date,Name,Net,Currency,Status\np1,10/01/2026,Buyer,95.50,USD,Completed\np2,10/02/2026,Buyer,10,USD,Pending', 'paypal');
  expect(result.rows[0]).toMatchObject({ id: 'p1', date: '2026-10-01', amountCents: 9550 });
  expect(result.excluded).toBe(1);
});
test('BOM, quoted newlines and escaped quotes are accepted; duplicate IDs and excessive rows are rejected', () => {
  expect(parseFinancialCsv('\uFEFFid,date,description,amount,currency\nx,2026-10-01,"A ""quoted""\nitem",1.01,USD', 'standard').rows[0].description).toBe('A "quoted"\nitem');
  expect(() => parseFinancialCsv(csv + '\na,2026-10-01,Sale,1,USD', 'standard')).toThrow(/duplicate transaction/i);
  expect(() => parseFinancialCsv('id,date,description,amount,currency\n' + Array.from({ length: 2001 }, (_, i) => `${i},2026-10-01,Sale,1,USD`).join('\n'), 'standard')).toThrow(/2,000/);
});
test('currency summaries never combine or convert currencies', () => {
  const db = new Database(':memory:');
  try {
    const repo = createFinancialImports(db);
    repo.save('standard', 'shop', parseFinancialCsv(csv + '\nc,2026-10-03,Sale,500,MXN', 'standard').rows);
    expect(repo.summary()).toHaveLength(2);
    expect(repo.summary().find(r => r.currency === 'MXN')?.net).toBe(50000);
  } finally { db.close(); }
});
test('imports deduplicate by account and transaction, reject conflicts atomically and isolate databases', () => {
  const a = new Database(':memory:'), b = new Database(':memory:');
  try {
    const one = createFinancialImports(a), two = createFinancialImports(b), rows = parseFinancialCsv(csv, 'standard').rows;
    expect(one.save('standard', 'Checking', rows).inserted).toBe(2);
    expect(one.save('standard', 'checking', rows)).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(() => one.save('standard', 'Checking', [{ ...rows[0], id: 'new' }, { ...rows[1], amountCents: 1 }])).toThrow(/conflict/i);
    expect(one.summary()[0]).toMatchObject({ count: 2, incoming: 12025, outgoing: 2010, net: 10015, currency: 'USD' });
    expect(two.summary()).toEqual([]);
    expect(one.summary('2026-09')).toEqual([]);
  } finally { a.close(); b.close(); }
});
