'use client';

import { usePathname } from 'next/navigation';
import { Bot, Search } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { OsMark } from '@/components/OsMark';
import { CONDUCTOR_OPEN_EVENT } from '@/components/ConductorPanel';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import type { EnvMode } from '@/lib/env-mode';

const SEGMENT_LABELS: Record<string, string> = {
  '': 'home',
  social: 'social',
  comms: 'comms',
  agents: 'agents',
  org: 'org-chart',
  brain: 'g-brain',
  integrations: 'connections',
  roadmap: 'roadmap',
  analytics: 'analytics',
  reference: 'reference-model',
};

export function openPalette() {
  window.dispatchEvent(new CustomEvent('alex:palette'));
}

export function Topbar({ environment = 'production' }: { environment?: EnvMode }) {
  const pathname = usePathname();
  const segment = pathname.split('/')[1] ?? '';
  const here = SEGMENT_LABELS[segment] ?? segment;

  return (
    <div className="sticky top-0 z-30 flex min-h-[52px] shrink-0 flex-wrap items-center gap-2 border-b border-os-border bg-os-bg2/70 px-3 py-2 backdrop-blur md:flex-nowrap md:gap-3.5 md:px-6">
      <div className="flex items-center gap-[7px] whitespace-nowrap font-mono text-[11px] tracking-[0.04em] text-os-dim">
        <span>OmegaOS</span>
        {environment === 'staging' && <span className="border border-os-warn px-2 py-1 text-os-warn" role="status">STAGING</span>}
        <span className="opacity-45">/</span>
        <span className="text-os-text">{here}</span>
      </div>
      <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2.5">
        <WorkspaceSwitcher />
        <ThemeToggle />
        <button
          onClick={openPalette}
          title="Command palette (⌘K)"
          data-lens="c"
          className="pressable is-dark grid h-[30px] w-[30px] place-items-center rounded-ctl border border-os-border bg-os-surface text-os-muted hover:text-os-text"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
        {/* the agent dock, on the far right where ⌘K used to sit — the
            Conductor answers about whatever screen you're on */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent(CONDUCTOR_OPEN_EVENT))}
          title="Ask the Conductor about this screen"
          aria-label="Open the Conductor agent panel"
          data-lens="c"
          className="pressable is-dark grid h-[30px] w-[30px] place-items-center rounded-ctl border border-os-border bg-os-surface text-os-muted hover:text-os-accent"
        >
          <Bot className="h-3.5 w-3.5" />
        </button>
        {/* OmegaOS emblem — brand mark in the top-right corner */}
        <OsMark size={26} className="ml-1 shrink-0" />
      </div>
    </div>
  );
}
