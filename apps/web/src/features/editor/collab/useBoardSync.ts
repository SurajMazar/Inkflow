import type { CollaboratorView, Editor } from '@inkflow/canvas-engine';
import { CollabClient, CLOSE_CODES, type PeerPresence, type SyncStatus } from '@inkflow/collaboration';
import { changesToOperations, type SceneDocument } from '@inkflow/scene';
import { debounce } from '@inkflow/shared';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { useNavigate } from 'react-router';
import { api, refreshSession, websocketUrl } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { notify } from '@/features/notifications/notify';
import { localStore, pendingOpsStorage } from '../persistence/local-store';

export interface BoardSyncOptions {
  editor: Editor;
  boardId: string;
  seq: number;
  canEdit: boolean;
  shareToken: string | null;
  title: string;
  onTitleChange(title: string): void;
  onPermissionsChanged(): void;
  reload(): Promise<{ document: SceneDocument; seq: number } | null>;
}

const INITIAL_STATUS: SyncStatus = { connection: 'connecting', save: 'saved', pendingOps: 0, lastSavedAt: null, error: null };
const TRANSIENT_TIMEOUT_MS = 2500;

function toCollaborator(peer: PeerPresence): CollaboratorView {
  return {
    clientId: peer.clientId,
    userId: peer.user.id,
    name: peer.user.name,
    color: peer.user.color,
    avatarUrl: peer.user.avatarUrl,
    cursor: peer.state.cursor,
    selectedIds: peer.state.selectedIds ?? [],
    tool: peer.state.tool ?? 'selection',
    active: peer.state.active ?? false,
    editingId: peer.state.editingId ?? null,
    viewport: peer.state.viewport ?? null,
    anonymous: peer.user.anonymous,
  };
}

/**
 * Connects an editor to real-time collaboration and persistence:
 * local commits → operations (queued offline in IndexedDB) → WebSocket/HTTP → PostgreSQL,
 * server changes → rebased element states → editor, plus presence, live previews, snapshots.
 */
