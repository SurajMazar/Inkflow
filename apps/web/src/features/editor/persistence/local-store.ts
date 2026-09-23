import type { Operation, SceneDocument } from '@inkflow/scene';
import type { CollabStorage } from '@inkflow/collaboration';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * Browser-side persistence (IndexedDB): the last known document per board (fast startup and
 * offline opening), unsent operations (offline editing) and queued image uploads.
 */
interface InkflowDB extends DBSchema {
  documents: {
    key: string;
    value: {
      boardId: string;
      document: SceneDocument;
      seq: number;
      title: string;
      savedAt: number;
    };
  };
  pendingOps: {
    key: string;
    value: { boardId: string; ops: Operation[]; updatedAt: number };
  };
  uploads: {
    key: string;
    value: {
      fileId: string;
      boardId: string;
      blob: Blob;
      name: string;
      type: string;
      createdAt: number;
    };
    indexes: { byBoard: string };
  };
}

const DB_NAME = 'inkflow';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<InkflowDB> | null> | null = null;

function db(): Promise<IDBPDatabase<InkflowDB> | null> {
  if (!dbPromise) {
    dbPromise = (async () => {
      if (typeof indexedDB === 'undefined') return null;
      try {
        return await openDB<InkflowDB>(DB_NAME, DB_VERSION, {
          upgrade(database) {
            if (!database.objectStoreNames.contains('documents'))
              database.createObjectStore('documents', { keyPath: 'boardId' });
            if (!database.objectStoreNames.contains('pendingOps'))
              database.createObjectStore('pendingOps', { keyPath: 'boardId' });
            if (!database.objectStoreNames.contains('uploads')) {
              const store = database.createObjectStore('uploads', { keyPath: 'fileId' });
              store.createIndex('byBoard', 'boardId');
            }
          },
        });
      } catch (error) {
        console.warn('[inkflow] IndexedDB unavailable; offline persistence disabled', error);
        return null;
      }
    })();
  }
  return dbPromise;
}

// In-memory fallback so the app keeps working (without durability) when IndexedDB is blocked.
const memoryPending = new Map<string, Operation[]>();

export const localStore = {
  async saveSnapshot(
    boardId: string,
    document: SceneDocument,
    seq: number,
    title: string,
  ): Promise<void> {
    const d = await db();
    if (!d) return;
    await d.put('documents', { boardId, document, seq, title, savedAt: Date.now() });
  },

  async loadSnapshot(boardId: string) {
    const d = await db();
    if (!d) return null;
    return (await d.get('documents', boardId)) ?? null;
  },

  async deleteBoard(boardId: string): Promise<void> {
    const d = await db();
    memoryPending.delete(boardId);
    if (!d) return;
    const tx = d.transaction(['documents', 'pendingOps', 'uploads'], 'readwrite');
    await tx.objectStore('documents').delete(boardId);
    await tx.objectStore('pendingOps').delete(boardId);
    const uploads = await tx.objectStore('uploads').index('byBoard').getAllKeys(boardId);
    for (const key of uploads) await tx.objectStore('uploads').delete(key);
    await tx.done;
  },

  async queueUpload(entry: {
    fileId: string;
    boardId: string;
    blob: Blob;
    name: string;
    type: string;
  }): Promise<void> {
    const d = await db();
    if (!d) return;
    await d.put('uploads', { ...entry, createdAt: Date.now() });
  },

  async listUploads(boardId: string) {
    const d = await db();
    if (!d) return [];
    return d.getAllFromIndex('uploads', 'byBoard', boardId);
  },

  async getUpload(fileId: string) {
    const d = await db();
    if (!d) return null;
    return (await d.get('uploads', fileId)) ?? null;
  },

  async removeUpload(fileId: string): Promise<void> {
    const d = await db();
    if (!d) return;
    await d.delete('uploads', fileId);
  },
};

/** Durable queue of unsent collaboration operations. */
export const pendingOpsStorage: CollabStorage = {
  async loadPending(boardId) {
    const d = await db();
    if (!d) return memoryPending.get(boardId) ?? [];
    return (await d.get('pendingOps', boardId))?.ops ?? [];
  },
  async savePending(boardId, ops) {
    const d = await db();
    if (!d) {
      memoryPending.set(boardId, [...ops]);
      return;
    }
    if (ops.length === 0) await d.delete('pendingOps', boardId);
    else await d.put('pendingOps', { boardId, ops: [...ops], updatedAt: Date.now() });
  },
};
