import { useMatch, useSearchParams } from 'react-router';
import { Menu, Plus, Search } from 'lucide-react';
import { Button, Kbd, SimpleTooltip } from '@inkflow/ui';
import { isMacPlatform } from '@/lib/platform';
import { NotificationsBell } from '@/features/notifications/NotificationsBell';
import { useDashboardUi } from './ui-store';
import { UserMenu } from './UserMenu';

const isMac = isMacPlatform();

export function TopBar() {
  const setSearchOpen = useDashboardUi((s) => s.setSearchOpen);
  const setMobileNavOpen = useDashboardUi((s) => s.setMobileNavOpen);
  const openNewBoard = useDashboardUi((s) => s.openNewBoard);
  const projectMatch = useMatch('/w/:workspaceId/projects/:projectId');
  const [params] = useSearchParams();

  const newBoard = () =>
    openNewBoard(
      projectMatch?.params.projectId
        ? { projectId: projectMatch.params.projectId, folderId: params.get('folder') }
        : {},
    );

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Open navigation"
        onClick={() => setMobileNavOpen(true)}
        data-testid="mobile-nav-open"
      >
        <Menu aria-hidden />
      </Button>
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:max-w-sm pointer-coarse:h-10"
        aria-label="Search boards"
        aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
        data-testid="search-open"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="truncate">Search boards…</span>
        <Kbd className="ml-auto hidden sm:inline-flex">{isMac ? '⌘K' : 'Ctrl K'}</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <SimpleTooltip content="New board (N)">
          <Button size="sm" onClick={newBoard} data-testid="new-board" aria-keyshortcuts="N">
            <Plus aria-hidden />
            <span className="hidden sm:inline">New board</span>
            <span className="sr-only sm:hidden">New board</span>
          </Button>
        </SimpleTooltip>
        <NotificationsBell />
        <UserMenu />
      </div>
    </header>
  );
}
