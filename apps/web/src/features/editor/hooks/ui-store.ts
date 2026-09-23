import type { Point } from '@inkflow/geometry';
import { create } from 'zustand';

export type EditorPanel =
  'comments' | 'versions' | 'search' | 'library' | 'layers' | 'frames' | 'structure';
export type EditorDialog =
  'export' | 'import' | 'shortcuts' | 'command' | 'link' | 'autolayout' | 'mermaid';
export type ExportScope = 'board' | 'selection' | 'frame' | 'viewport';

export interface CommentDraft {
  world: Point;
  elementId: string | null;
}

interface EditorUiState {
  panel: EditorPanel | null;
  dialog: EditorDialog | null;
  exportScope: ExportScope;
  exportFrameId: string | null;
  linkElementId: string | null;
  commentDraft: CommentDraft | null;
  activeCommentId: string | null;
  showResolvedComments: boolean;
  /** Mobile: properties bottom sheet open. */
  mobilePropertiesOpen: boolean;
  setPanel(panel: EditorPanel | null): void;
  togglePanel(panel: EditorPanel): void;
  openDialog(dialog: EditorDialog): void;
  closeDialog(): void;
  openExport(scope: ExportScope, frameId?: string | null): void;
  openLink(elementId: string): void;
  startComment(draft: CommentDraft | null): void;
  setActiveComment(id: string | null): void;
  setShowResolved(show: boolean): void;
  setMobilePropertiesOpen(open: boolean): void;
  reset(): void;
}

const initial = {
  panel: null,
  dialog: null,
  exportScope: 'board' as ExportScope,
  exportFrameId: null,
  linkElementId: null,
  commentDraft: null,
  activeCommentId: null,
  showResolvedComments: false,
  mobilePropertiesOpen: false,
};

/** Transient UI state of the editor chrome (panels, dialogs, drafts). Not persisted. */
export const useEditorUi = create<EditorUiState>((set, get) => ({
  ...initial,
  setPanel: (panel) => set({ panel }),
  togglePanel: (panel) => set({ panel: get().panel === panel ? null : panel }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  openExport: (scope, frameId = null) =>
    set({ dialog: 'export', exportScope: scope, exportFrameId: frameId }),
  openLink: (elementId) => set({ dialog: 'link', linkElementId: elementId }),
  startComment: (draft) =>
    set({ commentDraft: draft, panel: draft ? 'comments' : get().panel, activeCommentId: null }),
  setActiveComment: (id) => set({ activeCommentId: id, commentDraft: null }),
  setShowResolved: (show) => set({ showResolvedComments: show }),
  setMobilePropertiesOpen: (open) => set({ mobilePropertiesOpen: open }),
  reset: () => set(initial),
}));
