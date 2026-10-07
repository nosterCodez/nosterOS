import fs from 'node:fs';
import ts from 'typescript';
import { expect, test, vi } from 'vitest';
import { appEntries, connectorDependency } from './connector-audit-helper';
import { apiOperatorWorkspace, operatorWorkspaceForPage } from '@/lib/session';

// Workspace-only credential access is exercised end-to-end in lead-plan-api.test.ts.
// The Places Portal import reads one platform token behind the stricter platform-owner gate
// (owner role + NOSTEROS_OWNER_EMAIL + bound operator workspace); covered by places-import-api.test.ts.
const workspaceRoutes = new Set(['app/api/leads/plan/route.ts', 'app/api/platform/places-import/route.ts']);
const entries = appEntries().filter(file => connectorDependency(file) && !workspaceRoutes.has(file));
// Platform-owner screens gate on platformOwnerForPage (owner role + owner email + operator workspace)
// and 404 everyone else, independent of NOSTEROS_OPERATOR_FEATURES (Claude review, Oct 7).
const platformOwnerPages = new Set(['app/settings/platform/page.tsx']);
const scopedDashboards = new Set(['app/page.tsx', 'app/analytics/page.tsx', 'app/finances/page.tsx', 'app/social/page.tsx']);
test('reviewed cloud adapters cannot fall back to operator credentials or host files', () => {
  for (const file of ['lib/cloud-adapters.ts', 'lib/cloud-oauth.ts']) {
    const source = fs.readFileSync(file, 'utf8');
    expect(source).not.toMatch(/operator-creds|node:fs|node:child_process|process\.env\.(?:STRIPE|INBOX|GMAIL|META_ACCESS)/);
    expect(source).toContain('VaultContext');
  }
});
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
        if (platformOwnerPages.has(file)) {
          expect(body[0], file).toContain('await platformOwnerForPage(');
          expect(body[1], file).toMatch(/if \(!\w+\) notFound\(\)/);
          continue;
        }
        if (scopedDashboards.has(file)) {
          expect(body[0], file).toContain("process.env.NOSTEROS_OPERATOR_FEATURES !== '1'");
          expect(body[0], file).toContain('return <WorkspaceDashboard');
          expect(body[1], file).toContain('await operatorWorkspaceForPage(');
          expect(body[2], file).toMatch(/if \(!\w+\) return <WorkspaceDashboard/);
          continue;
        }
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
    if (platformOwnerPages.has(file)) {
      // The fixture identity owns another workspace and is not the configured platform owner.
      await expect(page.default(), file).rejects.toMatchObject({ digest: expect.stringMatching(/404|NOT_FOUND/) });
      continue;
    }
    const result = await page.default({ params: Promise.resolve({ platform: 'instagram' }), searchParams: Promise.resolve({}) });
    expect(result.type.name, file).toBe(scopedDashboards.has(file) ? 'WorkspaceDashboard' : 'OperatorUnavailable');
  }
});
