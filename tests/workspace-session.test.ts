import { afterEach, expect, test, vi } from 'vitest';
vi.unmock('@/lib/session');
const mocks = vi.hoisted(() => ({ session: vi.fn(), member: vi.fn(), organization: vi.fn(), open: vi.fn(), lease: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuth: async () => ({ api: { getSession: mocks.session, getActiveMember: mocks.member, getFullOrganization: mocks.organization } }) }));
vi.mock('@/lib/workspace-storage', () => ({ openWorkspaceDb: mocks.open, withWorkspaceDb: mocks.lease }));
import { requireWorkspace, withWorkspaceLease } from '@/lib/session';
const h = new Headers({ cookie: 'better-auth.session_token=test' });
test('authorized context refreshes synchronous handles and leases asynchronous work by verified ID', async () => {
  const id = 'A'.repeat(32);
  mocks.session.mockResolvedValue({ user: { id: 'owner' }, session: { activeOrganizationId: id } });
  mocks.member.mockResolvedValue({ role: 'owner' });
  mocks.organization.mockResolvedValue({ id, name: 'A', metadata: { kind: 'agency' } });
  const context = await requireWorkspace('viewer', h, 'api');
  expect(mocks.open).not.toHaveBeenCalled();
  mocks.open.mockReturnValueOnce('first').mockReturnValueOnce('second');
  expect(context.db).toBe('first');
  expect(context.db).toBe('second');
  mocks.lease.mockImplementation(async (_id, work) => work('leased'));
  expect(await withWorkspaceLease(context, async db => db)).toBe('leased');
  expect(mocks.lease).toHaveBeenCalledWith(id, expect.any(Function));
});
afterEach(() => vi.resetAllMocks());
test('no session cannot open any workspace database', async () => {
  mocks.session.mockResolvedValue(null);
  await expect(requireWorkspace('viewer', h, 'api')).rejects.toMatchObject({ status: 401 });
  expect(mocks.open).not.toHaveBeenCalled();
});
test('page redirects keep safe destinations but reject external URLs', async () => {
  mocks.session.mockResolvedValue(null);
  for (const [destination, expected] of [['/brain', '/brain'], ['//evil.example', '/']]) {
    try {
      await requireWorkspace('viewer', new Headers({ ...Object.fromEntries(h), 'x-nosteros-path': destination }));
      throw new Error('Expected redirect');
    } catch (error) {
      expect((error as { digest: string }).digest).toContain(`/sign-in?next=${encodeURIComponent(expected)}`);
    }
  }
  expect(mocks.open).not.toHaveBeenCalled();
});
test('no active workspace returns API 403 without a fallback', async () => {
  mocks.session.mockResolvedValue({ session: {} });
  await expect(requireWorkspace('viewer', h, 'api')).rejects.toMatchObject({ status: 403 });
  expect(mocks.open).not.toHaveBeenCalled();
});
test('minimum role is checked before opening workspace storage', async () => {
  mocks.session.mockResolvedValue({ session: { activeOrganizationId: 'A'.repeat(32) } });
  mocks.member.mockResolvedValue({ role: 'viewer' });
  mocks.organization.mockResolvedValue({ id: 'A'.repeat(32), name: 'A', metadata: { kind: 'client' } });
  await expect(requireWorkspace('admin', h, 'api')).rejects.toMatchObject({ status: 403 });
  expect(mocks.open).not.toHaveBeenCalled();
});
test('workspace returned by auth must match the active session workspace', async () => {
  mocks.session.mockResolvedValue({ session: { activeOrganizationId: 'A'.repeat(32) } });
  mocks.member.mockResolvedValue({ role: 'owner' });
  mocks.organization.mockResolvedValue({ id: 'B'.repeat(32), name: 'B', metadata: { kind: 'agency' } });
  await expect(requireWorkspace('viewer', h, 'api')).rejects.toMatchObject({ status: 403 });
  expect(mocks.open).not.toHaveBeenCalled();
});
