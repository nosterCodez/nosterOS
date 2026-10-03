/**
 * Demo gate predicate — pure and env-only (NO node imports) so it is safe to
 * pull into runtime bundles. Only explicit DEMO_GATE=1 enables demo data;
 * deployment platform variables never imply demo behavior.
 *
 *   DEMO_GATE=1  -> always gated
 *   DEMO_GATE=0  -> never gated   (explicit escape hatch)
 *   otherwise    -> never gated
 */
export function isGated(env: Record<string, string | undefined> = process.env): boolean {
  return env.DEMO_GATE === '1';
}
