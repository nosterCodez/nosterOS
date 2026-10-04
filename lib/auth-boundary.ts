import { createHash, timingSafeEqual } from 'node:crypto';

export const INTERNAL_PATHS = new Set(['/api/cron/tick', '/api/agents/failover', '/api/analytics/refresh']);
export function equalSecret(value: string | null | undefined, expected: string | undefined): boolean {
  if (!value || !expected) return false;
  return timingSafeEqual(createHash('sha256').update(value).digest(), createHash('sha256').update(expected).digest());
}
export function internalAllowed(path: string, value: string | null, secret = process.env.NOSTEROS_INTERNAL_SECRET): boolean {
  return INTERNAL_PATHS.has(path) && equalSecret(value, secret?.trim());
}
export function publicAuthPath(path: string): boolean {
  return path === '/sign-in' || path === '/accept-invitation' || path.startsWith('/api/auth/');
}
export function safeNext(value: string | null | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value) ? value : '/';
}
