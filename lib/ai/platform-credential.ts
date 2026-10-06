import type { AiProvider } from '@/lib/spend/prices';
export type Credential = { provider: AiProvider; key: string; payer: 'byo' | 'platform' };

/** M7 owns the eventual implementation. A feature flag alone never enables a key. */
export async function getPlatformAiCredential(): Promise<Credential | null> {
  if (process.env.OMEGA_PLATFORM_AI !== '1') return null;
  return null;
}
