import { expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { WorkspaceConnections } from '@/components/WorkspaceConnections';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

test('Gmail setup links appear above the email credential fields with safe external links', () => {
  const html = renderToStaticMarkup(createElement(WorkspaceConnections, { workspaceId: 'A'.repeat(32), initial: { ready: true, connections: [
    { name: 'INBOX_1_HOST', label: 'Email IMAP host', provider: 'email', status: 'not_configured', updatedAt: null },
  ] } }));
  expect(html).toContain('id="email-credentials"');
  expect(html).toContain('https://myaccount.google.com/apppasswords');
  expect(html).toContain('https://support.google.com/accounts/answer/185839');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain('never your normal Google password');
  expect(html.indexOf('Create Gmail app password')).toBeLessThan(html.indexOf('Email IMAP host'));
});
