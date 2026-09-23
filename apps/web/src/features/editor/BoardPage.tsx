import { DEFAULT_STYLE, Editor, type UiRequest } from '@inkflow/canvas-engine';
import { FONT_FAMILIES } from '@inkflow/elements';
import { parseDocument, type SceneDocument } from '@inkflow/scene';
import { ApiError, canEditBoard, type BoardDetailDto, type BoardSummaryDto } from '@inkflow/shared';
import { Button, Spinner } from '@inkflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { getShareToken } from '@/lib/share-token';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useAuth, usePreferences } from '@/features/auth';
import { describeApiError, notify, toastApiError } from '@/features/notifications/notify';
import { useTheme } from '@/features/theme/ThemeProvider';
import { createEditorHost, uploadBoardImage } from './collab/editor-host';
import { useBoardSync } from './collab/useBoardSync';
import { useThumbnail } from './collab/useThumbnail';
import { EditorShell } from './components/EditorShell';
import { BoardSessionProvider, type BoardSession } from './hooks/editor-context';
import { useEditorUi } from './hooks/ui-store';
import { localStore } from './persistence/local-store';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; title: string; description: string; code: string | null }
  | { status: 'ready'; detail: BoardDetailDto; document: SceneDocument; offline: boolean };

const FONT_LOAD_TIMEOUT_MS = 2500;

/** Ensures the canvas fonts are loaded so text measures correctly on first paint. */
async function loadCanvasFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const loads = Object.values(FONT_FAMILIES).flatMap((f) => [
    document.fonts.load(`20px ${f.css}`),
    document.fonts.load(`bold 20px ${f.css}`),
  ]);
  await Promise.race([Promise.allSettled(loads), new Promise((r) => setTimeout(r, FONT_LOAD_TIMEOUT_MS))]);
}

async function loadBoard(boardId: string, shareToken: string | null): Promise<LoadState> {
  const fonts = loadCanvasFonts();
  try {
    const detail = await api.boards.get(boardId, { shareToken });
    const parsed = parseDocument(detail.document);
    if (parsed.issues.length) console.warn('[inkflow] document issues', parsed.issues);
    await fonts;
    return { status: 'ready', detail, document: parsed.document, offline: false };
  } catch (error) {
    const offline = error instanceof ApiError && error.code === 'SERVICE_UNAVAILABLE';
    if (offline) {
      const cached = await localStore.loadSnapshot(boardId).catch(() => null);
      if (cached) {
        await fonts;
        const parsed = parseDocument(cached.document);
        const now = new Date(cached.savedAt).toISOString();
        const board: BoardSummaryDto = {
          id: boardId,
          workspaceId: '',
          projectId: null,
          folderId: null,
          title: cached.title,
          role: 'EDITOR',
          workspaceAccess: 'NONE',
          isFavorite: false,
          thumbnailUrl: null,
          owner: { id: '', name: '', email: '', avatarUrl: null },
          elementCount: parsed.document.elements.length,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          lastViewedAt: null,
        };
        return {
          status: 'ready',
          detail: {
            board,
            document: { ...cached.document, appState: { ...cached.document.appState } },
            seq: cached.seq,
            viaShareLink: !!shareToken,
          },
          document: parsed.document,
          offline: true,
        };
      }
    }
    const { title, description } = describeApiError(error, 'This board could not be opened');
    return {
      status: 'error',
      title,
      description: description ?? 'Please try again.',
      code: error instanceof ApiError ? error.code : null,
    };
  }
}

export default function BoardPage() {
  const { boardId = '' } = useParams();
  const shareToken = getShareToken(boardId);
  const [state, setState] = React.useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    void loadBoard(boardId, shareToken).then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [boardId, shareToken, attempt]);

  useDocumentTitle(state.status === 'ready' ? state.detail.board.title : 'Board');

  if (state.status === 'loading') {
    return (
      <div className="flex h-dvh items-center justify-center bg-background" role="status" aria-live="polite">
        <Spinner />
        <span className="sr-only">Loading board…</span>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <h1 className="text-xl font-semibold">{state.title}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{state.description}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </Button>
          <Button asChild>
            <Link to="/">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }
  return (
    <EditorRoot
      key={`${boardId}:${attempt}`}
      detail={state.detail}
      document={state.document}
      offline={state.offline}
      shareToken={shareToken}
    />
  );
}

