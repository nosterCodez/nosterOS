'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { accountButton, accountField } from '@/components/AccountForms';

const roleNames = ['owner', 'admin', 'member', 'viewer'] as const;
type Role = typeof roleNames[number];
type Props = { members: { id: string; role: string; user: { name: string; email: string } }[]; invitations: { id: string; email: string; role: string | null; status: string }[] };
export function WorkspaceMembers({ members, invitations }: Props) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<{ error?: { message?: string } | null }>) {
    setBusy(true); setMessage('');
    try { const result = await action(); if (result.error) throw new Error(result.error.message); window.location.reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Request failed'); setBusy(false); }
  }
  return <div className="space-y-8">
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => {
      e.preventDefault(); const data = new FormData(e.currentTarget);
      void run(() => authClient.organization.inviteMember({ email: String(data.get('email')), role: String(data.get('role')) as Role }));
    }}>
      <label className="space-y-2"><span className="block">Email</span><input className={accountField} type="email" name="email" required /></label>
      <label className="space-y-2"><span className="block">Role</span><select className={accountField} name="role" defaultValue="member">{roleNames.map(r => <option key={r}>{r}</option>)}</select></label>
      <button className={`pressable ${accountButton}`} disabled={busy}>Invite member</button>
    </form>
    <p role="alert">{message}</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-3 text-left text-os-muted">Workspace members</caption><thead><tr><th className="p-3">Name / email</th><th className="p-3">Role</th><th className="p-3">Actions</th></tr></thead><tbody>
      {members.map(m => <tr key={m.id} className="border-t border-os-border"><td className="p-3">{m.user.name}<br />{m.user.email}</td><td className="p-3"><select aria-label={`Role for ${m.user.email}`} className={accountField} disabled={busy} value={m.role} onChange={e => { void run(() => authClient.organization.updateMemberRole({ memberId: m.id, role: e.target.value as Role })); }}>{roleNames.map(r => <option key={r}>{r}</option>)}</select></td><td className="p-3"><button className={`pressable ${accountButton}`} disabled={busy} onClick={() => { if (window.confirm(`Remove ${m.user.email} from this workspace?`)) void run(() => authClient.organization.removeMember({ memberIdOrEmail: m.id })); }}>Remove</button></td></tr>)}
    </tbody></table></div>
    <h2 className="text-lg">Pending invitations</h2>
    <ul className="space-y-3">{invitations.filter(i => i.status === 'pending').map(i => <li key={i.id} className="flex flex-wrap items-center gap-3">{i.email} ({i.role})<button className={`pressable ${accountButton}`} disabled={busy} onClick={() => { void run(() => authClient.organization.cancelInvitation({ invitationId: i.id })); }}>Cancel invitation</button></li>)}</ul>
  </div>;
}