export function useBoardSync(options: BoardSyncOptions): { status: SyncStatus; client: CollabClient | null } {
  const { editor, boardId, canEdit, shareToken } = options;
  const [status, setStatus] = React.useState<SyncStatus>(INITIAL_STATUS);
  const [client, setClient] = React.useState<CollabClient | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const latest = React.useRef(options);
  latest.current = options;

  React.useEffect(() => {
    const transientByPeer = new Map<string, { ids: Set<string>; timer: ReturnType<typeof setTimeout> }>();
    let disposed = false;

    const revertTransient = (clientId: string) => {
      const entry = transientByPeer.get(clientId);
      if (!entry) return;
      clearTimeout(entry.timer);
      transientByPeer.delete(clientId);
      const restored = collab.getRebasedElements(entry.ids);
      if (restored.length) editor.applyRemoteElements(restored);
    };

    const saveSnapshot = debounce(() => {
      if (disposed) return;
      void localStore
        .saveSnapshot(boardId, editor.getDocument(), collab.currentSeq, latest.current.title)
        .catch((error: unknown) => console.warn('[inkflow] could not cache board locally', error));
    }, 1500);

    const collab = new CollabClient({
      boardId,
      clientId: editor.clientId,
      url: websocketUrl(boardId, shareToken),
      canEdit,
      initialSeq: latest.current.seq,
      initialElements: editor.scene.getElementsIncludingDeleted(),
      storage: pendingOpsStorage,
      http: {
        postOperations: (id, body) => api.boards.submitOperations(id, body, { shareToken }),
        getChanges: (id, since) => api.boards.changes(id, since, { shareToken }),
      },
      onElements: (elements) => {
        editor.applyRemoteElements(elements);
        saveSnapshot();
      },
      onTransient: (peerId, elements) => {
        editor.applyRemoteElements(elements);
        const existing = transientByPeer.get(peerId);
        if (existing) clearTimeout(existing.timer);
        const ids = existing?.ids ?? new Set<string>();
        for (const el of elements) ids.add(el.id);
        transientByPeer.set(peerId, { ids, timer: setTimeout(() => revertTransient(peerId), TRANSIENT_TIMEOUT_MS) });
      },
      onPeers: (peers) => {
        const present = new Set(peers.map((p) => p.clientId));
        for (const peerId of [...transientByPeer.keys()]) if (!present.has(peerId)) revertTransient(peerId);
        editor.setCollaborators(peers.map(toCollaborator));
      },
      onStatus: (s) => {
        if (!disposed) setStatus(s);
      },
      onEvent: (event) => {
        switch (event.kind) {
          case 'comments-changed':
            void queryClient.invalidateQueries({ queryKey: queryKeys.boards.comments(boardId) });
            break;
          case 'board-renamed':
            latest.current.onTitleChange(event.title);
            break;
          case 'permissions-changed':
            latest.current.onPermissionsChanged();
            break;
          case 'board-deleted':
            notify.warning('This board was moved to the trash by its owner.');
            navigate('/', { replace: true });
            break;
          case 'version-restored':
            notify.info('A previous version of this board was restored.');
            void resync();
            break;
        }
      },
      onResync: () => {
        void resync();
      },
      onRejected: (results) => {
        notify.error('Some changes could not be saved', { description: results[0]?.reason ?? 'The server rejected them.' });
      },
      onFatal: (code, message) => {
        if (code === CLOSE_CODES.UNAUTHORIZED) {
          void refreshSession();
          return;
        }
        if (code === CLOSE_CODES.NOT_FOUND || code === CLOSE_CODES.FORBIDDEN) {
          notify.error('You no longer have access to this board.');
          navigate('/', { replace: true });
          return;
        }
        if (code === CLOSE_CODES.BOARD_DELETED) {
          notify.warning('This board was deleted.');
          navigate('/', { replace: true });
          return;
        }
        notify.error('Collaboration disconnected', { description: message });
      },
    });

    const resync = async () => {
      const fresh = await latest.current.reload();
      if (fresh && !disposed) collab.resetBase(fresh.document.elements, fresh.seq);
    };

    const offCommit = editor.events.on('commit', (tx) => {
      const ops = changesToOperations(tx.changes, (baseVersion) => collab.nextMeta(baseVersion));
      collab.submit(ops);
      saveSnapshot();
    });
    const offTransient = editor.events.on('transient', (elements) => collab.sendTransient(elements));
    const offPresence = editor.events.on('presence', (state) => collab.updatePresence(state));
    const persistAppState = debounce(() => {
      if (!latest.current.canEdit) return;
      api.boards
        .update(boardId, { appState: { ...editor.appState } }, { shareToken })
        .catch((error: unknown) => console.warn('[inkflow] could not save board settings', error));
    }, 600);
    const offAppState = editor.events.on('appState', () => persistAppState());

    void collab.start();
    setClient(collab);

    const flushOnHide = () => {
      if (document.visibilityState === 'hidden') saveSnapshot.flush();
    };
    document.addEventListener('visibilitychange', flushOnHide);
    window.addEventListener('pagehide', saveSnapshot.flush);

    return () => {
      disposed = true;
      saveSnapshot.flush();
      persistAppState.flush();
      offCommit();
      offTransient();
      offPresence();
      offAppState();
      document.removeEventListener('visibilitychange', flushOnHide);
      window.removeEventListener('pagehide', saveSnapshot.flush);
      for (const entry of transientByPeer.values()) clearTimeout(entry.timer);
      collab.stop();
      setClient(null);
    };
    // The client lives for the lifetime of the board session; permission changes update it in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, boardId, shareToken]);

  React.useEffect(() => {
    client?.setCanEdit(canEdit);
  }, [client, canEdit]);

  // Warn before leaving while changes are only stored locally.
  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (status.pendingOps > 0 && status.connection === 'online') {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [status.pendingOps, status.connection]);

  return { status, client };
}
