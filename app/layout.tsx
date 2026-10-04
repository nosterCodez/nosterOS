import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { CommandPalette } from '@/components/CommandPalette';
import { ConductorPanel } from '@/components/ConductorPanel';
import { Toaster } from '@/components/Toaster';
import { LensProvider } from '@/lib/hooks/useLens';
import type { FounderDb } from '@/lib/db';
import type { PaletteAgent } from '@/lib/palette';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireSession, requireWorkspace } from '@/lib/session';
import { publicAuthPath } from '@/lib/auth-boundary';

const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'nosterOS',
  description: 'nosterOS: the nosterCodes workspace for business operations, connected tools and AI-assisted teams.',
};

/** The palette builds its own Go-to group from lib/nav; the layout only feeds
    it the agent roster (serializable rows — this is a server component). The
    old per-tool command flood is gone: the Connections entry covers /integrations. */
function paletteAgents(db: FounderDb): PaletteAgent[] {
  return db
    .agents.all()
    .map((a) => ({ id: a.id, name: a.name, role: a.role }));
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = new Headers(await headers());
  const pathname = h.get('x-nosteros-path') ?? '/';
  const publicPage = publicAuthPath(pathname);
  const session = await requireSession(h, true);
  if (!publicPage && !session) redirect(`/sign-in?next=${encodeURIComponent(pathname)}`);
  if (!publicPage && pathname !== '/onboarding' && !session?.session.activeOrganizationId) redirect('/onboarding');
  const simple = publicPage || pathname === '/onboarding';
  const workspace = simple ? null : await requireWorkspace('viewer', h);
  return (
    <html lang="en" className={fontMono.variable} suppressHydrationWarning>
      <head>
        {/* Apply the persisted theme before first paint — no dark↔light flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Toaster>
        {simple ? <main className="mx-auto min-h-screen max-w-xl px-6 py-16">{children}</main> : <>
        <LensProvider />
        <Sidebar />
        {/* os-shell yields to the Conductor dock: the panel sets --conductor-w
            and the whole content column glides left instead of being covered */}
        <div className="os-shell flex min-h-screen min-w-0 flex-col" style={{ marginLeft: 'var(--sidebar-w, 232px)', marginRight: 'var(--conductor-w, 0px)' }}>
          <Topbar />
          <main className="min-w-0 flex-1 px-8 pb-16 pt-7 wide:px-10 ultra:px-12">
            {/* Width tiers: 1280 on laptops · 1760 on large monitors ·
                full-bleed on 32"/ultrawide. See tailwind screens wide/ultra. */}
            <div className="mx-auto max-w-[1280px] wide:max-w-[1760px] ultra:max-w-none">
              {children}
            </div>
          </main>
        </div>
        <CommandPalette agents={workspace ? paletteAgents(workspace.db) : []} />
        {/* Notion-style agent dock — the Conductor, aware of the current screen */}
        <ConductorPanel />
        </>}
        </Toaster>
      </body>
    </html>
  );
}
