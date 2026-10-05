import { z } from 'zod';
import type { VaultContext } from '@/lib/creds';
import { accessFor, oauthGeneration } from '@/lib/cloud-oauth';
import { cloudJson, CloudError } from '@/lib/cloud-http';
import { cloudSource } from '@/lib/cloud-catalog';

export type CloudResource = { id: string; label: string };
export type ResourceDiscovery = { resources: CloudResource[]; truncated: boolean };
const text = z.string().min(1).max(500);
const pageToken = z.string().max(4096).optional();
const Sites = z.object({ siteEntry: z.array(z.object({ siteUrl: text, permissionLevel: z.enum(['siteOwner', 'siteFullUser', 'siteRestrictedUser', 'siteUnverifiedUser']) })).max(5000).default([]) });
const Analytics = z.object({ accountSummaries: z.array(z.object({ propertySummaries: z.array(z.object({ property: z.string().regex(/^properties\/\d+$/), displayName: text })).max(5000).default([]) })).max(200).default([]), nextPageToken: pageToken });
const Channels = z.object({ items: z.array(z.object({ id: text, snippet: z.object({ title: text }) })).max(50).default([]), nextPageToken: pageToken });

export async function discoverResources(ctx: VaultContext, id: string, fetcher: typeof fetch = fetch): Promise<ResourceDiscovery> {
  if (!['search-console', 'ga4', 'youtube'].includes(id)) throw new CloudError('setup');
  const source = cloudSource(id), generation = oauthGeneration(ctx, 'google');
  if (!generation) throw new CloudError('permission');
  const signal = AbortSignal.timeout(15000);
  const token = await accessFor(ctx, 'google', signal, fetcher);
  const resources = new Map<string, CloudResource>();
  let next: string | undefined, truncated = false;
  for (let page = 0; page < 5; page++) {
    const url = new URL(id === 'search-console' ? 'https://www.googleapis.com/webmasters/v3/sites' : id === 'ga4' ? 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries' : 'https://www.googleapis.com/youtube/v3/channels');
    if (id === 'ga4') url.searchParams.set('pageSize', '200');
    if (id === 'youtube') { url.searchParams.set('part', 'snippet'); url.searchParams.set('mine', 'true'); url.searchParams.set('maxResults', '50'); }
    if (next) url.searchParams.set('pageToken', next);
    const raw = await cloudJson(url.toString(), { headers: { Authorization: `Bearer ${token}` }, signal }, fetcher);
    let entries: CloudResource[];
    try {
      if (id === 'search-console') {
        entries = Sites.parse(raw).siteEntry.filter(s => s.permissionLevel !== 'siteUnverifiedUser').map(s => ({ id: s.siteUrl, label: s.siteUrl }));
        next = undefined;
      } else if (id === 'ga4') {
        const result = Analytics.parse(raw); next = result.nextPageToken;
        entries = result.accountSummaries.flatMap(a => a.propertySummaries.map(p => ({ id: p.property.slice('properties/'.length), label: p.displayName })));
      } else {
        const result = Channels.parse(raw); next = result.nextPageToken;
        entries = result.items.map(c => ({ id: c.id, label: c.snippet.title }));
      }
      for (const entry of entries) {
        if (source.resourcePattern && !new RegExp(source.resourcePattern).test(entry.id)) throw new CloudError('invalid_data');
        if (resources.size >= 500 && !resources.has(entry.id)) { truncated = true; break; }
        resources.set(entry.id, entry);
      }
    } catch { throw new CloudError('invalid_data'); }
    if (truncated || !next) break;
  }
  signal.throwIfAborted();
  // A disconnect/reconnect must invalidate discovery already in flight.
  if (oauthGeneration(ctx, 'google') !== generation) throw new CloudError('changed');
  return { resources: [...resources.values()], truncated: truncated || Boolean(next) };
}
