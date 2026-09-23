import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, cn } from '@inkflow/ui';
import { X } from 'lucide-react';
import * as React from 'react';
import { useEditorUi, type EditorPanel } from '../hooks/ui-store';
import { CommentsPanel } from './CommentsPanel';
import { FramesPanel } from './FramesPanel';
import { LayersPanel } from './LayersPanel';
import { LibraryPanel } from './LibraryPanel';
import { SearchPanel } from './SearchPanel';
import { StructuredEditorPanel } from './StructuredEditorPanel';
import { VersionHistoryPanel } from './VersionHistoryPanel';

export { handleLibraryDrop, LIBRARY_DRAG_MIME } from './library-drop';

const PANELS: Record<EditorPanel, { title: string; description: string; Component: React.ComponentType }> = {
  comments: { title: 'Comments', description: 'Discuss this board with collaborators.', Component: CommentsPanel },
  versions: { title: 'Version history', description: 'Saved versions of this board.', Component: VersionHistoryPanel },
  search: { title: 'Find on canvas', description: 'Search text, labels and diagram content.', Component: SearchPanel },
  library: { title: 'Library', description: 'Shapes, templates and diagrams from text.', Component: LibraryPanel },
  layers: { title: 'Layers', description: 'Every element on the board, top-most first.', Component: LayersPanel },
  frames: { title: 'Frames', description: 'Frames in presentation order.', Component: FramesPanel },
  structure: { title: 'Edit diagram', description: 'Edit the model of a table, class or sequence diagram.', Component: StructuredEditorPanel },
};

/**
 * Hosts the side panel selected in the editor UI store: a floating panel on the right on desktop,
 * a bottom sheet on compact screens.
 */
export function PanelHost({ compact }: { compact: boolean }) {
  const panel = useEditorUi((s) => s.panel);
  const setPanel = useEditorUi((s) => s.setPanel);
  const close = React.useCallback(() => setPanel(null), [setPanel]);

  if (compact) {
    const meta = panel ? PANELS[panel] : null;
    return (
      <Sheet open={!!panel} onOpenChange={(open) => !open && close()}>
        <SheetContent side="bottom" className="h-[75dvh] gap-0 p-0" data-inkflow-ui data-inkflow-ui-keys aria-describedby={undefined}>
          {meta && (
            <>
              <SheetHeader className="border-b px-4 pt-2 pb-3">
                <SheetTitle className="text-sm">{meta.title}</SheetTitle>
                <SheetDescription className="sr-only">{meta.description}</SheetDescription>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col">
                <meta.Component />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    );
  }

  if (!panel) return null;
  const meta = PANELS[panel];
  return (
    <aside
      data-inkflow-ui
      data-inkflow-ui-keys
      aria-label={meta.title}
      data-testid="side-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          close();
        }
      }}
      className={cn(
        'pointer-events-auto absolute top-16 right-3 bottom-16 z-30 flex w-80 flex-col overflow-hidden rounded-xl border bg-popover/95 text-popover-foreground shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/90',
      )}
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b pr-1.5 pl-4">
        <h2 className="text-sm font-medium">{meta.title}</h2>
        <button
          type="button"
          onClick={close}
          aria-label={`Close ${meta.title.toLowerCase()}`}
          data-testid="panel-close"
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <meta.Component key={panel} />
      </div>
    </aside>
  );
}
