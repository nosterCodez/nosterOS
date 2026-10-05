import { z } from 'zod';

export const ProviderDiagnosticSchema = z.object({
  provider: z.literal('etsy'),
  httpStatus: z.number().int().min(400).max(599),
  code: z.enum(['invalid_token', 'invalid_api_key', 'insufficient_scope', 'access_denied', 'invalid_grant', 'api_key_inactive_or_secret_mismatch', 'unrecognized_provider_error']),
}).strict();
export type ProviderDiagnostic = z.infer<typeof ProviderDiagnosticSchema>;

export function etsyDiagnostic(httpStatus: number, error: unknown): ProviderDiagnostic {
  // Never truncate/echo arbitrary text: even a short error can reflect a credential.
  const known: Record<string, ProviderDiagnostic['code']> = {
    invalid_token: 'invalid_token', invalid_api_key: 'invalid_api_key', insufficient_scope: 'insufficient_scope',
    access_denied: 'access_denied', invalid_grant: 'invalid_grant',
    'API key not found or not active, or incorrect shared secret for API key.': 'api_key_inactive_or_secret_mismatch',
  };
  return ProviderDiagnosticSchema.parse({ provider: 'etsy', httpStatus, code: typeof error === 'string' && Object.hasOwn(known, error) ? known[error] : 'unrecognized_provider_error' });
}
