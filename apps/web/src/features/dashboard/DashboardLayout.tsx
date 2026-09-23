import * as React from 'react';
import { Link, Outlet, useParams } from 'react-router';
import { Button, Sheet, SheetContent, SheetDescription, SheetTitle } from '@inkflow/ui';
import { FullPageLoader, FullPageMessage } from '@/components/FullPageState';
import { RouteFallback } from '@/app/RouteFallback';
import { CreateWorkspaceDialog } from '@/features/workspaces/CreateWorkspaceDialog';
import { useWorkspace, useWorkspaces } from '@/features/workspaces/hooks';
import { setLastWorkspaceId } from '@/features/workspaces/last-workspace';
import { BoardDialogsHost } from './BoardDialogsHost';
import { NewBoardDialog } from './components/NewBoardDialog';
import { IMPORT_ACCEPT } from './import-board';
import { useImportBoard } from './components/useImportBoard';
import { SearchDialog } from './SearchDialog';
import { SidebarContent } from './Sidebar';
import { TopBar } from './TopBar';
import { useDashboardUi } from './ui-store';
import { WorkspaceProvider } from './WorkspaceContext';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    !!target.closest('[role="dialog"],[role="menu"],[role="listbox"]')
  );
}

/** Dashboard keyboard shortcuts: ⌘K / Ctrl+K and "/" open search, "N" creates a board. */
function useDashboardShortcuts() {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const ui = useDashboardUi.getState();
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        ui.setSearchOpen(!ui.searchOpen);
        return;
      }
      if (mod || event.altKey || isEditableTarget(event.target)) return;
      if (event.key === '/') {
        event.preventDefault();
        ui.setSearchOpen(true);
      } else if ((event.key === 'n' || event.key === 'N') && !event.shiftKey) {
        event.preventDefault();
        ui.openNewBoard();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

function GlobalImportInput({ workspaceId }: { workspaceId: string }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const importNonce = useDashboardUi((s) => s.importNonce);
  const { importFile } = useImportBoard(workspaceId);
  const handled = React.useRef(importNonce);
  React.useEffect(() => {
    if (importNonce !== handled.current) {
      handled.current = importNonce;
      inputRef.current?.click();
    }
  }, [importNonce]);
  return (
    <input
      ref={inputRef}
      type="file"
      accept={IMPORT_ACCEPT}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void importFile(file);
      }}
    />
  );
}

/** App shell for `/w/:workspaceId/*`: sidebar (sheet on mobile), top bar and the active view. */
export function DashboardLayout() {
  const { workspaceId = '' } = useParams();
  const workspaces = useWorkspaces();
  const fromList = workspaces.data?.find((w) => w.id === workspaceId);
  const detail = useWorkspace(fromList ? undefined : workspaceId);
  const workspace = fromList ?? detail.data;
  const mobileNavOpen = useDashboardUi((s) => s.mobileNavOpen);
  const setMobileNavOpen = useDashboardUi((s) => s.setMobileNavOpen);
  const createWorkspaceOpen = useDashboardUi((s) => s.createWorkspaceOpen);
  const setCreateWorkspaceOpen = useDashboardUi((s) => s.setCreateWorkspaceOpen);
  useDashboardShortcuts();

  React.useEffect(() => {
    if (workspace) setLastWorkspaceId(workspace.id);
  }, [workspace]);

  const contextValue = React.useMemo(
    () => (workspace ? { workspace, workspaces: workspaces.data ?? [workspace] } : null),
    [workspace, workspaces.data],
  );

  if (!contextValue) {
    if (workspaces.isPending || (!fromList && detail.isPending)) return <FullPageLoader />;
    return (
      <FullPageMessage
        title="Workspace not found"
        description="It may have been deleted, or you're not a member anymore."
        actions={
          <Button asChild>
            <Link to="/">Go to your workspaces</Link>
          </Button>
        }
      />
    );
  }

  return (
    <WorkspaceProvider value={contextValue}>
      <div className="flex h-dvh overflow-hidden bg-background">
        <aside
          className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex"
          aria-label="Sidebar"
          data-testid="sidebar"
        >
          <SidebarContent />
        </aside>
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0 pt-10">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Workspace navigation</SheetDescription>
            <SidebarContent />
          </SheetContent>
        </Sheet>
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main
            id="main-content"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)] outline-none"
          >
            <React.Suspense fallback={<RouteFallback />}>
              <Outlet />
            </React.Suspense>
          </main>
        </div>
      </div>
      <NewBoardDialog workspaceId={contextValue.workspace.id} />
      <SearchDialog />
      <BoardDialogsHost />
      <CreateWorkspaceDialog open={createWorkspaceOpen} onOpenChange={setCreateWorkspaceOpen} />
      <GlobalImportInput workspaceId={contextValue.workspace.id} />
    </WorkspaceProvider>
  );
}

export default DashboardLayout;
