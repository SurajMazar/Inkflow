import { getCommonBounds, type SceneElement } from '@inkflow/elements';
import { renderSceneToCanvas, type ImageSource } from '@inkflow/renderer';
import { cn } from '@inkflow/ui';
import * as React from 'react';

const NO_IMAGES: ImageSource = { get: () => null, status: () => 'missing' };

export interface ScenePreviewProps {
  elements: readonly SceneElement[];
  /** Maximum CSS size of the preview; the scene is scaled to fit and centered. */
  width: number;
  height: number;
  images?: ImageSource;
  background?: string | null;
  /** World-space padding around the content. */
  padding?: number;
  /** Upper bound for the world → CSS pixel scale (small shapes are not blown up). */
  maxScale?: number;
  /** Render inverted to match the dark canvas. */
  dark?: boolean;
  /** Bump to force a redraw (e.g. after images finished loading). */
  revision?: number;
  className?: string;
  label?: string;
}

/** Static thumbnail of a set of elements, drawn with the same renderer as the canvas. */
export function ScenePreview({
  elements,
  width,
  height,
  images = NO_IMAGES,
  background = null,
  padding = 8,
  maxScale = 1,
  dark = false,
  revision = 0,
  className,
  label,
}: ScenePreviewProps) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const visible = React.useMemo(() => elements.filter((e) => !e.isDeleted && !e.hidden), [elements]);
  const bounds = React.useMemo(() => getCommonBounds(visible), [visible]);
  const empty = !bounds;

  React.useEffect(() => {
    const canvas = ref.current;
    const b = bounds;
    if (!canvas || !b) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return;
    const bw = Math.max(1, b.maxX - b.minX) + padding * 2;
    const bh = Math.max(1, b.maxY - b.minY) + padding * 2;
    const dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1;
    const s = Math.min(width / bw, height / bh, maxScale);
    canvas.width = Math.max(1, Math.round(bw * s * dpr));
    canvas.height = Math.max(1, Math.round(bh * s * dpr));
    canvas.style.width = `${Math.round(bw * s)}px`;
    canvas.style.height = `${Math.round(bh * s)}px`;
    const byId = new Map(visible.map((e) => [e.id, e]));
    try {
      renderSceneToCanvas(ctx, visible, {
        bounds: { x: b.minX - padding, y: b.minY - padding, width: bw, height: bh },
        scale: s * dpr,
        background,
        theme: 'light',
        images,
        showFrameNames: false,
        getElement: (id) => byId.get(id),
      });
    } catch (error) {
      console.warn('[inkflow] preview rendering failed', error);
    }
  }, [visible, bounds, width, height, images, background, padding, maxScale, revision]);

  return (
    <div
      className={cn('flex items-center justify-center overflow-hidden', className)}
      style={{ width, height }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {empty ? (
        <span className="text-xs text-muted-foreground">Empty</span>
      ) : (
        <canvas ref={ref} className={cn('max-h-full max-w-full', dark && '[filter:invert(93%)_hue-rotate(180deg)]')} />
      )}
    </div>
  );
}
