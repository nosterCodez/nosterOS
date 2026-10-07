import { operatorWorkspaceId } from '@/lib/operator-workspace';
import { requireWorkspace, SessionError, type WorkspaceCtx } from '@/lib/session';

type OwnerCandidate = { role: string; user: { email: string }; workspace: { id: string } };

/** The configured platform owner: owner role, NOSTEROS_OWNER_EMAIL, inside the bound operator workspace. */
export function isPlatformOwner(context: OwnerCandidate): boolean {
  const owner = process.env.NOSTEROS_OWNER_EMAIL?.trim().toLowerCase();
  return Boolean(owner) && context.role === 'owner' && context.user.email.trim().toLowerCase() === owner
    && context.workspace.id === operatorWorkspaceId();
}

/**
 * Page gate for platform-owner screens. Independent of NOSTEROS_OPERATOR_FEATURES: these screens
 * carry no host or operator connectors. Returns null for everyone else (callers 404).
 */
export async function platformOwnerForPage(): Promise<WorkspaceCtx | null> {
  try {
    const context = await requireWorkspace();
    return isPlatformOwner(context) ? context : null;
  } catch (error) { if (error instanceof SessionError && error.status === 403) return null; throw error; }
}
