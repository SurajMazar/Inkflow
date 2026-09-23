import { cn } from '@inkflow/ui';
import * as React from 'react';

const FADE_PX = 20;

/**
 * Scroll container that fades its top/bottom edge only when there is more content in that
 * direction, so clipped controls never end abruptly against the panel border.
 */
export function ScrollFade({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ top: false, bottom: false });

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, []);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [update]);

  const mask = `linear-gradient(to bottom, ${edges.top ? 'transparent' : 'black'} 0, black ${FADE_PX}px, black calc(100% - ${FADE_PX}px), ${edges.bottom ? 'transparent' : 'black'} 100%)`;
  return (
    <div
      ref={ref}
      onScroll={update}
      className={cn(
        'min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]',
        className,
      )}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      {children}
    </div>
  );
}
