import * as React from 'react';
import { cn } from '@inkflow/ui';

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed: number): () => number {
  let t = seed || 1;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Slightly wobbly rectangle path, for a hand-drawn feel. */
function sketchRect(x: number, y: number, w: number, h: number, rand: () => number): string {
  const j = () => (rand() - 0.5) * 1.6;
  return `M${x + j()} ${y + j()} L${x + w + j()} ${y + j()} L${x + w + j()} ${y + h + j()} L${x + j()} ${y + h + j()} Z`;
}

function sketchLine(x1: number, y1: number, x2: number, y2: number, rand: () => number): string {
  const mx = (x1 + x2) / 2 + (rand() - 0.5) * 6;
  const my = (y1 + y2) / 2 + (rand() - 0.5) * 6;
  return `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`;
}

/**
 * Deterministic, low-noise doodle used when a board has no thumbnail yet. The same board id always
 * produces the same drawing.
 */
export const BoardPlaceholder = React.memo(function BoardPlaceholder({
  seed,
  className,
}: {
  seed: string;
  className?: string;
}) {
  const shapes = React.useMemo(() => {
    const rand = seededRandom(hashString(seed));
    const variant = Math.floor(rand() * 3);
    const paths: { d: string; accent?: boolean }[] = [];
    if (variant === 0) {
      // Flow: box → diamond → box
      const y = 38 + rand() * 12;
      paths.push({ d: sketchRect(18, y, 34, 22, rand) });
      paths.push({ d: `M78 ${y - 2} L94 ${y + 11} L78 ${y + 24} L62 ${y + 11} Z`, accent: true });
      paths.push({ d: sketchRect(106, y, 34, 22, rand) });
      paths.push({ d: sketchLine(52, y + 11, 61, y + 11, rand) });
      paths.push({ d: sketchLine(95, y + 11, 105, y + 11, rand) });
    } else if (variant === 1) {
      // Sticky notes
      for (let i = 0; i < 3; i++) {
        const x = 22 + i * 40 + (rand() - 0.5) * 6;
        const yy = 30 + (rand() - 0.5) * 14;
        paths.push({ d: sketchRect(x, yy, 30, 30, rand), accent: i === 1 });
        paths.push({ d: sketchLine(x + 6, yy + 11, x + 24, yy + 11, rand) });
        paths.push({ d: sketchLine(x + 6, yy + 18, x + 19, yy + 18, rand) });
      }
    } else {
      // Mind map: centre + branches
      const cx = 80 + (rand() - 0.5) * 10;
      const cy = 50 + (rand() - 0.5) * 8;
      paths.push({ d: `M${cx - 18} ${cy} a18 12 0 1 0 36 0 a18 12 0 1 0 -36 0`, accent: true });
      const branches = 3 + Math.floor(rand() * 2);
      for (let i = 0; i < branches; i++) {
        const angle = (i / branches) * Math.PI * 2 + rand() * 0.6;
        const ex = cx + Math.cos(angle) * 52;
        const ey = cy + Math.sin(angle) * 30;
        paths.push({
          d: sketchLine(cx + Math.cos(angle) * 20, cy + Math.sin(angle) * 13, ex, ey, rand),
        });
        paths.push({ d: sketchRect(ex - 9, ey - 5, 18, 10, rand) });
      }
    }
    return paths;
  }, [seed]);

  return (
    <svg
      viewBox="0 0 160 100"
      className={cn('size-full', className)}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      {shapes.map((shape, i) => (
        <path
          key={i}
          d={shape.d}
          fill="none"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={shape.accent ? 'stroke-primary/45' : 'stroke-muted-foreground/35'}
        />
      ))}
    </svg>
  );
});
