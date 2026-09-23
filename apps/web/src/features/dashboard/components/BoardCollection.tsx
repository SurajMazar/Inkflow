import * as React from 'react';
import { ArrowDownUp, LayoutGrid, List, Search } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Input,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from '@inkflow/ui';
import type { BoardSummaryDto } from '@inkflow/shared';
import { readStorage, STORAGE_KEYS, writeStorage } from '@/lib/storage';
import { pluralize } from '@/lib/format';
import { BoardCard, BoardRow } from './BoardCard';

export type BoardSort = 'activity' | 'updated' | 'created' | 'title';
export type BoardViewMode = 'grid' | 'list';

const SORT_LABELS: Record<BoardSort, string> = {
  activity: 'Recent activity',
  updated: 'Last modified',
  created: 'Date created',
  title: 'Title (A–Z)',
};

function activityTime(board: BoardSummaryDto): number {
  const updated = Date.parse(board.updatedAt) || 0;
  const viewed = board.lastViewedAt ? Date.parse(board.lastViewedAt) || 0 : 0;
  return Math.max(updated, viewed);
}

/** Sorts boards (stable, returns a new array). */
export function sortBoards(boards: readonly BoardSummaryDto[], sort: BoardSort): BoardSummaryDto[] {
  const list = [...boards];
  switch (sort) {
    case 'title':
      return list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
    case 'updated':
      return list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    case 'created':
      return list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    case 'activity':
    default:
      return list.sort((a, b) => activityTime(b) - activityTime(a));
  }
}

function useViewMode(): [BoardViewMode, (mode: BoardViewMode) => void] {
  const [mode, setMode] = React.useState<BoardViewMode>(() =>
    readStorage(STORAGE_KEYS.boardViewMode) === 'list' ? 'list' : 'grid',
  );
  const update = React.useCallback((next: BoardViewMode) => {
    setMode(next);
    writeStorage(STORAGE_KEYS.boardViewMode, next);
  }, []);
  return [mode, update];
}

export interface BoardCollectionProps {
  boards: BoardSummaryDto[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
  workspaceId: string;
  /** Rendered when the collection is empty (before filtering). */
  emptyState: React.ReactNode;
  defaultSort?: BoardSort;
  /** Accessible label of the list (e.g. "Favorite boards"). */
  label: string;
  /** Hide the toolbar (filter/sort/view). */
  hideToolbar?: boolean;
  /** Maximum boards to show (e.g. a preview section). */
  limit?: number;
}

/** Board grid/list with filter, sort and view toggle; handles loading, error and empty states. */
export function BoardCollection({
  boards,
  isLoading,
  isError,
  onRetry,
  workspaceId,
  emptyState,
  defaultSort = 'activity',
  label,
  hideToolbar,
  limit,
}: BoardCollectionProps) {
  const [filter, setFilter] = React.useState('');
  const [sort, setSort] = React.useState<BoardSort>(defaultSort);
  const [view, setView] = useViewMode();
  const filterId = React.useId();

  const visible = React.useMemo(() => {
    if (!boards) return [];
    const needle = filter.trim().toLowerCase();
    const filtered = needle ? boards.filter((b) => b.title.toLowerCase().includes(needle)) : boards;
    const sorted = sortBoards(filtered, sort);
    return limit ? sorted.slice(0, limit) : sorted;
  }, [boards, filter, sort, limit]);

  if (isError && !boards) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center" role="alert">
        <p className="text-sm font-medium">Couldn't load boards</p>
        <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  const toolbar = hideToolbar ? null : (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-40 flex-1 sm:max-w-64">
        <label htmlFor={filterId} className="sr-only">
          Filter boards by title
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id={filterId}
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter boards"
          className="h-8 pl-8 text-[13px]"
          data-testid="board-filter"
        />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground" data-testid="board-sort">
              <ArrowDownUp aria-hidden />
              <span className="hidden sm:inline">{SORT_LABELS[sort]}</span>
              <span className="sr-only sm:hidden">Sort: {SORT_LABELS[sort]}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sort} onValueChange={(value) => setSort(value as BoardSort)}>
              {(Object.keys(SORT_LABELS) as BoardSort[]).map((key) => (
                <DropdownMenuRadioItem key={key} value={key}>
                  {SORT_LABELS[key]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <ToggleGroup
          type="single"
          size="sm"
          value={view}
          onValueChange={(value) => value && setView(value as BoardViewMode)}
          aria-label="View"
        >
          <ToggleGroupItem value="grid" aria-label="Grid view" data-testid="view-grid">
            <LayoutGrid aria-hidden />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="List view" data-testid="view-list">
            <List aria-hidden />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (isLoading && !boards) {
    body = (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4" aria-busy="true" aria-label="Loading boards">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border">
            <Skeleton className="aspect-[16/10] rounded-none" />
            <div className="grid gap-2 p-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (!boards || boards.length === 0) {
    body = emptyState;
  } else if (visible.length === 0) {
    body = (
      <div className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
        No boards match “{filter}”.{' '}
        <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={() => setFilter('')}>
          Clear filter
        </button>
      </div>
    );
  } else if (view === 'list') {
    body = (
      <div className="overflow-hidden rounded-xl border">
        <div
          aria-hidden
          className="hidden grid-cols-[56px_minmax(0,1fr)_160px_120px_auto] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid"
        >
          <span />
          <span>Name</span>
          <span>Owner</span>
          <span>Modified</span>
          <span className="w-[72px]" />
        </div>
        <ul className="divide-y" aria-label={label} data-testid="board-list">
          {visible.map((board) => (
            <BoardRow key={board.id} board={board} workspaceId={workspaceId} />
          ))}
        </ul>
      </div>
    );
  } else {
    body = (
      <ul
        className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4"
        aria-label={label}
        data-testid="board-grid"
      >
        {visible.map((board) => (
          <li key={board.id} className="contents">
            <BoardCard board={board} workspaceId={workspaceId} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="grid gap-4">
      {boards && boards.length > 0 ? toolbar : null}
      {body}
      <p className="sr-only" aria-live="polite">
        {boards ? (filter ? `${pluralize(visible.length, 'board')} match the filter` : pluralize(boards.length, 'board')) : ''}
      </p>
    </div>
  );
}
