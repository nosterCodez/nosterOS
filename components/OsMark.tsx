import type { SVGProps } from 'react';
import type { LucideIcon } from 'lucide-react';

/** Frame the supplied emblem without changing the original artwork. */
export function OsMark({ size = 34, className }: { size?: number; color?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="300 0 930 700" role="img" aria-label="OmegaOS" className={className} style={{ flexShrink: 0 }}>
      <image href="/omegaos-logo.png" width="1536" height="1024" />
    </svg>
  );
}

/**
 * The same emblem as a drop-in LucideIcon — a nested <svg><image> so it can
 * ride inside the knowledge graph's SVG canvas (where a raw <img> is invalid)
 * and in HTML chrome alike. Board-agent nodes wear this.
 */
function OsMarkGlyphBase(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="300 0 930 700" fill="none" aria-hidden {...props}>
      <image
        href="/omegaos-logo.png"
        width={1536}
        height={1024}
      />
    </svg>
  );
}

export const OsMarkGlyph = OsMarkGlyphBase as unknown as LucideIcon;
