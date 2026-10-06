import { z } from 'zod';
const Mode = z.enum(['production', 'staging', 'development']);
export type EnvMode = z.infer<typeof Mode>;
/** Resolve on the server and pass only the mode to client components. */
export function envMode(env: Record<string, string | undefined> = process.env): EnvMode {
  return Mode.parse(env.OMEGA_ENV || 'production');
}
