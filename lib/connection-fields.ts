// Public field definitions only. Platform authentication and mail keys are never editable here.
export const CONNECTION_FIELDS = [
  { name: 'PRINTIFY_API_TOKEN', provider: 'printify', label: 'Printify personal access token (read-only)' },
  { name: 'OPENAI_API_KEY', provider: 'openai', label: 'OpenAI API key' },
  { name: 'ANTHROPIC_API_KEY', provider: 'anthropic', label: 'Anthropic API key' },
  { name: 'STRIPE_SECRET_KEY', provider: 'stripe', label: 'Stripe restricted read-only key' },
  { name: 'ATTIO_API_KEY', provider: 'attio', label: 'Attio API key' },
  { name: 'GHL_API_KEY', provider: 'gohighlevel', label: 'GoHighLevel API key' },
  { name: 'MANYCHAT_API_KEY', provider: 'manychat', label: 'ManyChat API key' },
  { name: 'FATHOM_API_KEY', provider: 'fathom', label: 'Fathom API key' },
  { name: 'FOREPLAY_API_KEY', provider: 'foreplay', label: 'Foreplay API key' },
  { name: 'ARCADS_API_KEY', provider: 'arcads', label: 'Arcads API key' },
  { name: 'INBOX_1_HOST', provider: 'email', label: 'Email IMAP host' },
  { name: 'INBOX_1_USER', provider: 'email', label: 'Email account' },
  { name: 'INBOX_1_PASS', provider: 'email', label: 'Email app password' },
] as const;
export type ConnectionMetadata = typeof CONNECTION_FIELDS[number] & { status: import('@/lib/verification-types').VerificationStatus; updatedAt: string | null; checkedAt: string | null; verifiedAt: string | null; note?: import('@/lib/verification-types').VerificationResult['note'] };
export function connectionField(name: string) {
  const field = CONNECTION_FIELDS.find(field => field.name === name);
  if (!field) throw new Error('Unsupported connection field');
  return field;
}
