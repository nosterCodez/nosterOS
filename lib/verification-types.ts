export const VERIFICATION_RESULTS = ['verified', 'rejected', 'unreachable', 'unverifiable', 'incomplete'] as const;
export const VERIFICATION_NOTES = ['restricted key', 'read-only', 'missing Charges read'] as const;
export type VerificationResult = { status: typeof VERIFICATION_RESULTS[number]; note?: typeof VERIFICATION_NOTES[number] };
export type VerificationStatus = VerificationResult['status'] | 'not_configured' | 'unverified' | 'revoked';
export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  verified: 'Verified', rejected: 'Rejected', unreachable: "Couldn't check", unverifiable: "Can't be verified automatically",
  incomplete: 'Finish setting up email', unverified: 'Saved, not checked yet', not_configured: 'Not configured', revoked: 'Disconnected',
};
export const VERIFICATION_REJECTED = 'The provider rejected these credentials or their permissions. The previous credentials were kept.';
export const VERIFICATION_PAUSED = 'Credentials were rejected. Automatic updates are stopped. Verify or replace the credentials before enabling updates again.';
export const EMAIL_FIELDS = ['INBOX_1_HOST', 'INBOX_1_USER', 'INBOX_1_PASS'] as const;
export const IMAP_HOSTS = ['imap.gmail.com', 'outlook.office365.com', 'imap.mail.yahoo.com', 'imap.mail.me.com', 'imap.fastmail.com'];
export type EmailInput = { host: string; account: string; password: string };
