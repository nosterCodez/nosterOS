import { vi } from 'vitest';

vi.mock('@/lib/workspace-jobs', () => ({
  workspaceJob: async (_route: string, work: (context: unknown) => Promise<unknown>) => {
    const context = await (await import('@/lib/session')).apiOperatorWorkspace();
    if (context instanceof Response) return context;
    return Response.json(await work(context));
  },
}));

// Existing route unit tests exercise business logic with an authorized caller.
// Security suites explicitly unmock this module and exercise the real boundary.
vi.mock('@/lib/session', () => {
  const workspace = async () => {
    const { getDb } = await import('@/tests/fixture-db');
    return ({
    user: { id: 'test', name: 'Test', email: 'test@example.com' },
    workspace: { id: 'T'.repeat(32), name: 'Test', kind: 'agency' }, role: 'owner',
    get db() { return getDb(); },
  });
  };
  return { apiSessionError: vi.fn(async () => null), apiWorkspace: vi.fn(workspace), requireWorkspace: vi.fn(workspace), apiOperatorWorkspace: vi.fn(workspace), operatorWorkspaceForPage: vi.fn(workspace), requireOperatorWorkspace: vi.fn(workspace) };
});
