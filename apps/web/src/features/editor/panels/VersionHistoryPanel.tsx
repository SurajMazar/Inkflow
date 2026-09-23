import { ImageCache } from '@inkflow/renderer';
import { parseDocument } from '@inkflow/scene';
import type { BoardVersionDto, VersionComparisonDto, VersionKind } from '@inkflow/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  EmptyState,
  Input,
  Spinner,
  cn,
} from '@inkflow/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, GitCompare, History, RotateCcw, Save } from 'lucide-react';
import * as React from 'react';
import { api } from '@/lib/api';
import { formatDateTime, formatRelativeTime, pluralize } from '@/lib/format';
import { queryKeys } from '@/lib/query-keys';
import { notify, toastApiError } from '@/features/notifications/notify';
import { useBoardSession, useEditorState } from '../hooks/editor-context';
import { ScenePreview } from './ScenePreview';

const KIND_LABEL: Record<VersionKind, string> = {
  AUTO: 'Auto',
  MANUAL: 'Manual',
  RESTORE_BACKUP: 'Backup',
};

function VersionPreview({ version }: { version: BoardVersionDto }) {
  const { boardId, shareToken } = useBoardSession();
  const dark = useEditorState((s) => s.theme === 'dark');
  const [revision, setRevision] = React.useState(0);
  const detail = useQuery({
    queryKey: [...queryKeys.boards.versions(boardId), version.id],
    queryFn: ({ signal }) => api.versions.get(boardId, version.id, { shareToken, signal }),
    staleTime: Infinity,
  });
  const parsed = React.useMemo(() => {
    if (!detail.data) return null;
    try {
      return parseDocument(detail.data.document).document;
    } catch {
      return null;
    }
  }, [detail.data]);
  const [images, setImages] = React.useState<ImageCache | null>(null);
  React.useEffect(() => {
    const cache = new ImageCache({
      resolveUrl: (fileId) => api.files.contentUrl(fileId, shareToken),
      onLoad: () => setRevision((r) => r + 1),
      crossOrigin: 'use-credentials',
    });
    setImages(cache);
    return () => cache.dispose();
  }, [shareToken]);
  React.useEffect(() => {
    if (!parsed || !images) return;
    for (const el of parsed.elements)
      if (el.type === 'image' && el.fileId) images.ensure(el.fileId);
  }, [parsed, images]);

  if (detail.isPending) {
    return (
      <div
        className="flex h-40 items-center justify-center rounded-md border bg-muted/30"
        role="status"
      >
        <Spinner />
        <span className="sr-only">Loading preview…</span>
      </div>
    );
  }
  if (detail.isError || !parsed) {
    return (
      <div className="rounded-md border p-3 text-xs text-muted-foreground">
        The preview could not be loaded.
      </div>
    );
  }
  return (
    <ScenePreview
      elements={parsed.elements}
      width={264}
      height={160}
      padding={16}
      maxScale={2}
      images={images ?? undefined}
      revision={revision}
      dark={dark}
      background={parsed.appState.viewBackgroundColor ?? '#ffffff'}
      className="mx-auto rounded-md border bg-background"
      label={`Preview of ${version.label ?? `version ${version.number}`}`}
    />
  );
}

function CompareResult({
  result,
  onHighlight,
}: {
  result: VersionComparisonDto;
  onHighlight(ids: string[]): void;
}) {
  const { editor } = useBoardSession();
  const highlightable = [...result.added, ...result.modified].filter((id) => editor.getElement(id));
  const none = result.added.length + result.removed.length + result.modified.length === 0;
  return (
    <div
      className="space-y-2 rounded-md border bg-muted/30 p-2.5 text-xs"
      data-testid="version-compare-result"
    >
      {none ? (
        <p className="text-muted-foreground">No differences from the current board.</p>
      ) : (
        <p>
          Since this version:{' '}
          <span className="font-medium text-emerald-700 dark:text-emerald-400">
            {result.added.length} added
          </span>
          {' · '}
          <span className="font-medium text-destructive">{result.removed.length} removed</span>
          {' · '}
          <span className="font-medium text-amber-700 dark:text-amber-400">
            {result.modified.length} modified
          </span>
          <span className="text-muted-foreground"> · {result.unchangedCount} unchanged</span>
        </p>
      )}
      {highlightable.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => onHighlight(highlightable)}
        >
          Highlight {pluralize(highlightable.length, 'change')} on canvas
        </Button>
      )}
    </div>
  );
}

