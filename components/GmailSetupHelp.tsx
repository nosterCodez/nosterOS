import { ArrowUpRight } from 'lucide-react';

export function GmailSetupHelp() {
  return <div className="mt-4 space-y-3 text-xs leading-5">
    <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-os-accent underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-os-accent">Create Gmail app password<ArrowUpRight size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
    <p className="text-os-muted">Requires 2-Step Verification. Some work, school or protected Google accounts do not allow app passwords. Use an app password here, never your normal Google password.</p>
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      <a href="https://support.google.com/accounts/answer/185839" target="_blank" rel="noopener noreferrer" className="text-os-accent underline focus-visible:outline focus-visible:outline-os-accent">Set up 2-Step Verification<span className="sr-only"> (opens in a new tab)</span></a>
      <a href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noopener noreferrer" className="text-os-accent underline focus-visible:outline focus-visible:outline-os-accent">App password help<span className="sr-only"> (opens in a new tab)</span></a>
    </div>
    <p className="text-os-muted">Gmail host: <code>imap.gmail.com</code>. Account: your full Gmail address. Save the host, account and app password separately below.</p>
  </div>;
}
