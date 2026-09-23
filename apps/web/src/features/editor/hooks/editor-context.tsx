import type { Editor, EditorState } from '@inkflow/canvas-engine';
import type { SyncStatus } from '@inkflow/collaboration';
import type { SceneElement } from '@inkflow/elements';
import type { BoardRole, BoardSummaryDto } from '@inkflow/shared';
import * as React from 'react';
import { useStore } from 'zustand';

/** Everything the editor chrome needs to know about the open board. */
export interface BoardSession {
  editor: Editor;
  boardId: string;
  board: BoardSummaryDto;
  role: BoardRole;
  canEdit: boolean;
  /** Signed-in users with at least view access may comment. */
  canComment: boolean;
  shareToken: string | null;
  sync: SyncStatus;
  /** True when the document came from the local cache because the server was unreachable. */
  offlineCopy: boolean;
  renameBoard(title: string): Promise<void>;
  /** Reloads the document from the server (after a version restore or resync). */
  reload(): Promise<void>;
}

const SessionContext = React.createContext<BoardSession | null>(null);

export function BoardSessionProvider({ value, children }: { value: BoardSession; children: React.ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useBoardSession(): BoardSession {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error('useBoardSession must be used inside the board editor');
  return ctx;
}

export function useEditor(): Editor {
  return useBoardSession().editor;
}

/** Subscribes to a slice of the editor state. */
export function useEditorState<T>(selector: (state: EditorState) => T): T {
  const editor = useEditor();
  return useStore(editor.store, selector);
}

/** Currently selected, live elements (re-evaluated on scene and selection changes). */
export function useSelectedElements(): SceneElement[] {
  const editor = useEditor();
  const selectedIds = useEditorState((s) => s.selectedIds);
  const version = useEditorState((s) => s.sceneVersion);
  return React.useMemo(
    () => selectedIds.map((id) => editor.getElement(id)).filter((e): e is SceneElement => !!e),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, selectedIds, version],
  );
}

/** Re-renders when the scene changes; returns live elements in z-order. */
export function useSceneElements(): readonly SceneElement[] {
  const editor = useEditor();
  const version = useEditorState((s) => s.sceneVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useMemo(() => editor.getElements(), [editor, version]);
}

/** Whether an editor action is currently enabled (re-evaluated with state changes). */
export function useActionEnabled(id: string): boolean {
  const editor = useEditor();
  useEditorState((s) => s.selectedIds);
  useEditorState((s) => s.sceneVersion);
  useEditorState((s) => s.canUndo);
  useEditorState((s) => s.canRedo);
  return editor.actions.isEnabled(id);
}
