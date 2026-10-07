import { z } from 'zod';
import { Place, publicWebsite, type LeadSource, type SourceQuery } from './types';
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
/** Polite contact per Overpass usage policy; noster@nostermarketing.com is an inbox Noe reads. */
export const OVERPASS_USER_AGENT = 'OmegaOS/1.0 (read-only business discovery; https://os.noepenaa.com; noster@nostermarketing.com)';
export const OSM_ATTRIBUTION = 'OpenStreetMap contributors (ODbL)';
export function cityQuery(value: string) {
  if (!value.trim() || value.length > 100 || /[\x00-\x1f]/.test(value)) throw new Error('invalid_city');
  const [city, state, ...rest] = value.split(',').map(s => s.trim());
  if (rest.length || !city || (state !== undefined && !state)) throw new Error('invalid_city');
  const scope = state ? /^[A-Za-z]{2}$/.test(state)
    ? `area["ISO3166-2"=${JSON.stringify(`US-${state.toUpperCase()}`)}]`
    : `area(area.country)["admin_level"="4"]["name"=${JSON.stringify(state)}]` : '.country';
  return `[out:json][timeout:25][maxsize:16777216];area["ISO3166-1"="US"]->.country;${scope}->.scope;area(area.scope)["boundary"="administrative"]["admin_level"="8"]["name"=${JSON.stringify(city)}]->.city;.city out tags;nwr(area.city)[~"^(shop|craft|office|amenity)$"~"."];out center tags 500;`;
}
const Element = z.object({ type: z.enum(['area', 'node', 'way', 'relation']), id: z.number().int().nonnegative(),
  lat: z.number().optional(), lon: z.number().optional(), center: z.object({ lat: z.number(), lon: z.number() }).optional(), tags: z.record(z.string()).default({}) });
export function overpassSource(request: typeof fetch = fetch): LeadSource {
  return { id: 'overpass', costPerCallUsd: 0, attribution: OSM_ATTRIBUTION, attributionUrl: 'https://www.openstreetmap.org/copyright',
    async find(input: SourceQuery) {
      const signal = AbortSignal.any([input.signal, AbortSignal.timeout(25000)]);
      const response = await request(OVERPASS_URL, { method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'User-Agent': OVERPASS_USER_AGENT },
        body: new URLSearchParams({ data: cityQuery(input.city) }) });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('source_unavailable'); }
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
          size += part.value.length; if (size > 2 * 1024 * 1024) throw new Error('source_too_large'); chunks.push(part.value); }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const data = z.object({ elements: z.array(Element).max(1000), remark: z.string().optional() }).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (data.remark) throw new Error('source_incomplete');
      if (data.elements.filter(e => e.type === 'area').length !== 1) throw new Error('city_not_unique');
      const found = new Map<string, Place>();
      for (const e of data.elements) {
        if (e.type === 'area' || !e.tags.name) continue;
        const t = e.tags;
        const parsed = Place.safeParse({ source: 'overpass', id: `${e.type}/${e.id}`, name: t.name,
          category: [t.shop, t.craft, t.office, t.amenity].filter(Boolean).join(', '),
          address: [t['addr:housenumber'], t['addr:street'], t['addr:postcode']].filter(Boolean).join(' '), city: input.city,
          latitude: e.lat ?? e.center?.lat, longitude: e.lon ?? e.center?.lon,
          website: publicWebsite(t.website ?? t['contact:website']), phone: (t.phone ?? t['contact:phone'] ?? '').slice(0, 100), refreshedAt: new Date().toISOString() });
        if (parsed.success) found.set(parsed.data.id, parsed.data);
      }
      return [...found.values()].slice(0, Math.min(500, Math.max(0, input.limit)));
    } };
}
