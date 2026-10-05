import { z } from 'zod';
import { cloudJson, CloudError } from '@/lib/cloud-http';
import type { CloudResource, ResourceDiscovery } from '@/lib/cloud-resources';

const id = z.string().regex(/^\d{1,30}$/), text = z.string().min(1).max(500);
const paging = z.object({ next: z.string().max(16000).optional(), cursors: z.object({ after: z.string().min(1).max(4096).optional() }).optional() }).optional();
const pages = z.object({ data: z.array(z.object({ id, name: text, instagram_business_account: z.object({ id, username: text.optional() }).nullish() })).max(100), paging });
const ads = z.object({ data: z.array(z.object({ account_id: id, name: text })).max(100), paging });
const businesses = z.object({ data: z.array(z.object({ id })).max(100), paging });

export async function discoverMetaResources(source: string, token: string, signal: AbortSignal, fetcher: typeof fetch): Promise<ResourceDiscovery> {
  const version = process.env.OMEGA_META_API_VERSION;
  if (!/^v\d+\.0$/.test(version ?? '')) throw new CloudError('setup');
  const result = new Map<string, CloudResource>(), seenPages = new Set<string>(), seenBusinesses = new Set<string>();
  let truncated = false, requests = 0;
  const isAds = source === 'meta-ads';
  const fields = isAds ? 'account_id,name' : source === 'instagram' ? 'id,name,instagram_business_account{id,username}' : 'id,name';
  // Fixed paths and bounded cursors only: never follow Graph's credential-bearing next URLs.
  async function edge(path: string, fields: string, consume: (raw: unknown) => boolean) {
    let after: string | undefined;
    const cursors = new Set<string>();
    for (let page = 0; page < 5; page++) {
      if (requests >= 100) { truncated = true; return; }
      signal.throwIfAborted(); requests++;
      const url = new URL(`https://graph.facebook.com/${version}/${path}`);
      url.searchParams.set('fields', fields); url.searchParams.set('limit', '100');
      if (after) url.searchParams.set('after', after);
      const raw = await cloudJson(url.toString(), { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal }, fetcher);
      let more: z.infer<typeof paging>, keepGoing: boolean;
      try { more = z.object({ paging }).parse(raw).paging; keepGoing = consume(raw); }
      catch { throw new CloudError('invalid_data'); }
      after = more?.next ? more.cursors?.after : undefined;
      if (more?.next && !after) throw new CloudError('invalid_data');
      if (!keepGoing) { truncated = true; return; }
      if (!after) return;
      if (cursors.has(after)) { truncated = true; return; }
      cursors.add(after);
    }
    if (after) truncated = true;
  }
  function collect(raw: unknown) {
    if (isAds) {
      for (const account of ads.parse(raw).data) {
        if (result.size >= 100 && !result.has(account.account_id)) return false;
        result.set(account.account_id, { id: account.account_id, label: account.name });
      }
    } else {
      for (const page of pages.parse(raw).data) {
        if (seenPages.size >= 100 && !seenPages.has(page.id)) return false;
        seenPages.add(page.id);
        const instagram = page.instagram_business_account;
        if (source === 'facebook') result.set(page.id, { id: page.id, label: page.name });
        else if (instagram) result.set(instagram.id, { id: instagram.id, label: instagram.username ? `@${instagram.username} - ${page.name}` : page.name });
      }
    }
    return true;
  }
  await edge(`me/${isAds ? 'adaccounts' : 'accounts'}`, fields, collect);
  await edge('me/businesses', 'id', raw => {
    for (const business of businesses.parse(raw).data) {
      if (seenBusinesses.size >= 10 && !seenBusinesses.has(business.id)) return false;
      seenBusinesses.add(business.id);
    }
    return true;
  });
  for (const business of seenBusinesses) {
    for (const kind of isAds ? ['owned_ad_accounts'] : ['owned_pages', 'client_pages']) {
      if ((isAds ? result.size : seenPages.size) >= 100 || requests >= 100) { truncated = true; break; }
      await edge(`${business}/${kind}`, fields, collect);
    }
  }
  return { resources: [...result.values()], truncated };
}
