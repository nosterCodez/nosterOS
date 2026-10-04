import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { THEME_META } from '@/lib/theme';

describe('OmegaOS identity', () => {
  test('default identity uses the approved red palette', () => {
    expect(THEME_META.mono.name).toBe('Omega');
    expect(THEME_META.mono.swatch).toEqual(['#0a0a0a', '#ff565d', '#f2f2f2']);
    const css = readFileSync('app/globals.css', 'utf8');
    const block = css.split(":root[data-theme='mono'] {")[1].split('}')[0];
    expect(block).toContain('--accent: #ff565d');
    expect(block).toContain('--ok: #2fd36f');
  });
  test('provided artwork and company attribution appear without renaming the workspace', () => {
    const sidebar = readFileSync('components/Sidebar.tsx', 'utf8');
    expect(sidebar).toContain('OmegaOS');
    expect(sidebar).toContain('powered by nosterCodes');
    expect(readFileSync('app/layout.tsx', 'utf8')).toContain('/omegaos-logo.png');
    expect(readFileSync('app/icon.png').equals(readFileSync('public/omegaos-logo.png'))).toBe(true);
  });
});
