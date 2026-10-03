'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export function WorkspaceSwitcher() {
  const { data: workspaces } = authClient.useListOrganizations();
  const { data: active } = authClient.useActiveOrganization();
  const [error, setError] = useState('');
  return <div className="flex min-w-0 items-center gap-2 text-xs">
    <select aria-label="Active workspace" value={active?.id ?? ''} className="max-w-[180px] rounded-ctl border border-os-border bg-os-bg px-2 py-1" onChange={async e => {
      const result = await authClient.organization.setActive({ organizationId: e.target.value });
      if (result.error) setError(result.error.message ?? 'Cannot switch workspace'); else window.location.reload();
    }}><option value="" disabled>Workspace</option>{workspaces?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
    <a href="/onboarding" title="Create workspace" aria-label="Create workspace">+</a>
    <a href="/settings/members">Members</a>
    <button className="pressable" onClick={async () => { const result = await authClient.signOut(); if (result.error) setError('Sign-out failed'); else window.location.assign('/sign-in'); }}>Sign out</button>
    {error && <span role="alert">{error}</span>}
  </div>;
}
