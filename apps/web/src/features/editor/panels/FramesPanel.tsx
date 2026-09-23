import type { FrameElement } from '@inkflow/elements';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  cn,
} from '@inkflow/ui';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Ellipsis,
  Focus,
  Frame,
  GripVertical,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import { useBoardSession, useEditorState } from '../hooks/editor-context';
import { useEditorUi } from '../hooks/ui-store';

const FRAME_DRAG_MIME = 'application/x-inkflow-frame';

function useOrderedFrames(): FrameElement[] {
  const { editor } = useBoardSession();
  const version = useEditorState((s) => s.sceneVersion);
  const order = useEditorState((s) => s.frameOrder);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useMemo(() => editor.getOrderedFrames(), [editor, version, order]);
}

function FrameNameInput({ frame, onDone }: { frame: FrameElement; onDone(): void }) {
  const { editor } = useBoardSession();
  const [value, setValue] = React.useState(frame.name);
  const done = React.useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const name = value.trim();
    if (name && name !== frame.name) editor.updateElements([[frame.id, { name }]], 'Rename frame');
    onDone();
  };
  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          done.current = true;
          onDone();
        }
      }}
      aria-label="Frame name"
      data-testid="frame-name-input"
      maxLength={200}
      className="h-7 text-sm"
    />
  );
}

function FrameRow({
  frame,
  index,
  count,
  canEdit,
  dragOver,
  onDelete,
  onDragState,
}: {
  frame: FrameElement;
  index: number;
  count: number;
  canEdit: boolean;
  dragOver: 'before' | 'after' | null;
  onDelete(frame: FrameElement): void;
  onDragState(state: { id: string; position: 'before' | 'after' } | null): void;
}) {
  const { editor } = useBoardSession();
  const openExport = useEditorUi((s) => s.openExport);
  const selected = useEditorState((s) => s.selectedIds.includes(frame.id));
  const [renaming, setRenaming] = React.useState(false);
  const name = frame.name || `Frame ${index + 1}`;

  const zoomTo = () => {
    editor.select([frame.id], { expandGroups: false });
    editor.actions.run('frame.zoomTo', { frameId: frame.id });
  };

  return (
    <li
      data-testid="frame-row"
      data-frame-id={frame.id}
      draggable={canEdit && !renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData(FRAME_DRAG_MIME, frame.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (!canEdit || !e.dataTransfer.types.includes(FRAME_DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = e.currentTarget.getBoundingClientRect();
        onDragState({
          id: frame.id,
          position: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
        });
      }}
      onDragLeave={() => onDragState(null)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(FRAME_DRAG_MIME);
        onDragState(null);
        if (!id || id === frame.id) return;
        e.preventDefault();
        const order = editor
          .getOrderedFrames()
          .map((f) => f.id)
          .filter((f) => f !== id);
        const target = order.indexOf(frame.id);
        const rect = e.currentTarget.getBoundingClientRect();
        const after = e.clientY >= rect.top + rect.height / 2;
        editor.reorderFrame(id, target + (after ? 1 : 0));
      }}
      className={cn(
        'group relative flex items-center gap-1.5 border-b px-2 py-1.5',
        selected ? 'bg-primary/10' : 'hover:bg-accent/40',
        dragOver === 'before' && 'shadow-[inset_0_2px_0_0_var(--color-primary)]',
        dragOver === 'after' && 'shadow-[inset_0_-2px_0_0_var(--color-primary)]',
      )}
    >
      {canEdit && (
        <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
      )}
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        {renaming ? (
          <FrameNameInput frame={frame} onDone={() => setRenaming(false)} />
        ) : (
          <button
            type="button"
            className="w-full truncate rounded px-1 py-0.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={zoomTo}
            onDoubleClick={() => canEdit && setRenaming(true)}
            title={canEdit ? 'Click to zoom, double-click to rename' : 'Zoom to frame'}
          >
            {name}
          </button>
        )}
      </div>
      {canEdit && (
        <div className="flex shrink-0">
          <button
            type="button"
            aria-label={`Move ${name} up`}
            data-testid="frame-move-up"
            disabled={index === 0}
            onClick={() => editor.reorderFrame(frame.id, index - 1)}
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <ChevronUp className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Move ${name} down`}
            data-testid="frame-move-down"
            disabled={index === count - 1}
            onClick={() => editor.reorderFrame(frame.id, index + 1)}
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${name} actions`}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Ellipsis className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-inkflow-ui>
          <DropdownMenuItem onSelect={zoomTo}>
            <Focus /> Zoom to frame
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editor.startPresentation(frame.id)}>
            <Play /> Present from here
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openExport('frame', frame.id)}>
            <Download /> Export frame…
          </DropdownMenuItem>
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Pencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onDelete(frame)}
                className="text-destructive focus:text-destructive"
                disabled={frame.locked}
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** Frames in presentation order: rename, reorder, zoom, present, export, delete. */
export function FramesPanel() {
  const { editor, canEdit } = useBoardSession();
  const frames = useOrderedFrames();
  const [dragState, setDragState] = React.useState<{
    id: string;
    position: 'before' | 'after';
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<FrameElement | null>(null);
  const childCount = deleteTarget
    ? editor.getElements().filter((e) => e.frameId === deleteTarget.id).length
    : 0;

  return (
    <div data-testid="panel-frames" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {frames.length} {frames.length === 1 ? 'frame' : 'frames'}
        </span>
        <div className="flex gap-1">
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => editor.setTool('frame')}
            >
              <Frame className="size-3.5" /> New frame
            </Button>
          )}
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={frames.length === 0}
            onClick={() => editor.startPresentation()}
            data-testid="frames-present"
          >
            <Play className="size-3.5" /> Present
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {frames.length === 0 ? (
          <EmptyState
            size="sm"
            className="m-3"
            icon={<Frame />}
            title="No frames yet"
            description={
              canEdit
                ? 'Draw a frame (F) around content to use it as a slide or export area.'
                : 'This board has no frames.'
            }
          />
        ) : (
          <ul aria-label="Frames in presentation order">
            {frames.map((f, i) => (
              <FrameRow
                key={f.id}
                frame={f}
                index={i}
                count={frames.length}
                canEdit={canEdit}
                dragOver={dragState?.id === f.id ? dragState.position : null}
                onDelete={setDeleteTarget}
                onDragState={setDragState}
              />
            ))}
          </ul>
        )}
      </div>
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent data-inkflow-ui>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name || 'frame'}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {childCount > 0
                ? `The frame and the ${childCount} ${childCount === 1 ? 'element' : 'elements'} inside it will be deleted. You can undo this.`
                : 'The frame will be deleted. You can undo this.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteTarget) editor.deleteElements([deleteTarget.id], 'Delete frame');
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
