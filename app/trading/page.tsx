import { OperatorUnavailable } from '@/components/OperatorUnavailable';
import { operatorWorkspaceForPage, withWorkspaceLease } from '@/lib/session';
import { tradingPayload } from '@/lib/trading-payload';
import { TradingBoard } from '@/components/trading/TradingBoard';

export const dynamic = 'force-dynamic';

/**
 * Robinhood + Phantom, rendered through the Trading slab (the Brand Deals * mould). The slab owns its own title row, so the shared header
 * is skipped deliberately. The page reads the same payload GET /api/trading
 * serves, so the board's 60s refresh cannot drift from first paint.
 */
export default async function TradingPage() {
  const workspace = await operatorWorkspaceForPage();
  if (!workspace) return <OperatorUnavailable />;

  const initial = await withWorkspaceLease(workspace, db => tradingPayload(db));
  return <TradingBoard initial={initial} />;
}
