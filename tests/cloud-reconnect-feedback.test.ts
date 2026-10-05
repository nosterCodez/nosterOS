import { expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import IntegrationsPage from '@/app/integrations/page';
vi.mock('@/lib/session', () => ({ requireWorkspace: async () => ({ role: 'owner', workspace: { id: 'A'.repeat(32), name: 'Fixture' } }), withWorkspaceLease: async (_ctx: unknown, work: (db: object) => unknown) => work({}) }));
vi.mock('@/lib/creds', () => ({ connectionMetadata: () => [], vaultReady: () => true }));
vi.mock('@/lib/cloud-sources', () => ({ sourceViews: () => [] }));
vi.mock('@/lib/credential-verification', () => ({ emailDefaults: () => ({ host: '', account: '' }) }));
vi.mock('@/components/WorkspaceConnections', () => ({ WorkspaceConnections: () => null }));
vi.mock('@/components/CloudConnections', () => ({ CloudConnections: () => null }));

test.each([
  ['reconnected', 'Reconnected. Your saved account selections and automatic-update settings have been kept.'],
  ['authorized', 'Connected. Your account connection is securely saved to this workspace.'],
  ['failed', 'Authorization did not complete.'],
])('connection=%s renders honest status feedback', async (connection, text) => {
  const html = renderToStaticMarkup(await IntegrationsPage({ searchParams: Promise.resolve({ connection }) }));
  expect(html).toContain('role="status"'); expect(html).toContain(text);
  expect(html).not.toContain('automatic updates stay off');
});