function VersionRow({
  version,
  canEdit,
  onRestore,
  onHighlight,
}: {
  version: BoardVersionDto;
  canEdit: boolean;
  onRestore(version: BoardVersionDto): void;
  onHighlight(ids: string[]): void;
}) {
  const { boardId, shareToken } = useBoardSession();
  const [preview, setPreview] = React.useState(false);
  const compare = useMutation({
    mutationFn: () => api.versions.compare(boardId, version.id, 'current', { shareToken }),
    onError: (error) => toastApiError(error, 'Could not compare versions'),
  });
  const title = version.label ?? `Version ${version.number}`;
  return (
    <li
      className="space-y-2 border-b px-3 py-3"
      data-testid="version-row"
      data-version-id={version.id}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium" title={title}>
              {title}
            </span>
            <Badge
              variant={version.kind === 'MANUAL' ? 'subtle' : 'outline'}
              className="text-[10px]"
            >
              {KIND_LABEL[version.kind]}
            </Badge>
          </div>
          <div
            className="mt-0.5 truncate text-xs text-muted-foreground"
            title={formatDateTime(version.createdAt)}
          >
            {version.createdBy ? `${version.createdBy.name} · ` : ''}
            {formatRelativeTime(version.createdAt)} · {pluralize(version.elementCount, 'element')}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant={preview ? 'secondary' : 'ghost'}
          className="h-7 px-2 text-xs"
          aria-expanded={preview}
          onClick={() => setPreview((p) => !p)}
        >
          <Eye className="size-3.5" /> Preview
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={compare.isPending}
          onClick={() => compare.mutate()}
          data-testid="version-compare"
        >
          {compare.isPending ? (
            <Spinner className="size-3.5" />
          ) : (
            <GitCompare className="size-3.5" />
          )}{' '}
          Compare
        </Button>
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => onRestore(version)}
            data-testid="version-restore"
          >
            <RotateCcw className="size-3.5" /> Restore
          </Button>
        )}
      </div>
      {preview && <VersionPreview version={version} />}
      {compare.data && <CompareResult result={compare.data} onHighlight={onHighlight} />}
    </li>
  );
}

/** Board versions: save, preview, compare with the current board, restore. */
export function VersionHistoryPanel() {
  const session = useBoardSession();
  const { editor, boardId, shareToken, canEdit } = session;
  const qc = useQueryClient();
  const [label, setLabel] = React.useState('');
  const [restoreTarget, setRestoreTarget] = React.useState<BoardVersionDto | null>(null);
  const highlighted = React.useRef(false);

  const versions = useQuery({
    queryKey: queryKeys.boards.versions(boardId),
    queryFn: ({ signal }) => api.versions.list(boardId, { shareToken, signal }),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.boards.versions(boardId) });

  const save = useMutation({
    mutationFn: () =>
      api.versions.create(boardId, label.trim() ? { label: label.trim() } : {}, { shareToken }),
    onSuccess: (v) => {
      setLabel('');
      notify.success(`Saved ${v.label ?? `version ${v.number}`}`);
      void invalidate();
    },
    onError: (error) => toastApiError(error, 'Could not save a version'),
  });

  const restore = useMutation({
    mutationFn: (version: BoardVersionDto) =>
      api.versions.restore(boardId, version.id, { shareToken }),
    onSuccess: async (_backup, version) => {
      await session.reload();
      notify.success(`Restored ${version.label ?? `version ${version.number}`}`, {
        description: 'The previous state was saved as a backup version.',
      });
      void invalidate();
    },
    onError: (error) => toastApiError(error, 'Could not restore the version'),
  });

  const highlight = (ids: string[]) => {
    highlighted.current = true;
    editor.setState({ searchHighlightIds: ids });
    editor.fitToElements(ids, 1);
  };

  React.useEffect(
    () => () => {
      if (highlighted.current) editor.setState({ searchHighlightIds: [] });
    },
    [editor],
  );

  return (
    <div data-testid="panel-versions" className="flex min-h-0 flex-1 flex-col">
      {canEdit && (
        <form
          className="flex gap-2 border-b p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending) save.mutate();
          }}
        >
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Version name (optional)"
            aria-label="Version name"
            maxLength={120}
            className="h-8 text-sm"
          />
          <Button type="submit" size="sm" disabled={save.isPending} data-testid="version-save">
            {save.isPending ? <Spinner className="size-3.5" /> : <Save />}
            Save
          </Button>
        </form>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {versions.isPending ? (
          <div className="flex justify-center py-10" role="status">
            <Spinner />
            <span className="sr-only">Loading versions…</span>
          </div>
        ) : versions.isError ? (
          <div className="space-y-2 p-4 text-center text-sm">
            <p className="text-muted-foreground">Version history could not be loaded.</p>
            <Button size="sm" variant="outline" onClick={() => void versions.refetch()}>
              Try again
            </Button>
          </div>
        ) : versions.data.length === 0 ? (
          <EmptyState
            size="sm"
            className="m-3"
            icon={<History />}
            title="No versions yet"
            description={
              canEdit
                ? 'Save a version to capture the current state of the board.'
                : 'Versions are saved automatically while people edit.'
            }
          />
        ) : (
          <ul
            className={cn(restore.isPending && 'pointer-events-none opacity-60')}
            aria-busy={restore.isPending}
          >
            {versions.data.map((v) => (
              <VersionRow
                key={v.id}
                version={v}
                canEdit={canEdit}
                onRestore={setRestoreTarget}
                onHighlight={highlight}
              />
            ))}
          </ul>
        )}
      </div>

      <AlertDialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <AlertDialogContent data-inkflow-ui>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              The board will be replaced with “
              {restoreTarget?.label ?? `Version ${restoreTarget?.number ?? ''}`}” for everyone. The
              current state is saved as a backup version first, so you can undo this later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="version-restore-confirm"
              onClick={() => {
                if (restoreTarget) restore.mutate(restoreTarget);
                setRestoreTarget(null);
              }}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
