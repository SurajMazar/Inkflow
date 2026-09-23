import { cn } from '@inkflow/ui';
import * as React from 'react';
import { importFilesIntoEditor } from '../dialogs/import-files';
import { handleLibraryDrop, LIBRARY_DRAG_MIME } from '../panels/library-drop';
import { useBoardSession, useEditorState } from '../hooks/editor-context';

/** Hosts the static and interactive canvases and forwards drops to the importer. */
export function CanvasView() {
  const { editor, canEdit } = useBoardSession();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const staticRef = React.useRef<HTMLCanvasElement>(null);
  const interactiveRef = React.useRef<HTMLCanvasElement>(null);
  const cursor = useEditorState((s) => s.cursor);
  const theme = useEditorState((s) => s.theme);
  const tool = useEditorState((s) => s.tool);
  const [dragOver, setDragOver] = React.useState(false);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const staticCanvas = staticRef.current;
    const interactiveCanvas = interactiveRef.current;
    if (!container || !staticCanvas || !interactiveCanvas) return;
    const detach = editor.attach({ container, staticCanvas, interactiveCanvas });
    container.focus({ preventScroll: true });
    return detach;
  }, [editor]);

  const onDragOver = (e: React.DragEvent) => {
    if (!canEdit) return;
    const types = e.dataTransfer.types;
    if (!types.includes('Files') && !types.includes(LIBRARY_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const onDrop = (e: React.DragEvent) => {
    setDragOver(false);
    if (!canEdit) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const world = editor.screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (handleLibraryDrop(editor, e.dataTransfer, world)) {
      e.preventDefault();
      return;
    }
    const files = [...e.dataTransfer.files];
    if (files.length === 0) return;
    e.preventDefault();
    void importFilesIntoEditor(editor, files, world);
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="application"
      aria-roledescription="whiteboard"
      aria-label={`Canvas. Current tool: ${tool}. Press question mark for keyboard shortcuts.`}
      className={cn('absolute inset-0 touch-none select-none outline-none', dragOver && 'ring-4 ring-inset ring-primary/40')}
      style={{ cursor }}
      data-testid="canvas-container"
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <canvas
        ref={staticRef}
        className={cn('absolute inset-0 h-full w-full', theme === 'dark' && '[filter:invert(93%)_hue-rotate(180deg)]')}
        data-testid="static-canvas"
        aria-hidden="true"
      />
      <canvas ref={interactiveRef} className="absolute inset-0 h-full w-full" data-testid="interactive-canvas" aria-hidden="true" />
    </div>
  );
}
