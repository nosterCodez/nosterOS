import fs from 'node:fs';
import ts from 'typescript';
import { expect, test, vi } from 'vitest';
import { appEntries, connectorDependency } from './connector-audit-helper';
import { apiOperatorWorkspace, operatorWorkspaceForPage } from '@/lib/session';

const entries = appEntries().filter(file => connectorDependency(file));
test('host and connector entry points deny access before business logic', () => {
  expect(entries.length).toBeGreaterThan(60);
  for (const file of entries) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const handlers = source.statements.filter(ts.isFunctionDeclaration).filter(fn => fn.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
    for (const fn of handlers) {
      const body = fn.body?.statements.map(s => s.getText(source)) ?? [];
      if (file.endsWith('route.ts')) {
        if (body.some(s => /return workspaceJob\(/.test(s))) continue; // Covered by workspace-jobs security tests.
        expect(body[0], file).toContain('apiSessionError(');
        expect(body[1], file).toContain('if (authError) return authError');
        expect(body[2], file).toContain('await apiOperatorWorkspace(');
        expect(body[3], file).toContain('instanceof Response) return');
      } else {
        expect(body[0], file).toContain('await operatorWorkspaceForPage(');
        expect(body[1], file).toMatch(/if \(!\w+\) return <OperatorUnavailable/);
      }
    }
    expect(handlers.length, file).toBeGreaterThan(0);
  }
});

for (const file of entries.filter(file => file.endsWith('route.ts'))) {
  test(`denied operator cannot execute ${file}`, async () => {
    const denied = Response.json({ error: 'Unavailable' }, { status: 403 });
    vi.mocked(apiOperatorWorkspace).mockResolvedValue(denied);
    const fetcher = vi.fn(() => { throw new Error('Denied request reached fetch'); });
    vi.stubGlobal('fetch', fetcher);
    try {
      const route = await import(/* @vite-ignore */ `../${file}`);
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        if (typeof route[method] !== 'function') continue;
        const response = await route[method](new Request('http://localhost:4100/api/test', { method }), { params: Promise.resolve({ id: 'test', slug: 'test', provider: 'google', platform: 'instagram' }) });
        expect(response.status).toBe(403);
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
}

test('connector pages return the empty state for another workspace', async () => {
  vi.mocked(operatorWorkspaceForPage).mockResolvedValue(null);
  for (const file of entries.filter(file => file.endsWith('page.tsx'))) {
    const page = await import(/* @vite-ignore */ `../${file}`);
    const result = await page.default({ params: Promise.resolve({ platform: 'instagram' }), searchParams: Promise.resolve({}) });
    expect(result.type.name, file).toBe('OperatorUnavailable');
  }
});
