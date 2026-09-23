import { readStorage, removeStorage, STORAGE_KEYS, writeStorage } from './storage';

/**
 * Share-link tokens are kept per board in sessionStorage (scoped to the tab, cleared when it
 * closes). The editor passes them to API calls (`{ shareToken }`) and WebSocket URLs.
 */
const keyFor = (boardId: string) => `${STORAGE_KEYS.shareTokenPrefix}${boardId}`;

export function setShareToken(boardId: string, token: string): void {
  writeStorage(keyFor(boardId), token, 'session');
}

export function getShareToken(boardId: string): string | null {
  const value = readStorage(keyFor(boardId), 'session');
  return value && value.length > 0 ? value : null;
}

export function clearShareToken(boardId: string): void {
  removeStorage(keyFor(boardId), 'session');
}
