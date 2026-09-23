import { create } from 'zustand';
import type { BoardSummaryDto } from '@inkflow/shared';

export interface NewBoardDefaults {
  projectId?: string | null;
  folderId?: string | null;
  templateId?: string | null;
}

interface DashboardUiState {
  newBoard: { open: boolean; defaults: NewBoardDefaults };
  searchOpen: boolean;
  createWorkspaceOpen: boolean;
  mobileNavOpen: boolean;
  renameBoard: BoardSummaryDto | null;
  moveBoard: BoardSummaryDto | null;
  shareBoard: BoardSummaryDto | null;
  /** Incremented to ask the layout to open the "import board" file picker. */
  importNonce: number;
  requestImport: () => void;
  openNewBoard: (defaults?: NewBoardDefaults) => void;
  closeNewBoard: () => void;
  setSearchOpen: (open: boolean) => void;
  setCreateWorkspaceOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setRenameBoard: (board: BoardSummaryDto | null) => void;
  setMoveBoard: (board: BoardSummaryDto | null) => void;
  setShareBoard: (board: BoardSummaryDto | null) => void;
}

/** Dashboard-wide UI state (dialogs opened from many places: top bar, cards, command palette). */
export const useDashboardUi = create<DashboardUiState>()((set) => ({
  newBoard: { open: false, defaults: {} },
  searchOpen: false,
  createWorkspaceOpen: false,
  mobileNavOpen: false,
  renameBoard: null,
  moveBoard: null,
  shareBoard: null,
  importNonce: 0,
  requestImport: () => set((s) => ({ importNonce: s.importNonce + 1 })),
  openNewBoard: (defaults = {}) => set({ newBoard: { open: true, defaults } }),
  closeNewBoard: () => set((s) => ({ newBoard: { ...s.newBoard, open: false } })),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setCreateWorkspaceOpen: (createWorkspaceOpen) => set({ createWorkspaceOpen }),
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  setRenameBoard: (renameBoard) => set({ renameBoard }),
  setMoveBoard: (moveBoard) => set({ moveBoard }),
  setShareBoard: (shareBoard) => set({ shareBoard }),
}));
