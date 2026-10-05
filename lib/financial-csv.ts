import { z } from 'zod';
import { tokenizeCsv } from '@/lib/statements';

export const MAX_CSV_BYTES = 512 * 1024;
export const ImportFormat = z.enum(['standard', 'paypal']);
export type ImportFormat = z.infer<typeof ImportFormat>;
export const FinancialRow = z.object({
  id: z.string().trim().min(1).max(150),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d => !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d),
  description: z.string().trim().min(1).max(200),
  amountCents: z.number().int().min(-100_000_000_000).max(100_000_000_000),
  currency: z.enum(['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'MXN']),
}).strict();
export type FinancialRow = z.infer<typeof FinancialRow>;
export function parseFinancialCsv(text: string, format: ImportFormat) {
  ImportFormat.parse(format);
  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES) throw new Error('CSV exceeds 512 KiB.');
  const records = tokenizeCsv(text.replace(/^\uFEFF/, ''), true).filter(row => row.some(value => value.trim()));
  if (records.length < 2 || records.length > 2001) throw new Error('Choose a CSV with 1 to 2,000 transaction rows.');
  const headers = records[0].map(h => h.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate column names.');
  const fields = format === 'paypal' ? ['transaction id', 'date', 'name', 'net', 'currency', 'status'] : ['id', 'date', 'description', 'amount', 'currency'];
  if (fields.some(field => !headers.includes(field))) throw new Error(`Required columns: ${fields.join(', ')}.`);
  const rows: FinancialRow[] = []; let excluded = 0;
  const ids = new Set<string>();
  for (let index = 1; index < records.length; index++) {
    const record = records[index];
    const cell = (field: string) => record[headers.indexOf(field)]?.trim() ?? '';
    if (record.length !== headers.length) throw new Error(`Record ${index + 1}: column count does not match.`);
    if (format === 'paypal' && cell('status').toLowerCase() !== 'completed') { excluded++; continue; }
    let date = cell('date');
    if (format === 'paypal') {
      const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
      if (match) date = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    }
    const amount = cell(format === 'paypal' ? 'net' : 'amount');
    if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(amount)) throw new Error(`Record ${index + 1}: use signed amounts with at most two decimals.`);
    const [whole, fraction = ''] = amount.replace(/^-/, '').replaceAll(',', '').split('.');
    const cents = (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (amount.startsWith('-') ? -1 : 1);
    const parsed = FinancialRow.safeParse({ id: cell(fields[0]), date, description: cell(fields[2]) || (format === 'paypal' ? 'PayPal activity' : ''), amountCents: cents, currency: cell('currency').toUpperCase() });
    if (!parsed.success) throw new Error(`Record ${index + 1}: invalid ID, date, description, amount or unsupported currency.`);
    if (ids.has(parsed.data.id)) throw new Error(`Record ${index + 1}: duplicate transaction ID in file.`);
    ids.add(parsed.data.id); rows.push(parsed.data);
  }
  if (!rows.length) throw new Error('No completed transactions to import.');
  return { rows, excluded };
}
