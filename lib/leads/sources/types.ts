import { z } from 'zod';
const text = (max: number) => z.string().trim().max(max);
export const Place = z.object({ source: z.enum(['foursquare', 'overpass']), id: text(150).min(1), name: text(300).min(1),
  category: text(500), address: text(600), city: text(100), latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180), website: text(1000), phone: text(100), refreshedAt: z.string().datetime() }).strict();
export type Place = z.infer<typeof Place>;
export type SourceQuery = { city: string; queries: string[]; limit: number; signal: AbortSignal };
export interface LeadSource {
  id: Place['source']; costPerCallUsd: 0; attribution: string; attributionUrl: string;
  find(query: SourceQuery): Promise<Place[]>;
}
export function publicWebsite(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1000) return '';
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
