import { z } from 'zod';
import { apiSessionError, requireWorkspace, withWorkspaceLease, SessionError } from '@/lib/session';
import { limitedBody } from '@/lib/connection-api';
import { ImportFormat, MAX_CSV_BYTES, parseFinancialCsv } from '@/lib/financial-csv';
const Input = z.object({ action: z.enum(['preview', 'save']), format: ImportFormat, account: z.string().trim().min(1).max(80), csv: z.string().min(1) }).strict();
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function financialImportRequest(request: Request) {
  const denied = await apiSessionError('/api/finances/imports', request.method, request); if (denied) return denied;
  try {
    const context = await requireWorkspace(request.method === 'GET' ? 'viewer' : 'admin', request.headers, 'api');
    if (request.headers.get('x-omegaos-workspace') !== context.workspace.id) return json({ error: 'Workspace changed. Reload this page.' }, 409);
    if (request.method === 'GET') {
      const month = new URL(request.url).searchParams.get('month') ?? '';
      if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: 'Invalid month.' }, 400);
      return withWorkspaceLease(context, db => json({ summaries: db.financialImports.summary(month) }));
    }
    const input = Input.parse(await limitedBody(request, MAX_CSV_BYTES * 2 + 4096));
    let parsed;
    try { parsed = parseFinancialCsv(input.csv, input.format); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid CSV.' }, 400); }
    const fresh = await requireWorkspace('admin', new Headers(request.headers), 'api');
    if (fresh.workspace.id !== context.workspace.id || fresh.user.id !== context.user.id) return json({ error: 'Workspace changed. Reload this page.' }, 409);
    if (input.action === 'preview') return json({ rows: parsed.rows.slice(0, 10), count: parsed.rows.length, excluded: parsed.excluded });
    return withWorkspaceLease(fresh, db => {
      try { return json({ ...db.financialImports.save(input.format, input.account, parsed.rows), excluded: parsed.excluded, summaries: db.financialImports.summary() }); }
      catch (error) {
        const known = error instanceof Error && /^(Transaction ID conflict:|Workspace import limit)/.test(error.message);
        return json({ error: known ? error.message : 'Unable to save import. Nothing was imported.' }, 409);
      }
    });
  } catch (error) {
    if (error instanceof SessionError) return json({ error: error.message }, error.status);
    return json({ error: 'Invalid import request. Check the file size and fields.' }, 400);
  }
}
