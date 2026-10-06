import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { envMode } from '@/lib/env-mode';
import { Topbar } from '@/components/Topbar';
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('@/components/ConductorPanel', () => ({ CONDUCTOR_OPEN_EVENT: 'fixture' }));

test('environment defaults to production; unknown values are rejected', () => {
  expect(envMode({})).toBe('production');
  for (const value of ['production', 'staging', 'development']) expect(envMode({ OMEGA_ENV: value })).toBe(value);
  expect(() => envMode({ OMEGA_ENV: 'typo' })).toThrow();
});
test('only staging shows the strip, with server-resolved mode passed to Topbar', () => {
  for (const environment of ['production', 'development', 'staging'] as const) {
    const html = renderToStaticMarkup(createElement(Topbar, { environment }));
    expect(html.includes('STAGING')).toBe(environment === 'staging');
    if (environment === 'staging') expect(html).toContain('text-os-warn');
  }
  expect(readFileSync('app/layout.tsx', 'utf8')).toContain('<Topbar environment={envMode()}');
});
