export function leadEngineEnabled(workspaceId: string, env: Record<string, string | undefined> = process.env) {
  return env.OMEGA_LEAD_ENGINE === '1' && /^[A-Za-z0-9]{32}$/.test(workspaceId)
    && (env.OMEGA_LEAD_ENGINE_WORKSPACES ?? '').split(',').map(s => s.trim()).includes(workspaceId);
}
