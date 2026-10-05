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
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const sources = CLOUD_SOURCES.map(s => ({ ...s, resource: '', enabled: false, status: s.planned ? 'planned' : 'not_connected', stale: false, snapshot: null, error: null, appReady: false, lastAttempt: null }));

test('commerce sign-in is honest before approval and Shopify requires a store domain', () => {
  for (const id of ['printify', 'shopify']) {
    const source = sources.find(s => s.id === id)!;
    const pending = renderToStaticMarkup(createElement(CloudConnections, { initial: [source], workspaceId: 'A'.repeat(32) }));
    expect(pending).toContain('Provider setup required'); expect(pending).not.toContain('Continue with');
    const ready = renderToStaticMarkup(createElement(CloudConnections, { initial: [{ ...source, appReady: true }], workspaceId: 'A'.repeat(32) }));
    expect(ready).toContain(`Continue with ${source.name}`);
    if (id === 'shopify') { expect(ready).toContain('Shopify store domain'); expect(ready).toContain('disabled=""'); }
    else expect(ready).not.toContain('disabled=""');
    const connected = renderToStaticMarkup(createElement(CloudConnections, { initial: [{ ...source, appReady: true, status: 'needs_setup' }], workspaceId: 'A'.repeat(32) }));
    expect(connected).toContain('Find accounts'); expect(connected).not.toContain('checked=""');
  }
});
test('disconnected sources lead with honest provider sign-in rather than credential forms', () => {
  const html = renderToStaticMarkup(createElement(CloudConnections, { initial: sources, workspaceId: 'A'.repeat(32) }));
  expect(html).not.toContain('Setup pending');
  expect(html).toContain('More connectors');
  expect(html).toContain('Provider setup required');
  expect(html).not.toContain('Continue with');
  expect(html).toContain('https://myaccount.google.com/apppasswords');
  expect(html).toContain('href="#email-credentials"');
  expect(html).toContain('Account sign-in is not available yet');
  expect(html).not.toContain('<form');
  expect(html).not.toContain('checked=""');
  expect(html).toContain('lg:grid-cols-2');
});

test('saved OAuth is connected before reporting is configured; unavailable apps stay separate', () => {
  const connected = { ...sources[0], appReady: true, status: 'needs_setup' };
  const pending = sources.find(s => s.id === 'instagram')!;
  const html = renderToStaticMarkup(createElement(CloudConnections, { initial: [connected, pending], workspaceId: 'A'.repeat(32) }));
  expect(html).toContain('Connected');
  expect(html).toContain('Account connection saved to this workspace.');
  expect(html).toContain('Choose account');
  expect(html.indexOf('Google Search Console')).toBeLessThan(html.indexOf('More connectors'));
  expect(html.indexOf('Instagram')).toBeGreaterThan(html.indexOf('More connectors'));
  expect(html).not.toContain('Setup pending');
  expect(html).toContain('Refresh status');
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

test('each Meta source offers its own account picker after shared authorization', () => {
  for (const id of ['facebook', 'instagram', 'meta-ads']) {
    const source = { ...sources.find(s => s.id === id)!, status: 'needs_setup', appReady: true };
    const html = renderToStaticMarkup(createElement(CloudConnections, { initial: [source], workspaceId: 'A'.repeat(32) }));
    expect(html).toContain('Find accounts');
    expect(html).toContain('Advanced account selection');
    expect(html).toContain('One Facebook sign-in connects Meta to this workspace');
    expect(html).toContain('Read-only access; no posts or campaign changes');
    expect(html).not.toContain('checked=""');
    if (id === 'instagram') expect(html).toContain('professional account linked to a Facebook Page');
  }
});

test('Business Profile and Etsy explain prerequisites and offer pickers only after authorization', () => {
  for (const id of ['google-business', 'etsy']) {
    const source = sources.find(s => s.id === id)!;
    const pending = renderToStaticMarkup(createElement(CloudConnections, { initial: [source], workspaceId: 'A'.repeat(32) }));
    expect(pending).not.toContain('Continue with'); expect(pending).not.toContain('<form');
    expect(pending).toContain(id === 'etsy' ? 'Etsy must approve the separate OmegaOS app' : 'Google must approve API access');
    const ready = renderToStaticMarkup(createElement(CloudConnections, { initial: [{ ...source, appReady: true, status: 'needs_setup' }], workspaceId: 'A'.repeat(32) }));
    expect(ready).toContain('Find accounts'); expect(ready).not.toContain('checked=""');
  }
  const html = renderToStaticMarkup(createElement(CloudConnections, { initial: sources, workspaceId: 'A'.repeat(32) }));
  expect(html).toContain('Log in with PayPal identifies an account but does not grant transaction-reporting access');
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

test('Ads explains broad consent, remains unavailable before setup and offers authorized selection', () => {
  const source = sources.find(s => s.id === 'google-ads')!;
  const pending = renderToStaticMarkup(createElement(CloudConnections, { initial: [source], workspaceId: 'A'.repeat(32) }));
  expect(pending).toContain('Google Ads requires its own API access');
  expect(pending).not.toContain('Continue with'); expect(pending).not.toContain('<form');
  const ready = renderToStaticMarkup(createElement(CloudConnections, { initial: [{ ...source, appReady: true, status: 'needs_setup' }], workspaceId: 'A'.repeat(32) }));
  expect(ready).toContain('adwords permission, which permits edits');
  expect(ready).toContain('Find accounts'); expect(ready).not.toContain('checked=""');
});

test('configured paused source allows manual sync and dashboard explains first collection', async () => {
  const paused = { ...sources.find(s => s.id === 'ga4')!, resource: '123', status: 'paused', appReady: true };
  const connection = renderToStaticMarkup(createElement(CloudConnections, { initial: [paused], workspaceId: 'A'.repeat(32) }));
  const syncButton = connection.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Sync now<\/button>/)?.[0];
  expect(syncButton).toBeDefined(); expect(syncButton).not.toContain('disabled=""');
  vi.mocked(sourceViews).mockReturnValue([paused]);
  const overview = renderToStaticMarkup(await WorkspaceDashboard());
  expect(overview).toContain('Ready for first sync');
  expect(overview).toContain('Automatic updates are optional');
  expect(overview).toContain('/integrations#source-ga4');
});

test('working Google reports lead the dashboard and retain resource, delay, no-data and refresh context', async () => {
  const google = { ...sources.find(s => s.id === 'ga4')!, resource: '556188283', enabled: true, status: 'connected', snapshot: { at: '2026-10-05T00:00:00Z', period: 'September reporting period', values: {} } };
  vi.mocked(sourceViews).mockReturnValue([...sources.filter(s => s.id !== 'ga4'), google]);
  const html = renderToStaticMarkup(await WorkspaceDashboard());
  expect(html.indexOf('Google Analytics 4')).toBeLessThan(html.indexOf('Other sources'));
  expect(html).toContain('556188283'); expect(html).toContain('No data returned');
  expect(html).toContain('Refresh dashboard'); expect(html).toContain('Sync now');
  expect(html).toContain('1 sources with saved reports');
  if (process.env.OMEGA_PREVIEW_DIR) writeFileSync(join(process.env.OMEGA_PREVIEW_DIR, 'google-dashboard.html'), html);
});
