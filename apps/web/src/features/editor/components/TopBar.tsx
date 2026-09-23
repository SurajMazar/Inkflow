import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@inkflow/ui';
import {
  ArrowLeft,
  Download,
  FileUp,
  Frame,
  History,
  Keyboard,
  Layers,
  Menu,
  MessageSquare,
  Moon,
  Play,
  Search,
  Share2,
  Sun,
  Command,
} from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';
import { ShareDialog } from '@/features/sharing/ShareDialog';
import { useTheme } from '@/features/theme/ThemeProvider';
import { useAuth } from '@/features/auth';
import { useBoardSession, useEditorState } from '../hooks/editor-context';
import { useEditorUi } from '../hooks/ui-store';
import { useIsCompact } from '../hooks/use-media-query';
import { CollaboratorsBar } from './CollaboratorsBar';
import { ColorPicker } from './ColorPicker';
import { SyncStatusBadge } from './SyncStatusBadge';

function BoardTitle() {
  const { board, canEdit, renameBoard } = useBoardSession();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(board.title);
  React.useEffect(() => setDraft(board.title), [board.title]);
  if (editing) {
    return (
      <Input
        autoFocus
        aria-label="Board title"
        data-testid="board-title-input"
        className="h-7 w-48 text-sm font-medium sm:w-64"
        value={draft}
        maxLength={200}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          void renameBoard(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(board.title);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      data-testid="board-title"
      disabled={!canEdit}
      onClick={() => setEditing(true)}
      className="max-w-[40vw] truncate rounded-md px-1.5 py-0.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent sm:max-w-xs"
      title={canEdit ? 'Rename board' : board.title}
    >
      {board.title}
    </button>
  );
}

function MainMenu() {
  const { editor, canEdit } = useBoardSession();
  const ui = useEditorUi();
  const grid = useEditorState((s) => s.grid);
  const snapping = useEditorState((s) => s.snapping);
  const zen = useEditorState((s) => s.zenMode);
  const background = useEditorState((s) => s.viewBackgroundColor);
  const showFrameNames = useEditorState((s) => s.showFrameNames);
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Board menu"
          data-testid="board-menu"
          className="size-8"
        >
          <Menu className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" data-inkflow-ui>
        <DropdownMenuItem onSelect={() => ui.openExport('board')} data-testid="menu-export">
          <Download /> Export…
          <DropdownMenuShortcut>⇧⌘E</DropdownMenuShortcut>
        </DropdownMenuItem>
        {canEdit && (
          <DropdownMenuItem onSelect={() => ui.openDialog('import')} data-testid="menu-import">
            <FileUp /> Import…
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => ui.togglePanel('versions')} data-testid="menu-versions">
          <History /> Version history
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => ui.togglePanel('layers')}>
          <Layers /> Layers
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => ui.togglePanel('frames')}>
          <Frame /> Frames & slides
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => ui.setPanel('search')}>
          <Search /> Find on canvas
          <DropdownMenuShortcut>⌘F</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Canvas</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64" data-inkflow-ui>
            <DropdownMenuCheckboxItem
              checked={grid.visible}
              onCheckedChange={() => editor.actions.run('view.toggleGrid')}
            >
              Show grid
            </DropdownMenuCheckboxItem>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Grid type
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={grid.type}
              onValueChange={(v) => {
                editor.setState({ grid: { ...grid, type: v as typeof grid.type, visible: true } });
                if (canEdit) editor.updateAppState({ gridType: v as typeof grid.type });
              }}
            >
              <DropdownMenuRadioItem value="dot">Dots</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="square">Squares</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="isometric">Isometric</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Grid size
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={String(grid.size)}
              onValueChange={(v) => {
                editor.setState({ grid: { ...grid, size: Number(v) } });
                if (canEdit) editor.updateAppState({ gridSize: Number(v) });
              }}
            >
              {[10, 20, 40, 80].map((n) => (
                <DropdownMenuRadioItem key={n} value={String(n)}>
                  {n}px
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={snapping.toObjects}
              onCheckedChange={() => editor.actions.run('view.toggleSnap')}
            >
              Snap to objects
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={snapping.toGrid}
              onCheckedChange={() => editor.actions.run('view.toggleGridSnap')}
            >
              Snap to grid
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={snapping.angle}
              onCheckedChange={() =>
                editor.setState({ snapping: { ...snapping, angle: !snapping.angle } })
              }
            >
              Angle snapping
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={showFrameNames}
              onCheckedChange={() => editor.actions.run('view.toggleFrameNames')}
            >
              Show frame names
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={zen}
              onCheckedChange={() => editor.actions.run('view.zenMode')}
            >
              Zen mode
            </DropdownMenuCheckboxItem>
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
                  <p className="mb-1.5 text-xs text-muted-foreground">Background</p>
                  <ColorPicker
                    label="Canvas background"
                    value={background}
                    quick={['#ffffff', '#f8f9fa', '#f5faff', '#fffce8', '#fdf8f6']}
                    onChange={(c) => editor.updateAppState({ viewBackgroundColor: c })}
                  />
                </div>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
          {resolvedTheme === 'dark' ? <Sun /> : <Moon />}{' '}
          {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
          <DropdownMenuShortcut>⌥⇧D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => ui.openDialog('command')}>
          <Command /> Command palette
          <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => ui.openDialog('shortcuts')} data-testid="menu-shortcuts">
          <Keyboard /> Keyboard shortcuts
          <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar() {
  const { editor, board, canEdit } = useBoardSession();
  const { user } = useAuth();
  const ui = useEditorUi();
  const compact = useIsCompact();
  const [shareOpen, setShareOpen] = React.useState(false);
  const dashboardHref = board.workspaceId && user ? `/w/${board.workspaceId}` : '/';
  return (
    <div className="flex items-start justify-between gap-2">
      <div
        className="pointer-events-auto flex min-w-0 items-center gap-1 rounded-xl border bg-popover/95 p-1 shadow-sm backdrop-blur"
        data-inkflow-ui
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Back to dashboard"
            >
              <Link to={dashboardHref} data-testid="back-to-dashboard">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Back to dashboard</TooltipContent>
        </Tooltip>
        <BoardTitle />
        <SyncStatusBadge />
      </div>

      <div
        className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-popover/95 p-1 shadow-sm backdrop-blur"
        data-inkflow-ui
      >
        <CollaboratorsBar />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn('size-8', ui.panel === 'comments' && 'bg-accent')}
              aria-label="Comments"
              aria-pressed={ui.panel === 'comments'}
              data-testid="toggle-comments"
              onClick={() => ui.togglePanel('comments')}
            >
              <MessageSquare className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Comments</TooltipContent>
        </Tooltip>
        {!compact && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Present frames"
                data-testid="present"
                onClick={() => editor.startPresentation()}
              >
                <Play className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Present (⌥P)</TooltipContent>
          </Tooltip>
        )}
        <MainMenu />
        {user && canEdit && (
          <Button
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setShareOpen(true)}
            data-testid="share-button"
          >
            <Share2 className="size-3.5" />
            {!compact && 'Share'}
          </Button>
        )}
      </div>
      {user && <ShareDialog boardId={board.id} open={shareOpen} onOpenChange={setShareOpen} />}
    </div>
  );
}
