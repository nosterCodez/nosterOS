import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';

const file = '.env.local';
execFileSync('git', ['check-ignore', '--quiet', file]);
let source = readFileSync(file, 'utf8');
const current = parseEnv(source);
const values: Record<string, string> = {
  NOSTEROS_BASE_URL: 'http://localhost:4100',
  NOSTEROS_OWNER_EMAIL: 'noster@nostermarketing.com',
  NOSTEROS_SIGNUP_ALLOWLIST: 'noster@nostermarketing.com,jesusgarcia@nostermarketing.com',
};
for (const key of ['BETTER_AUTH_SECRET', 'NOSTEROS_INTERNAL_SECRET', 'FOUNDER_OS_ACCESS_TOKEN']) {
  if (!current[key]) values[key] = randomBytes(48).toString('base64url');
}
for (const [key, value] of Object.entries(values)) {
  if (current[key]) continue;
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  source = pattern.test(source) ? source.replace(pattern, () => line) : `${source.trimEnd()}\n${line}\n`;
}
writeFileSync(file, source, { mode: 0o600 });
console.log('Local auth configuration saved. Existing nonempty values preserved. No secret values printed.');