function EditorRoot({
  detail,
  document: initialDocument,
  offline,
  shareToken,
}: {
  detail: BoardDetailDto;
  document: SceneDocument;
  offline: boolean;
  shareToken: string | null;
}) {
  const boardId = detail.board.id;
  const { user } = useAuth();
  const { preferences, updatePreferences } = usePreferences();
  const { resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [board, setBoard] = React.useState<BoardSummaryDto>(detail.board);
  const role = board.role;
  const canEdit = canEditBoard(role);
  const canComment = !!user;
  const resetUi = useEditorUi((s) => s.reset);

  const uiHandler = React.useRef<(r: UiRequest) => void>(() => undefined);
  const [editor] = React.useState(() => {
    const ed: Editor = new Editor({
      host: createEditorHost(
        boardId,
        shareToken,
        {
          onUiRequest: (r) => uiHandler.current(r),
          onError: (error, context) => toastApiError(error, context),
        },
        () => ed.files,
      ),
      initialState: {
        readOnly: !canEditBoard(detail.board.role),
        theme: resolvedTheme,
        grid: {
          visible: preferences.grid.enabled,
          type: initialDocument.appState.gridType ?? preferences.grid.type,
          size: initialDocument.appState.gridSize ?? preferences.grid.size,
        },
        snapping: { ...preferences.snapping },
        penMode: preferences.canvas.penMode,
        zoomWithWheel: preferences.canvas.zoomWithWheel,
        style: {
          ...DEFAULT_STYLE,
          strokeColor: preferences.defaultStyles.strokeColor,
          backgroundColor: preferences.defaultStyles.backgroundColor,
          strokeWidth: preferences.defaultStyles.strokeWidth,
          roughness: preferences.defaultStyles.roughness,
          fontFamily: (['hand', 'sans', 'serif', 'mono'].includes(preferences.defaultStyles.fontFamily)
            ? preferences.defaultStyles.fontFamily
            : 'hand') as 'hand',
          fontSize: preferences.defaultStyles.fontSize,
        },
      },
    });
    ed.loadDocument(initialDocument, { fit: false });
    return ed;
  });

  // Development/E2E inspection hook (never enabled in production builds).
  React.useEffect(() => {
    if (!import.meta.env.DEV && import.meta.env.VITE_E2E !== '1') return;
    const w = window as unknown as { __inkflow?: { editor: Editor; boardId: string } };
    w.__inkflow = { editor, boardId };
    return () => {
      if (w.__inkflow?.editor === editor) delete w.__inkflow;
    };
  }, [editor, boardId]);

  // Fit the content once the canvas has a size.
  React.useEffect(() => {
    const id = requestAnimationFrame(() => editor.fitToContent());
    return () => cancelAnimationFrame(id);
  }, [editor]);

  React.useEffect(() => () => {
    editor.destroy();
    resetUi();
  }, [editor, resetUi]);

  React.useEffect(() => {
    editor.setState({ readOnly: !canEdit });
    if (!canEdit && editor.state.tool !== 'selection' && editor.state.tool !== 'hand') editor.setTool('selection');
  }, [editor, canEdit]);

  React.useEffect(() => {
    editor.setState({ theme: resolvedTheme });
  }, [editor, resolvedTheme]);

  React.useEffect(() => {
    editor.shortcuts.setOverrides(preferences.shortcuts);
    editor.setState({ penMode: preferences.canvas.penMode, zoomWithWheel: preferences.canvas.zoomWithWheel });
  }, [editor, preferences.shortcuts, preferences.canvas.penMode, preferences.canvas.zoomWithWheel]);

  // Persist grid/snapping toggles made inside the editor to the user's preferences.
  React.useEffect(() => {
    let prev = editor.state;
    return editor.store.subscribe((s) => {
      if (s.grid.visible !== prev.grid.visible || s.snapping !== prev.snapping) {
        void updatePreferences(
          { grid: { ...preferences.grid, enabled: s.grid.visible }, snapping: { ...s.snapping } },
          { silent: true },
        );
      }
      prev = s;
    });
  }, [editor, preferences.grid, updatePreferences]);

  const reload = React.useCallback(async () => {
    try {
      const fresh = await api.boards.get(boardId, { shareToken });
      const parsed = parseDocument(fresh.document);
      editor.loadDocument(parsed.document, { keepHistory: false });
      setBoard(fresh.board);
      return { document: parsed.document, seq: fresh.seq };
    } catch (error) {
      toastApiError(error, 'Could not reload the board');
      return null;
    }
  }, [boardId, editor, shareToken]);

  const renameBoard = React.useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed || trimmed === board.title) return;
      const previous = board.title;
      setBoard((b) => ({ ...b, title: trimmed }));
      try {
        const updated = await api.boards.update(boardId, { title: trimmed }, { shareToken });
        setBoard(updated);
        void queryClient.invalidateQueries({ queryKey: queryKeys.boards.lists });
      } catch (error) {
        setBoard((b) => ({ ...b, title: previous }));
        toastApiError(error, 'Could not rename the board');
      }
    },
    [board.title, boardId, queryClient, shareToken],
  );

  const onPermissionsChanged = React.useCallback(() => {
    api.boards
      .get(boardId, { shareToken })
      .then((fresh) => {
        setBoard(fresh.board);
        notify.info(`Your access changed: ${fresh.board.role.toLowerCase()}`);
      })
      .catch(() => {
        notify.error('You no longer have access to this board.');
        navigate('/', { replace: true });
      });
  }, [boardId, navigate, shareToken]);

  const { status } = useBoardSync({
    editor,
    boardId,
    seq: detail.seq,
    canEdit,
    shareToken,
    title: board.title,
    onTitleChange: (title) => setBoard((b) => ({ ...b, title })),
    onPermissionsChanged,
    reload,
  });

  useThumbnail(editor, boardId, canEdit && !offline, shareToken);

  // Resume uploads that were queued while offline (e.g. after a reload).
  React.useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    void localStore.listUploads(boardId).then((uploads) => {
      for (const u of uploads) {
        if (cancelled) return;
        const url = URL.createObjectURL(u.blob);
        const img = new Image();
        img.onload = () => editor.images.set(u.fileId, img);
        img.src = url;
        void uploadBoardImage(boardId, shareToken, u.blob, u.fileId, u.name)
          .then((meta) => editor.registerFile(meta))
          .catch((error: unknown) => toastApiError(error, 'An image could not be uploaded'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [boardId, canEdit, editor, shareToken]);

  // Route engine UI requests to the chrome.
  uiHandler.current = (request: UiRequest) => {
    const ui = useEditorUi.getState();
    switch (request.type) {
      case 'shortcuts':
        return ui.openDialog('shortcuts');
      case 'command-palette':
        return ui.openDialog('command');
      case 'find':
        return ui.setPanel('search');
      case 'library':
        return ui.togglePanel('library');
      case 'export':
        return ui.openExport(request.scope, request.frameId ?? null);
      case 'auto-layout':
        return ui.openDialog('autolayout');
      case 'comment':
        if (!canComment) {
          notify.info('Sign in to leave comments.');
          return;
        }
        return ui.startComment({ world: request.world, elementId: request.elementId });
      case 'structured-edit':
        return ui.setPanel('structure');
      case 'present':
        editor.startPresentation();
        return;
      case 'toggle-theme':
        setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
        return;
      case 'link':
        return ui.openLink(request.elementId);
      case 'toast':
        if (request.level === 'error') notify.error(request.message);
        else if (request.level === 'success') notify.success(request.message);
        else notify.info(request.message);
        return;
    }
  };

  const session: BoardSession = React.useMemo(
    () => ({
      editor,
      boardId,
      board,
      role,
      canEdit,
      canComment,
      shareToken,
      sync: status,
      offlineCopy: offline,
      renameBoard,
      reload: async () => {
        await reload();
      },
    }),
    [editor, boardId, board, role, canEdit, canComment, shareToken, status, offline, renameBoard, reload],
  );

  return (
    <BoardSessionProvider value={session}>
      <EditorShell />
    </BoardSessionProvider>
  );
}
