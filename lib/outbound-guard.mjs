/**
 * Shared with plain-Node mail scripts; injected connector env cannot lift the host ban.
 * @param {string} kind
 * @param {Record<string, string | undefined>} env
 */
export function assertOutboundAllowed(kind, env = process.env) {
  if (process.env.OMEGA_OUTBOUND_DISABLED === '1' || env.OMEGA_OUTBOUND_DISABLED === '1') {
    throw new Error('Outbound messages are disabled in this environment.');
  }
}
