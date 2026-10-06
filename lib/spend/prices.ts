import { z } from 'zod';
export type AiProvider = 'openai' | 'anthropic';
export type AiPrice = { provider: AiProvider; model: string; inputPer1M: number; outputPer1M: number; verifiedOn: string; source: string };
export const AI_PRICES: readonly AiPrice[] = [
  { provider: 'openai', model: 'gpt-6-luna', inputPer1M: 0.10, outputPer1M: 0.50,
    verifiedOn: '2026-10-06', source: 'https://developers.openai.com/api/docs/models/gpt-6-luna' },
  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', inputPer1M: 1, outputPer1M: 5,
    verifiedOn: '2026-10-06', source: 'https://platform.claude.com/docs/en/models/haiku-4-5/overview' },
];
export function aiPrice(provider: AiProvider, model: string) {
  return AI_PRICES.find(price => price.provider === provider && price.model === model) ?? null;
}
const Tokens = z.number().int().nonnegative().max(1_000_000);
export function usageCost(price: AiPrice, inputTokens: number, outputTokens: number) {
  return (Tokens.parse(inputTokens) * price.inputPer1M + Tokens.parse(outputTokens) * price.outputPer1M) / 1_000_000;
}
export function estimateAiCost(price: AiPrice, prompt: string, maxTokens: number) {
  z.number().int().min(1).max(4096).parse(maxTokens);
  // Byte count is deliberately more conservative than chars/3, including non-ASCII profiles.
  return usageCost(price, Buffer.byteLength(prompt, 'utf8') + 1024, maxTokens);
}
