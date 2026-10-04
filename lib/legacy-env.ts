const warned = new Set<string>();
function preferred(name: string, legacy: string, env: Record<string, string | undefined>) {
  const current = env[name]?.trim();
  if (current) return current;
  const previous = env[legacy]?.trim();
  if (previous && !warned.has(legacy)) {
    warned.add(legacy);
    console.warn(`[nosterOS] ${legacy} is deprecated; use ${name}.`);
  }
  return previous || undefined;
}
export const accessToken = (env: Record<string, string | undefined> = process.env) => preferred('NOSTEROS_ACCESS_TOKEN', 'FOUNDER_OS_ACCESS_TOKEN', env);
export const databaseOverride = (env: Record<string, string | undefined> = process.env) => preferred('NOSTEROS_DB', 'FOUNDER_OS_DB', env);
