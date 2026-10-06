import { expect, test, vi } from 'vitest';
import { cityQuery, overpassSource } from '@/lib/leads/sources/overpass';
import { leadEngineEnabled } from '@/lib/leads/flags';
test('lead discovery flags are off and explicitly workspace-allowlisted', () => {
  const id = 'A'.repeat(32);
  expect(leadEngineEnabled(id, {})).toBe(false);
  expect(leadEngineEnabled(id, { OMEGA_LEAD_ENGINE: '1' })).toBe(false);
  expect(leadEngineEnabled(id, { OMEGA_LEAD_ENGINE: '1', OMEGA_LEAD_ENGINE_WORKSPACES: id })).toBe(true);
  expect(leadEngineEnabled('B'.repeat(32), { OMEGA_LEAD_ENGINE: '1', OMEGA_LEAD_ENGINE_WORKSPACES: id })).toBe(false);
});
test('Overpass uses one bounded query, escaped city, timeout, attribution and public business fields', async () => {
  const request = vi.fn(async (_url, init) => {
    expect(init.signal).toBeInstanceOf(AbortSignal); expect(init.redirect).toBe('error');
    expect(init.headers['User-Agent']).toContain('OmegaOS');
    expect(init.body.get('data')).toContain('[timeout:25]');
    return Response.json({ elements: [{ type: 'area', id: 1 }, { type: 'node', id: 2, lat: 26.2, lon: -98.2, tags: { name: 'Fixture salon', shop: 'hairdresser', website: 'https://example.test/', phone: '555-0100' } }] });
  });
  const source = overpassSource(request as typeof fetch);
  const rows = await source.find({ city: 'Mission, TX', queries: ['salon', 'barber'], limit: 25, signal: new AbortController().signal });
  expect(request).toHaveBeenCalledTimes(1); expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ source: 'overpass', id: 'node/2', category: 'hairdresser' });
  expect(source.costPerCallUsd).toBe(0); expect(source.attribution).toContain('ODbL');
  expect(cityQuery('A";out;, TX')).toContain('A\\";out;');
});
test('ambiguous cities and oversized bodies fail closed without additional requests', async () => {
  const query = { city: 'Mission', queries: [], limit: 25, signal: new AbortController().signal };
  await expect(overpassSource(vi.fn(async () => Response.json({ elements: [{ type: 'area', id: 1 }, { type: 'area', id: 2 }] }))).find(query)).rejects.toThrow('city_not_unique');
  await expect(overpassSource(vi.fn(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)))).find(query)).rejects.toThrow('source_too_large');
});
