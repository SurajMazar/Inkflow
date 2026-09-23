import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@inkflow/ui';
import { Minus, Palette, Plus, Redo2, Undo2 } from 'lucide-react';
import { useBoardSession, useEditorState } from '../hooks/editor-context';
import { useEditorUi } from '../hooks/ui-store';

export function BottomBar({ compact }: { compact: boolean }) {
  const { editor, canEdit } = useBoardSession();
  const zoom = useEditorState((s) => s.viewport.zoom);
  const canUndo = useEditorState((s) => s.canUndo);
  const canRedo = useEditorState((s) => s.canRedo);
  const hasSelection = useEditorState((s) => s.selectedIds.length > 0);
  const setMobileProps = useEditorUi((s) => s.setMobilePropertiesOpen);
  return (
    <div className="flex items-end justify-between gap-2">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border bg-popover/95 p-1 shadow-sm backdrop-blur" data-inkflow-ui>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Zoom out" data-testid="zoom-out" onClick={() => editor.zoomOut()}>
              <Minus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom out (⌘−)</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 min-w-14 px-2 text-xs tabular-nums" aria-label="Zoom options" data-testid="zoom-level">
              {Math.round(zoom * 100)}%
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" data-inkflow-ui>
            <DropdownMenuItem onSelect={() => editor.fitToContent()}>
              Zoom to fit all <DropdownMenuShortcut>⇧1</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => editor.fitToSelection()} disabled={!hasSelection}>
              Zoom to selection <DropdownMenuShortcut>⇧2</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {[0.5, 1, 2].map((z) => (
              <DropdownMenuItem key={z} onSelect={() => editor.zoomAt(z)}>
                {z * 100}%{z === 1 && <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Zoom in" data-testid="zoom-in" onClick={() => editor.zoomIn()}>
              <Plus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom in (⌘+)</TooltipContent>
        </Tooltip>
      </div>

      {canEdit && (
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border bg-popover/95 p-1 shadow-sm backdrop-blur" data-inkflow-ui>
          {compact && (
            <Button variant="ghost" size="icon" className="size-8" aria-label="Style" onClick={() => setMobileProps(true)} data-testid="mobile-style">
              <Palette className="size-4" />
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Undo" data-testid="undo" disabled={!canUndo} onClick={() => editor.undo()}>
                <Undo2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo (⌘Z)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Redo" data-testid="redo" disabled={!canRedo} onClick={() => editor.redo()}>
                <Redo2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo (⇧⌘Z)</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
