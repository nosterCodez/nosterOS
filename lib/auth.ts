import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { magicLink, organization } from 'better-auth/plugins';
import { controlDbPath } from '@/lib/paths';
import { ac, roles } from '@/lib/auth-access';
import { sendSystemMail, type SystemMessage } from '@/lib/system-mail';

export function createAuth(database: Database.Database, options: {
  baseURL: string; secret: string; send?: (message: SystemMessage) => Promise<void>;
}) {
  const send = options.send ?? sendSystemMail;
  return betterAuth({
    database, baseURL: options.baseURL, secret: options.secret,
    trustedOrigins: [new URL(options.baseURL).origin],
    session: { cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 100,
      customRules: { '/sign-in/*': { window: 60, max: 5 } } },
    socialProviders: process.env.GOOGLE_LOGIN_CLIENT_ID && process.env.GOOGLE_LOGIN_CLIENT_SECRET ? {
      google: { clientId: process.env.GOOGLE_LOGIN_CLIENT_ID, clientSecret: process.env.GOOGLE_LOGIN_CLIENT_SECRET,
        disableDefaultScope: true, scope: ['openid', 'email', 'profile'] },
    } : {},
    plugins: [
      magicLink({ storeToken: 'hashed', rateLimit: { window: 60, max: 5 },
        sendMagicLink: ({ email, url }) => send({ template: 'magic-link', email, url }) }),
      organization({ ac, roles, creatorRole: 'owner',
        sendInvitationEmail: ({ email, id, organization: workspace }) => send({
          template: 'workspace-invitation', email, workspace: workspace.name,
          url: `${options.baseURL}/accept-invitation?id=${encodeURIComponent(id)}`,
        }),
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
