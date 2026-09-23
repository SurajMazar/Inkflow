import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCommonBounds, type SceneElement } from '@inkflow/elements';
import { ImageCache, renderSceneToCanvas } from '@inkflow/renderer';
import { parseDocument } from '@inkflow/scene';
import type { SerializedDocument } from '@inkflow/shared';
import { cn } from '@inkflow/ui';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useTheme } from '@/features/theme/ThemeProvider';
import { BoardPlaceholder } from './BoardPlaceholder';

const PADDING = 24;
const MAX_SCALE = 1.25;

function useInView<T extends Element>(ref: React.RefObject<T | null>): boolean {
  const [inView, setInView] = React.useState(false);
  React.useEffect(() => {
    const node = ref.current;
    if (!node || inView) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, inView]);
  return inView;
}

/**
 * Draws a scene document into `canvas`, fitted and centred in its CSS box. Returns false when there
 * is nothing to draw or no 2D context (e.g. in tests).
 */
export function drawDocumentPreview(
  canvas: HTMLCanvasElement,
  document: SerializedDocument,
  theme: 'light' | 'dark',
  onImageLoad?: () => void,
): boolean {
  const cssWidth = canvas.clientWidth || 320;
  const cssHeight = canvas.clientHeight || 200;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const parsed = parseDocument(document);
  const elements = parsed.document.elements.filter((el) => !el.isDeleted);
  const bounds = getCommonBounds(elements);
  if (!bounds || elements.length === 0) return false;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const contentW = bounds.maxX - bounds.minX + PADDING * 2;
  const contentH = bounds.maxY - bounds.minY + PADDING * 2;
  const fit = Math.min(cssWidth / contentW, cssHeight / contentH, MAX_SCALE);
  const scale = fit * dpr;
  const worldW = (cssWidth * dpr) / scale;
  const worldH = (cssHeight * dpr) / scale;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const byId = new Map<string, SceneElement>(elements.map((el) => [el.id, el]));
  const images = new ImageCache({
    resolveUrl: (fileId) => parsed.document.files[fileId]?.url ?? null,
    onLoad: onImageLoad,
  });
  for (const el of elements) {
    if (el.type === 'image' && el.fileId) images.ensure(el.fileId);
  }
  renderSceneToCanvas(ctx, elements, {
    bounds: { x: cx - worldW / 2, y: cy - worldH / 2, width: worldW, height: worldH },
    scale,
    background: null,
    theme,
    images,
    showFrameNames: false,
    getElement: (id) => byId.get(id),
  });
  return true;
}

/** Live preview of a template, rendered with the canvas renderer once scrolled into view. */
export function TemplatePreview({
  templateId,
  className,
}: {
  templateId: string;
  className?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const inView = useInView(containerRef);
  const { resolvedTheme } = useTheme();
  const [state, setState] = React.useState<'idle' | 'drawn' | 'empty'>('idle');
  const detail = useQuery({
    queryKey: queryKeys.templates.detail(templateId),
    queryFn: ({ signal }) => api.templates.get(templateId, { signal }),
    enabled: inView,
    staleTime: Infinity,
  });
  const document = detail.data?.document;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !document) return;
    let frame = 0;
    const draw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try {
          setState(drawDocumentPreview(canvas, document, resolvedTheme, draw) ? 'drawn' : 'empty');
        } catch (error) {
          console.error('[templates] preview failed', error);
          setState('empty');
        }
      });
    };
    draw();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
    observer?.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [document, resolvedTheme]);

  return (
    <div
      ref={containerRef}
      className={cn('relative size-full overflow-hidden bg-muted/30', className)}
    >
      <canvas
        ref={canvasRef}
        className={cn(
          'absolute inset-0 size-full transition-opacity',
          state === 'drawn' ? 'opacity-100' : 'opacity-0',
        )}
        aria-hidden
      />
      {state !== 'drawn' ? (
        <div className={cn('absolute inset-0', detail.isFetching && 'animate-pulse')}>
          <BoardPlaceholder seed={templateId} className="p-4" />
        </div>
      ) : null}
    </div>
  );
}
