import { z } from 'zod';

export const ProviderDiagnosticSchema = z.object({
  provider: z.literal('etsy'),
  httpStatus: z.number().int().min(400).max(599),
  code: z.enum(['invalid_token', 'invalid_api_key', 'insufficient_scope', 'access_denied', 'invalid_grant', 'api_key_inactive_or_secret_mismatch', 'unrecognized_provider_error']),
  message: z.string().max(160).optional(),
  errorFields: z.array(z.enum(['error', 'error_description'])).max(2).optional(),
}).strict();
export type ProviderDiagnostic = z.infer<typeof ProviderDiagnosticSchema>;

export function etsyDiagnostic(httpStatus: number, error: unknown, secrets: string[] = [], description?: unknown): ProviderDiagnostic {
  const known: Record<string, ProviderDiagnostic['code']> = {
    invalid_token: 'invalid_token', invalid_api_key: 'invalid_api_key', insufficient_scope: 'insufficient_scope',
    access_denied: 'access_denied', invalid_grant: 'invalid_grant',
    'API key not found or not active, or incorrect shared secret for API key.': 'api_key_inactive_or_secret_mismatch',
  };
  let message: string | undefined;
  const parts = [error, description].filter((part): part is string => typeof part === 'string' && part.length > 0);
  if (parts.length) {
    // Redact before truncation so a boundary cannot expose part of an email/token.
    message = parts.join('; ');
    for (const secret of [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length)) message = message.split(secret).join('[redacted]');
    message = message.replace(/[^\s<>"]+/g, part => part.includes('@') ? '[email]' : part)
      .replace(/\d{7,}/g, '[number]').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 160);
  }
  return ProviderDiagnosticSchema.parse({ provider: 'etsy', httpStatus, code: typeof error === 'string' && Object.hasOwn(known, error) ? known[error] : 'unrecognized_provider_error', ...(message ? { message } : {}) });
}

export function etsyErrorFields(body: unknown): ProviderDiagnostic['errorFields'] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  return (['error', 'error_description'] as const).filter(field => Object.hasOwn(body, field));
}

export function etsyBodyDiagnostic(status: number, body: unknown, secrets: string[]): ProviderDiagnostic {
  const errorFields = etsyErrorFields(body);
  const data = errorFields ? body as Record<string, unknown> : {};
  return { ...etsyDiagnostic(status, data.error, secrets, data.error_description), ...(errorFields ? { errorFields } : {}) };
}
