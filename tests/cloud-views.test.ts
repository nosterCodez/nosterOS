import { expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CLOUD_SOURCES } from '@/lib/cloud-catalog';
import { CloudConnections } from '@/components/CloudConnections';
import { WorkspaceDashboard } from '@/components/WorkspaceDashboard';
import { sourceViews } from '@/lib/cloud-sources';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
vi.mock('@/lib/cloud-sources', () => ({ sourceViews: vi.fn() }));
const sources = CLOUD_SOURCES.map(s => ({ ...s, resource: '', enabled: false, status: s.planned ? 'planned' : 'not_connected', stale: false, snapshot: null, error: null, appReady: false, lastAttempt: null }));
test('disconnected sources lead with honest provider sign-in rather than credential forms', () => {
  const html = renderToStaticMarkup(createElement(CloudConnections, { initial: sources, workspaceId: 'A'.repeat(32) }));
  expect(html).toContain('Setup pending');
  expect(html).toContain('OmegaOS needs a one-time provider setup');
  expect(html).not.toContain('Continue with');
  expect(html).toContain('https://myaccount.google.com/apppasswords');
  expect(html).toContain('href="#email-credentials"');
  expect(html).toContain('Account sign-in is not available yet');
  expect(html).not.toContain('<form');
  expect(html).not.toContain('checked=""');
  expect(html).toContain('lg:grid-cols-2');
});
test('configured providers keep login available but an unavailable vault blocks it', () => {
  const ready = [{ ...sources[0], appReady: true }];
  const html = renderToStaticMarkup(createElement(CloudConnections, { initial: ready, workspaceId: 'A'.repeat(32) }));
  expect(html).toContain('Continue with'); expect(html).not.toContain('disabled=""');
  const unavailable = renderToStaticMarkup(createElement(CloudConnections, { initial: [{ ...ready[0], status: 'vault_unavailable' }], workspaceId: 'A'.repeat(32) }));
  expect(unavailable).not.toContain('Continue with'); expect(unavailable).toContain('Secure storage is unavailable');
});
test('authorized sources offer selection and leave collection opt-in unchecked', () => {
  const connected = sources.map(s => ({ ...s, status: s.planned ? 'planned' : 'paused', appReady: true }));
  const html = renderToStaticMarkup(createElement(CloudConnections, { initial: connected, workspaceId: 'A'.repeat(32) }));
  expect(html).toContain('Find'); expect(html).toContain('Advanced account selection');
  expect(html).toContain('aria-label="Disconnect Stripe"');
  expect(html).toContain('Automatically read these account metrics');
  expect(html).not.toContain('checked=""');
});
test('dashboard renders real zero, unknown placeholders, source period, stale and test labels', async () => {
  const fixture = sources.map(s => s.id === 'stripe' ? { ...s, stale: true, status: 'stale', snapshot: { at: '2026-10-05T00:00:00Z', period: 'Fixture USD period', values: { gross: 0, refunded: null, net: 0, payments: 0 }, mode: 'test' as const } } : s);
  vi.mocked(sourceViews).mockReturnValue(fixture);
  const html = renderToStaticMarkup(await WorkspaceDashboard());
  expect(html).toContain('$0.00'); expect(html).toContain('--'); expect(html).toContain('TEST DATA');
  expect(html).toContain('Stale'); expect(html).toContain('Fixture USD period');
  expect(html).not.toContain('<main');
  if (process.env.OMEGA_PREVIEW_DIR) {
    mkdirSync(process.env.OMEGA_PREVIEW_DIR, { recursive: true });
    writeFileSync(join(process.env.OMEGA_PREVIEW_DIR, 'dashboard.html'), html);
  }
});
