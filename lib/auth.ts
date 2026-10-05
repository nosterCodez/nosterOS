import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { z } from 'zod';
import { getMigrations } from 'better-auth/db/migration';
import { magicLink, organization } from 'better-auth/plugins';
import { controlDbPath } from '@/lib/paths';
import { ac, roles } from '@/lib/auth-access';
import { sendSystemMail, type SystemMessage } from '@/lib/system-mail';
import { createAccountWorkspaces } from '@/lib/account-workspaces';
import { invitationEntryURL } from '@/lib/invitation-entry';
export { invitationIsCurrent } from '@/lib/account-workspaces';

export function createAuth(database: Database.Database, options: {
  baseURL: string; secret: string; send?: (message: SystemMessage) => Promise<void>;
}) {
  const send = options.send ?? sendSystemMail;
  const workspaces = createAccountWorkspaces(database);
  return betterAuth({
    database, baseURL: options.baseURL, secret: options.secret,
    trustedOrigins: [new URL(options.baseURL).origin],
    hooks: { after: createAuthMiddleware(async context => {
      if (context.path !== '/organization/invite-member' || context.context.returned instanceof APIError) return;
      const invitation = z.object({ id: z.string(), email: z.string().email(), organizationId: z.string(), expiresAt: z.date() }).parse(context.context.returned);
      // Better Auth's invitation callback swallows delivery failures. Await in the
      // endpoint hook instead so a failed send is visible and can be retried.
      try {
        const workspace = await context.context.adapter.findOne<{ name: string }>({ model: 'organization', where: [{ field: 'id', value: invitation.organizationId }] });
        if (!workspace) throw new Error('Workspace unavailable');
        await send({ template: 'workspace-invitation', email: invitation.email, workspace: workspace.name,
          url: invitationEntryURL(options.baseURL, options.secret, invitation.id, invitation.expiresAt) });
      } catch {
        throw new APIError('SERVICE_UNAVAILABLE', { message: 'Invitation saved, but email delivery failed. Use Resend email in pending invitations.' });
      }
    }) },
    databaseHooks: { user: { create: { before: async user => {
      if (!workspaces.maySignIn(user.email)) throw new APIError('FORBIDDEN', { message: 'Registration requires an invitation.' });
    } } }, session: {
      create: { before: async session => ({ data: { ...session, activeOrganizationId: workspaces.initial(session.userId) } }) },
      update: { after: async (session, context) => {
        if (session && ['/organization/set-active', '/organization/create', '/organization/accept-invitation'].includes(context?.path ?? '')) {
          workspaces.remember(session.userId, (session as typeof session & { activeOrganizationId?: string }).activeOrganizationId);
        }
      } },
    } },
    session: { cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 100,
      customRules: { '/sign-in/*': { window: 60, max: 5 } } },
    socialProviders: process.env.GOOGLE_LOGIN_CLIENT_ID && process.env.GOOGLE_LOGIN_CLIENT_SECRET ? {
      google: { clientId: process.env.GOOGLE_LOGIN_CLIENT_ID, clientSecret: process.env.GOOGLE_LOGIN_CLIENT_SECRET,
        disableDefaultScope: true, scope: ['openid', 'email', 'profile'] },
    } : {},
    plugins: [
      magicLink({ storeToken: 'hashed', rateLimit: { window: 60, max: 5 },
        sendMagicLink: async ({ email, url }) => {
          if (workspaces.maySignIn(email)) await send({ template: 'magic-link', email, url });
        } }),
      organization({ ac, roles, creatorRole: 'owner', requireEmailVerificationOnInvitation: true, invitationExpiresIn: 48 * 60 * 60,
        organizationHooks: {
          beforeCreateOrganization: async ({ organization: workspace }) => {
            const metadata = typeof workspace.metadata === 'string' ? JSON.parse(workspace.metadata) : workspace.metadata;
            if (!metadata || !['founder', 'agency', 'client'].includes(metadata.kind)) throw new Error('Choose a valid workspace kind');
          },
        },
      }),
    ],
  });
}
let instance: Promise<ReturnType<typeof createAuth>> | undefined;
export function getAuth() {
  if (!instance) instance = (async () => {
    const secret = process.env.BETTER_AUTH_SECRET;
    const baseURL = process.env.NOSTEROS_BASE_URL;
    if (!secret || secret.length < 32 || !baseURL) throw new Error('Configure BETTER_AUTH_SECRET (32+ characters) and NOSTEROS_BASE_URL');
    const filename = controlDbPath();
    mkdirSync(/*turbopackIgnore: true*/ path.dirname(filename), { recursive: true });
    const database = new Database(filename);
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    const auth = createAuth(database, { baseURL, secret });
    await (await getMigrations(auth.options)).runMigrations();
    return auth;
  })().catch((error) => { instance = undefined; throw error; });
  return instance;
}
