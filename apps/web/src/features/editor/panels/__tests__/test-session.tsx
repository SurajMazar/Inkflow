import { Editor } from '@inkflow/canvas-engine';
import type { SyncStatus } from '@inkflow/collaboration';
import type { SceneElement } from '@inkflow/elements';
import type { BoardRole } from '@inkflow/shared';
import * as React from 'react';
import { vi } from 'vitest';
import { makeBoard } from '@/test/fixtures';
import { renderWithProviders, type RenderOptions } from '@/test/render';
import { BoardSessionProvider, type BoardSession } from '../../hooks/editor-context';
import { useEditorUi } from '../../hooks/ui-store';

/** A real, detached editor with a sized viewport. */
export function createTestEditor(elements: SceneElement[] = [], options: { readOnly?: boolean } = {}): Editor {
  const editor = new Editor({ initialState: { readOnly: false } });
  editor.setState({ viewport: { x: 0, y: 0, zoom: 1, width: 1000, height: 800 } });
  if (elements.length) editor.addElements(elements, { select: false });
  if (options.readOnly) editor.setState({ readOnly: true });
  return editor;
}

export interface SessionOptions extends RenderOptions {
  role?: BoardRole;
  canComment?: boolean;
  reload?: () => Promise<void>;
}

export function makeSession(editor: Editor, options: SessionOptions = {}): BoardSession {
  const role = options.role ?? 'OWNER';
  return {
    editor,
    boardId: 'b1',
    board: makeBoard({ role }),
    role,
    canEdit: role !== 'VIEWER',
    canComment: options.canComment ?? true,
    shareToken: null,
    sync: { connection: 'online', save: 'saved', pendingOps: 0, lastSavedAt: null, error: null } satisfies SyncStatus,
    offlineCopy: false,
    renameBoard: vi.fn(async () => undefined),
    reload: options.reload ?? vi.fn(async () => undefined),
  };
}

/** Renders `ui` inside the app providers and a board session for `editor`. */
export function renderInSession(ui: React.ReactElement, editor: Editor, options: SessionOptions = {}) {
  useEditorUi.getState().reset();
  const session = makeSession(editor, options);
  const result = renderWithProviders(<BoardSessionProvider value={session}>{ui}</BoardSessionProvider>, options);
  return { ...result, session };
}
