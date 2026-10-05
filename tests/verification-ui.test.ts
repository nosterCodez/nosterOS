import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { WorkspaceConnections } from '@/components/WorkspaceConnections';
import { CONNECTION_FIELDS, type ConnectionMetadata } from '@/lib/connection-fields';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const connections: ConnectionMetadata[] = CONNECTION_FIELDS.map(field => ({ ...field, status: 'unverified', updatedAt: null, checkedAt: null, verifiedAt: null }));
test('owner gets exactly one email form and status, prefilled identity but no prefilled password', () => {
  const html = renderToStaticMarkup(createElement(WorkspaceConnections, { workspaceId: 'fixture', initial: { ready: true, connections, email: { host: 'imap.gmail.com', account: 'fixture@example.test' } } }));
  expect(html.match(/<form/g)).toHaveLength(11); expect(html.match(/Saved, not checked yet/g)).toHaveLength(11);
  expect(html).toContain('fixture@example.test'); expect(html).toContain('id="connection-email"'); expect(html).toContain('together below');
  expect(html.match(/type="password"[^>]*value=""/g)).toHaveLength(11); expect(html).toContain('Verify saved credentials');
});
test('members/viewers see pills only, never inputs or save/verify buttons', () => {
  const html = renderToStaticMarkup(createElement(WorkspaceConnections, { workspaceId: 'fixture', readOnly: true, initial: { ready: true, connections } }));
  expect(html).toContain('Saved, not checked yet'); expect(html).not.toMatch(/<button|<input|<select|Verify saved credentials/);
});
