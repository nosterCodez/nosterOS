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
test('connection controls have honest disabled states, names, and explicit collection opt-in', () => {
  const html = renderToStaticMarkup(createElement(CloudConnections, { initial: sources, workspaceId: 'A'.repeat(32) }));
  expect(html).toContain('Administrator setup required');
  expect(html).toContain('aria-label="Disconnect Stripe"');
  expect(html).toContain('Automatically read these account metrics');
  expect(html).not.toContain('checked=""');
  expect(html).toContain('lg:grid-cols-2');
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
