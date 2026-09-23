import { cn } from '@inkflow/ui';
import { DialogHost } from '../dialogs';
import { useBoardSession, useEditorState } from '../hooks/editor-context';
import { useIsCompact } from '../hooks/use-media-query';
import { PanelHost } from '../panels';
import { PresentationOverlay } from '../presentation/PresentationOverlay';
import { BottomBar } from './BottomBar';
import { CanvasView } from './CanvasView';
import { CommentPins } from './CommentPins';
import { EditorContextMenu } from './ContextMenu';
import { PropertiesPanel } from './PropertiesPanel';
import { TextEditorOverlay } from './TextEditorOverlay';
import { Toolbar } from './Toolbar';
import { TopBar } from './TopBar';

/**
 * Editor layout: top bar, floating toolbar (left on desktop, bottom on phones), properties panel
 * (right / bottom sheet), side panels, bottom bar with zoom, history and sync status. The canvas
 * fills the viewport underneath all chrome.
 */
export function EditorShell() {
  const { offlineCopy } = useBoardSession();
  const zen = useEditorState((s) => s.zenMode);
  const presenting = useEditorState((s) => s.presentation.active);
  const compact = useIsCompact();
  const chrome = !presenting;

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-background text-foreground"
      data-testid="editor-root"
    >
      <main className="absolute inset-0" aria-label="Whiteboard canvas">
        <CanvasView />
        <TextEditorOverlay />
        {chrome && <CommentPins />}
      </main>

      {chrome && (
        <>
          <header className="pointer-events-none absolute inset-x-0 top-0 z-30 p-2 sm:p-3">
            <TopBar />
            {offlineCopy && (
              <div
                role="status"
                className="pointer-events-auto mx-auto mt-2 w-fit rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
              >
                You are viewing a copy saved on this device. Changes sync when the connection
                returns.
              </div>
            )}
          </header>

          {!zen && (
            <div
              className={cn(
                'pointer-events-none absolute z-20',
                compact
                  ? 'inset-x-0 bottom-14 flex justify-center px-2'
                  : 'left-3 top-1/2 -translate-y-1/2',
              )}
            >
              <Toolbar orientation={compact ? 'horizontal' : 'vertical'} />
            </div>
          )}

          {!zen && <PropertiesPanel compact={compact} />}
          <PanelHost compact={compact} />

          <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-2 sm:p-3">
            <BottomBar compact={compact} />
          </footer>
          <EditorContextMenu />
        </>
      )}
      {presenting && <PresentationOverlay />}
      <DialogHost />
    </div>
  );
}
