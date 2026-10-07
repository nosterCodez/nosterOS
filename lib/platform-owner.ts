import { operatorWorkspaceId } from '@/lib/operator-workspace';

type OwnerCandidate = { role: string; user: { email: string }; workspace: { id: string } };

/** The configured platform owner: owner role, NOSTEROS_OWNER_EMAIL, inside the bound operator workspace. */
export function isPlatformOwner(context: OwnerCandidate): boolean {
  const owner = process.env.NOSTEROS_OWNER_EMAIL?.trim().toLowerCase();
  return Boolean(owner) && context.role === 'owner' && context.user.email.trim().toLowerCase() === owner
    && context.workspace.id === operatorWorkspaceId();
}
