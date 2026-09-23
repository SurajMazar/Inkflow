import { readStorage, removeStorage, STORAGE_KEYS, writeStorage } from '@/lib/storage';

/** Id of the workspace the user last opened (restored when visiting `/`). */
export function getLastWorkspaceId(): string | null {
  return readStorage(STORAGE_KEYS.lastWorkspace);
}

export function setLastWorkspaceId(workspaceId: string): void {
  writeStorage(STORAGE_KEYS.lastWorkspace, workspaceId);
}

export function clearLastWorkspaceId(): void {
  removeStorage(STORAGE_KEYS.lastWorkspace);
}
