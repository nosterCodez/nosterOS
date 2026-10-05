import { z } from 'zod';
import type { VaultContext } from '@/lib/creds';
import { accessFor, oauthGeneration, etsyAppHeaders, authorizedShop } from '@/lib/cloud-oauth';
import { cloudJson, CloudError } from '@/lib/cloud-http';
import { cloudSource } from '@/lib/cloud-catalog';
import { discoverAdsResources } from '@/lib/cloud-google-ads';
import { printifyShops } from '@/lib/cloud-printify';
import { shopifyResource } from '@/lib/cloud-shopify';
import { printifyAccess } from '@/lib/printify-credentials';
import { credentialVersion } from '@/lib/cloud-sources';
import { discoverMetaResources } from '@/lib/cloud-meta';

export type CloudResource = { id: string; label: string };
export type ResourceDiscovery = { resources: CloudResource[]; truncated: boolean };
const text = z.string().min(1).max(500);
const pageToken = z.string().max(4096).optional();
const Sites = z.object({ siteEntry: z.array(z.object({ siteUrl: text, permissionLevel: z.enum(['siteOwner', 'siteFullUser', 'siteRestrictedUser', 'siteUnverifiedUser']) })).max(5000).default([]) });
const Analytics = z.object({ accountSummaries: z.array(z.object({ propertySummaries: z.array(z.object({ property: z.string().regex(/^properties\/\d+$/), displayName: text })).max(5000).default([]) })).max(200).default([]), nextPageToken: pageToken });
const Channels = z.object({ items: z.array(z.object({ id: text, snippet: z.object({ title: text }) })).max(50).default([]), nextPageToken: pageToken });
const Locations = z.object({ locations: z.array(z.object({ name: z.string().regex(/^locations\/\d{1,30}$/), title: text })).max(100).default([]), nextPageToken: pageToken });
const etsyId = z.union([z.number().int().positive().safe(), z.string().regex(/^[1-9]\d{0,29}$/)]).transform(String);
const EtsyShop = z.object({ shop_id: etsyId, user_id: etsyId, shop_name: text });

export async function discoverResources(ctx: VaultContext, id: string, fetcher: typeof fetch = fetch): Promise<ResourceDiscovery> {
  if (!['search-console', 'ga4', 'youtube', 'google-business', 'google-ads', 'facebook', 'instagram', 'meta-ads', 'etsy', 'printify', 'shopify'].includes(id)) throw new CloudError('setup');
  const source = cloudSource(id), provider = source.provider!, generation = credentialVersion(ctx, id);
  if (!generation) throw new CloudError('permission');
  const meta = provider === 'meta', version = process.env.OMEGA_META_API_VERSION;
  if (meta && !/^v\d+\.0$/.test(version ?? '')) throw new CloudError('setup');
  const signal = AbortSignal.timeout(15000);
  const shop = id === 'shopify' ? authorizedShop(ctx) : undefined;
  const token = id === 'printify' ? await printifyAccess(ctx, signal, fetcher) : await accessFor(ctx, provider, signal, fetcher);
  if (meta) {
    const result = await discoverMetaResources(id, token, signal, fetcher);
    signal.throwIfAborted();
    if (oauthGeneration(ctx, provider) !== generation) throw new CloudError('changed');
    return result;
  }
  if (id === 'shopify') {
    const result = await shopifyResource(token, shop!, signal, fetcher);
    signal.throwIfAborted();
    if (oauthGeneration(ctx, provider) !== generation) throw new CloudError('changed');
    return result;
  }
  if (id === 'printify') {
    const result = await printifyShops(token, signal, fetcher);
    signal.throwIfAborted();
    if (credentialVersion(ctx, id) !== generation) throw new CloudError('changed');
    return result;
  }
  if (id === 'google-ads') {
    const result = await discoverAdsResources(token, signal, fetcher);
    signal.throwIfAborted();
    if (oauthGeneration(ctx, provider) !== generation) throw new CloudError('changed');
    return result;
  }
  if (id === 'etsy') {
    // Etsy's documented token prefix is the consenting owner's ID, not a supplied shop ID.
    const owner = /^([1-9]\d{0,29})\.[^\s]+$/.exec(token)?.[1];
    if (!owner) throw new CloudError('invalid_data');
    const raw = await cloudJson(`https://api.etsy.com/v3/application/users/${owner}/shops`, { headers: { Authorization: `Bearer ${token}`, ...etsyAppHeaders() }, signal }, fetcher);
    const shop = EtsyShop.safeParse(raw);
    if (!shop.success || shop.data.user_id !== owner) throw new CloudError('invalid_data');
    signal.throwIfAborted();
    if (oauthGeneration(ctx, provider) !== generation) throw new CloudError('changed');
    return { resources: [{ id: shop.data.shop_id, label: shop.data.shop_name }], truncated: false };
  }
  const resources = new Map<string, CloudResource>();
  let next: string | undefined, truncated = false;
  for (let page = 0; page < 5; page++) {
    const url = new URL(id === 'google-business' ? 'https://mybusinessbusinessinformation.googleapis.com/v1/accounts/-/locations' : id === 'search-console' ? 'https://www.googleapis.com/webmasters/v3/sites' : id === 'ga4' ? 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries' : 'https://www.googleapis.com/youtube/v3/channels');
    if (id === 'ga4') url.searchParams.set('pageSize', '200');
    if (id === 'google-business') { url.searchParams.set('pageSize', '100'); url.searchParams.set('readMask', 'name,title'); }
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
      } else if (id === 'google-business') {
        const result = Locations.parse(raw); next = result.nextPageToken;
        entries = result.locations.map(l => ({ id: l.name.slice('locations/'.length), label: l.title }));
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
  if (oauthGeneration(ctx, provider) !== generation) throw new CloudError('changed');
  return { resources: [...resources.values()], truncated: truncated || Boolean(next) };
}
