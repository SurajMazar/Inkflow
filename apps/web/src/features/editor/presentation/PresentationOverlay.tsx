import { Popover, PopoverContent, PopoverTrigger, cn } from '@inkflow/ui';
import { ChevronLeft, ChevronRight, List, Pointer, X } from 'lucide-react';
import * as React from 'react';
import { useBoardSession, useEditorState } from '../hooks/editor-context';

const IDLE_MS = 2500;
const TAP_SLOP_PX = 10;
const TAP_MAX_MS = 500;

/** Enters fullscreen for the lifetime of the overlay and stops presenting when the user leaves it. */
function useFullscreen(onExit: () => void) {
  const exitRef = React.useRef(onExit);
  exitRef.current = onExit;
  React.useEffect(() => {
    const root = document.documentElement;
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement) entered = true;
      else if (entered) exitRef.current();
    };
    document.addEventListener('fullscreenchange', onChange);
    if (!document.fullscreenElement && typeof root.requestFullscreen === 'function') {
      root.requestFullscreen().then(
        () => {
          entered = true;
        },
        () => undefined,
      );
    }
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement && typeof document.exitFullscreen === 'function') void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
}

/** Minimal presenter controls shown while presenting frames (auto-hide when idle). */
export function PresentationOverlay() {
  const { editor } = useBoardSession();
  const presentation = useEditorState((s) => s.presentation);
  const laser = useEditorState((s) => s.tool === 'laser');
  const [visible, setVisible] = React.useState(true);
  const [listOpen, setListOpen] = React.useState(false);
  useEditorState((s) => s.sceneVersion);

  useFullscreen(() => editor.stopPresentation());

  // Leave the laser pointer when the presentation ends.
  React.useEffect(
    () => () => {
      if (editor.state.tool === 'laser') editor.setTool('selection');
    },
    [editor],
  );

  // Auto-hide the controls after a short idle period (kept visible while the frame list is open).
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wake = () => {
      setVisible(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setVisible(false), IDLE_MS);
    };
    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  // Re-fit the current frame when the viewport size changes (window resize, fullscreen).
  React.useEffect(() => {
    let { width, height } = editor.state.viewport;
    return editor.store.subscribe((s) => {
      if (s.viewport.width === width && s.viewport.height === height) return;
      width = s.viewport.width;
      height = s.viewport.height;
      if (s.presentation.active) editor.goToFrame(s.presentation.frameIndex);
    });
  }, [editor]);

  // Touch: tapping the left / right third of the screen goes back / forward.
  React.useEffect(() => {
    let start: { x: number; y: number; t: number; id: number } | null = null;
    const isControl = (t: EventTarget | null) => t instanceof Element && !!t.closest('[data-presentation-controls]');
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !e.isPrimary || isControl(e.target)) return;
      start = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
    };
    const up = (e: PointerEvent) => {
      const s = start;
      start = null;
      if (!s || s.id !== e.pointerId || editor.state.tool === 'laser') return;
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > TAP_SLOP_PX || e.timeStamp - s.t > TAP_MAX_MS) return;
      const w = window.innerWidth;
      if (e.clientX > (w * 2) / 3) editor.nextFrame();
      else if (e.clientX < w / 3) editor.previousFrame();
    };
    const cancel = () => {
      start = null;
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [editor]);

  const total = presentation.frameIds.length;
  const index = presentation.frameIndex;
  const frame = editor.getElement(presentation.frameIds[index] ?? '');
  const frameName = frame?.type === 'frame' ? frame.name : '';
  const shown = visible || listOpen;

  const btn =
    'inline-flex size-9 items-center justify-center rounded-lg text-white/90 outline-none transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-35';

  return (
    <div className="pointer-events-none fixed inset-0 z-40" data-testid="presentation-overlay" data-inkflow-ui>
      <div
        role="toolbar"
        aria-label="Presentation controls"
        data-presentation-controls
        // Space/Enter activate the focused button; keep them from also reaching the engine's slide keys.
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
        }}
        onFocus={() => setVisible(true)}
        className={cn(
          'pointer-events-auto absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-neutral-900/85 p-1 text-white shadow-lg backdrop-blur transition-opacity duration-300',
          shown ? 'opacity-100' : 'pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100',
        )}
      >
        <button type="button" className={btn} aria-label="Previous slide" data-testid="presentation-prev" disabled={index <= 0} onClick={() => editor.previousFrame()}>
          <ChevronLeft className="size-5" />
        </button>
        <Popover open={listOpen} onOpenChange={setListOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-9 min-w-24 max-w-64 items-center gap-2 rounded-lg px-2.5 text-sm outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70"
              aria-label={`Slide ${index + 1} of ${total}${frameName ? `: ${frameName}` : ''}. Show all slides`}
              data-testid="presentation-position"
            >
              <List className="size-4 shrink-0 opacity-70" />
              <span className="tabular-nums">
                {total === 0 ? 0 : index + 1} / {total}
              </span>
              {frameName && <span className="truncate text-white/70">{frameName}</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" className="w-64 p-1" data-inkflow-ui data-presentation-controls>
            <ul role="listbox" aria-label="Slides" className="max-h-72 overflow-y-auto">
              {presentation.frameIds.map((id, i) => {
                const f = editor.getElement(id);
                const name = f?.type === 'frame' ? f.name || `Frame ${i + 1}` : `Frame ${i + 1}`;
                return (
                  <li key={id} role="option" aria-selected={i === index}>
                    <button
                      type="button"
                      onClick={() => {
                        editor.goToFrame(i);
                        setListOpen(false);
                      }}
                      className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent', i === index && 'bg-accent font-medium')}
                    >
                      <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className="truncate">{name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </Popover>
        <button type="button" className={btn} aria-label="Next slide" data-testid="presentation-next" disabled={index >= total - 1} onClick={() => editor.nextFrame()}>
          <ChevronRight className="size-5" />
        </button>
        <span className="mx-1 h-5 w-px bg-white/20" aria-hidden />
        <button
          type="button"
          className={cn(btn, laser && 'bg-red-500/80 text-white hover:bg-red-500')}
          aria-label="Laser pointer (L)"
          aria-pressed={laser}
          data-testid="presentation-laser"
          onClick={() => editor.setTool(laser ? 'selection' : 'laser')}
        >
          <Pointer className="size-4" />
        </button>
        <button type="button" className={btn} aria-label="Exit presentation (Esc)" data-testid="presentation-exit" onClick={() => editor.stopPresentation()}>
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
