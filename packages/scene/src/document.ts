import type { FileMetadata, SceneElement } from '@inkflow/elements';

/** Current version of the persisted document format. Bump together with a migration. */
export const CURRENT_DOCUMENT_VERSION = 2;

export type GridType = 'dot' | 'square' | 'isometric';

/** Board-level settings persisted with the document (not per-user view state). */
export interface DocumentAppState {
  viewBackgroundColor: string;
  gridType: GridType;
  gridSize: number;
  /** Frame ids in presentation order; frames not listed follow in canvas order. */
  frameOrder: string[];
}

export const DEFAULT_DOCUMENT_APP_STATE: DocumentAppState = {
  viewBackgroundColor: '#ffffff',
  gridType: 'dot',
  gridSize: 20,
  frameOrder: [],
};

export interface SceneDocument {
  /** Format marker for files exported to disk. */
  type?: 'inkflow';
  version: number;
  source?: string;
  elements: SceneElement[];
  appState: DocumentAppState;
  files: Record<string, FileMetadata>;
}

export const DOCUMENT_MIME_TYPE = 'application/vnd.inkflow+json';
export const DOCUMENT_FILE_EXTENSION = '.inkflow';
export const CLIPBOARD_MIME_TYPE = 'application/vnd.inkflow.clipboard+json';
