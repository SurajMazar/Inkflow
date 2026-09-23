import * as React from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileText, LayoutTemplate, Moon, Plus, Settings, Sun, Upload, Users } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  Spinner,
} from '@inkflow/ui';
import type { SearchResultDto } from '@inkflow/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatRelativeTime } from '@/lib/format';
import { useTheme } from '@/features/theme/ThemeProvider';
import { useDashboardUi } from './ui-store';
import { useCurrentWorkspace } from './WorkspaceContext';

export const SEARCH_DEBOUNCE_MS = 200;

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const index = text.toLowerCase().indexOf(q.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-[3px] bg-brand-subtle px-0.5 text-brand-subtle-foreground">{text.slice(index, index + q.length)}</mark>
      {text.slice(index + q.length)}
    </>
  );
}

function snippet(result: SearchResultDto): string | null {
  const texts = result.matches.map((m) => m.text.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (texts.length === 0) return null;
  const first = texts[0]!.length > 90 ? `${texts[0]!.slice(0, 90)}…` : texts[0]!;
  return texts.length > 1 ? `${first} · +${texts.length - 1} more` : first;
}

/**
 * Global search (⌘K / Ctrl+K): searches boards and their content via `GET /search` and offers
 * quick actions.
 */
export function SearchDialog() {
  const open = useDashboardUi((s) => s.searchOpen);
  const setOpen = useDashboardUi((s) => s.setSearchOpen);
  const openNewBoard = useDashboardUi((s) => s.openNewBoard);
  const requestImport = useDashboardUi((s) => s.requestImport);
  const { workspace } = useCurrentWorkspace();
  const { resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [query, setQuery] = React.useState('');
  const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const results = useQuery({
    queryKey: queryKeys.search(workspace.id, debounced),
    queryFn: ({ signal }) => api.search({ q: debounced, workspaceId: workspace.id, limit: 20 }, { signal }),
    enabled: open && debounced.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  const q = query.trim().toLowerCase();
  const actions = [
    { id: 'new-board', label: 'New board', icon: Plus, run: () => openNewBoard() },
    { id: 'templates', label: 'Browse templates', icon: LayoutTemplate, run: () => navigate(`/w/${workspace.id}/templates`) },
    { id: 'import', label: 'Import board from file', icon: Upload, run: requestImport },
    { id: 'members', label: 'Invite members', icon: Users, run: () => navigate(`/w/${workspace.id}/settings`) },
    { id: 'settings', label: 'Settings', icon: Settings, run: () => navigate('/settings/account') },
    {
      id: 'theme',
      label: resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      icon: resolvedTheme === 'dark' ? Sun : Moon,
      run: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
    },
  ].filter((a) => !q || a.label.toLowerCase().includes(q));

  const boards = debounced.length > 0 ? (results.data ?? []) : [];
  const searching = debounced.length > 0 && results.isFetching;
  const settled = debounced === query.trim() && !results.isFetching;

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Search boards and run quick actions"
      commandProps={{ shouldFilter: false, loop: true }}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search boards and content…"
        data-testid="search-input"
        trailing={searching ? <Spinner label="Searching" /> : null}
      />
      <CommandList>
        {debounced.length > 0 && settled && boards.length === 0 && actions.length === 0 ? (
          <CommandEmpty>No results for “{query.trim()}”.</CommandEmpty>
        ) : null}
        {boards.length > 0 ? (
          <CommandGroup heading="Boards">
            {boards.map((result) => {
              const text = snippet(result);
              return (
                <CommandItem
                  key={result.boardId}
                  value={`board-${result.boardId}`}
                  onSelect={() => run(() => navigate(`/b/${result.boardId}`))}
                  data-testid="search-result"
                  data-board-id={result.boardId}
                >
                  <FileText aria-hidden />
                  <div className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">
                      <Highlight text={result.boardTitle} query={debounced} />
                    </span>
                    {text ? (
                      <span className="truncate text-xs text-muted-foreground">
                        <Highlight text={text} query={debounced} />
                      </span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(result.updatedAt)}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
        {boards.length > 0 && actions.length > 0 ? <CommandSeparator /> : null}
        {actions.length > 0 ? (
          <CommandGroup heading="Quick actions">
            {actions.map((action) => (
              <CommandItem key={action.id} value={`action-${action.id}`} onSelect={() => run(action.run)} data-testid={`search-action-${action.id}`}>
                <action.icon aria-hidden />
                {action.label}
                {action.id === 'new-board' ? <CommandShortcut>N</CommandShortcut> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
      <p className="sr-only" aria-live="polite">
        {debounced && settled ? `${boards.length} board${boards.length === 1 ? '' : 's'} found` : ''}
      </p>
    </CommandDialog>
  );
}
