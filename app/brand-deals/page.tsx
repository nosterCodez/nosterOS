import { OperatorUnavailable } from '@/components/OperatorUnavailable';
import { operatorWorkspaceForPage } from '@/lib/session';
import { fetchBrandDeals } from '@/lib/connectors/brand-deals';
import { DealBoard } from '@/components/brand-deals/DealBoard';

export const dynamic = 'force-dynamic';

/**
 * The OS view of the Notion "Brand Deals Hub", rendered through the Slab
 * "Deal Journeys" slab (imported). Notion stays the source of
 * truth and the page stays read-only; the slab owns its own title row, so
 * the shared header is skipped deliberately.
 */
export default async function BrandDealsPage() {
  const operatorAccess = await operatorWorkspaceForPage();
  if (!operatorAccess) return <OperatorUnavailable />;
  const initial = await fetchBrandDeals();
  return <DealBoard initial={initial} />;
}
