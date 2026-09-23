import * as React from 'react';
import { NavLink, useNavigate } from 'react-router';
import {
  Check,
  ChevronsUpDown,
  FolderKanban,
  Home,
  LayoutTemplate,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import {
  AlertDialog,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ScrollArea,
  SimpleTooltip,
  cn,
} from '@inkflow/ui';
import type { ProjectDto, WorkspaceDto } from '@inkflow/shared';
import { RenameDialog } from './components/RenameDialog';
import { sortProjects } from './components/location-options';
import { useProjectMutations, useProjects } from './hooks';
import { useDashboardUi } from './ui-store';
import { useCurrentWorkspace } from './WorkspaceContext';

function WorkspaceBadge({ workspace, className }: { workspace: WorkspaceDto; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground',
        className,
      )}
    >
      {workspace.name.trim().charAt(0).toUpperCase() || 'W'}
    </span>
  );
}

export function WorkspaceSwitcher() {
  const { workspace, workspaces } = useCurrentWorkspace();
  const navigate = useNavigate();
  const setCreateWorkspaceOpen = useDashboardUi((s) => s.setCreateWorkspaceOpen);
  const setMobileNavOpen = useDashboardUi((s) => s.setMobileNavOpen);
  const go = (path: string) => {
    setMobileNavOpen(false);
    navigate(path);
  };
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=open]:bg-sidebar-accent pointer-coarse:min-h-10"
          data-testid="workspace-switcher"
          aria-label={`Current workspace: ${workspace.name}. Switch workspace`}
        >
          <WorkspaceBadge workspace={workspace} />
          <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => go(`/w/${w.id}`)} data-testid="workspace-option">
            <WorkspaceBadge workspace={w} className="size-5 text-[10px]" />
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            {w.id === workspace.id ? <Check className="size-4" aria-label="Current workspace" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => go(`/w/${workspace.id}/settings`)}>
          <Settings aria-hidden />
          Workspace settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setCreateWorkspaceOpen(true)} data-testid="workspace-create">
          <Plus aria-hidden />
          Create workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarLink({
  to,
  icon: Icon,
  children,
  end,
  testId,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  children: React.ReactNode;
  end?: boolean;
  testId?: string;
}) {
  const setMobileNavOpen = useDashboardUi((s) => s.setMobileNavOpen);
  return (
    <NavLink
      to={to}
      end={end}
      onClick={() => setMobileNavOpen(false)}
      data-testid={testId}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 pointer-coarse:min-h-10',
          isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
        )
      }
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{children}</span>
    </NavLink>
  );
}

type ProjectDialog = { kind: 'create' } | { kind: 'rename'; project: ProjectDto } | { kind: 'delete'; project: ProjectDto } | null;

function ProjectsNav() {
  const { workspace } = useCurrentWorkspace();
  const projects = useProjects(workspace.id);
  const { create, rename, remove } = useProjectMutations(workspace.id);
  const navigate = useNavigate();
  const setMobileNavOpen = useDashboardUi((s) => s.setMobileNavOpen);
  const [dialog, setDialog] = React.useState<ProjectDialog>(null);
  const list = sortProjects(projects.data ?? []);

  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between px-2 pt-1">
        <h2 className="text-xs font-medium text-muted-foreground">Projects</h2>
        <SimpleTooltip content="New project">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground"
            aria-label="New project"
            onClick={() => setDialog({ kind: 'create' })}
            data-testid="project-create"
          >
            <Plus className="size-3.5" aria-hidden />
          </Button>
        </SimpleTooltip>
      </div>
      {projects.isPending ? null : list.length === 0 ? (
        <button
          type="button"
          onClick={() => setDialog({ kind: 'create' })}
          className="mx-2 rounded-md border border-dashed px-2 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
        >
          Group boards into projects
        </button>
      ) : (
        <ul className="grid gap-0.5" aria-label="Projects">
          {list.map((project) => (
            <li key={project.id} className="group/project relative">
              <NavLink
                to={`/w/${workspace.id}/projects/${project.id}`}
                onClick={() => setMobileNavOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-md py-1.5 pr-8 pl-2 text-sm text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 pointer-coarse:min-h-10',
                    isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
                  )
                }
                data-testid="project-link"
              >
                <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{project.name}</span>
              </NavLink>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1/2 right-1 size-6 -translate-y-1/2 text-muted-foreground opacity-0 group-hover/project:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-100"
                    aria-label={`Actions for project ${project.name}`}
                  >
                    <MoreHorizontal className="size-3.5" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => setDialog({ kind: 'rename', project })}>
                    <Pencil aria-hidden />
                    Rename…
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: 'delete', project })}>
                    <Trash2 aria-hidden />
                    Delete…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <RenameDialog
        open={dialog?.kind === 'create'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="New project"
        description="Projects group related boards and folders."
        label="Project name"
        initialValue=""
        maxLength={120}
        submitLabel="Create project"
        onSubmit={async (name) => {
          const project = await create.mutateAsync({ name });
          setMobileNavOpen(false);
          navigate(`/w/${workspace.id}/projects/${project.id}`);
        }}
      />
      <RenameDialog
        open={dialog?.kind === 'rename'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Rename project"
        label="Project name"
        initialValue={dialog?.kind === 'rename' ? dialog.project.name : ''}
        maxLength={120}
        onSubmit={(name) =>
          dialog?.kind === 'rename' ? rename.mutateAsync({ projectId: dialog.project.id, name }) : Promise.resolve()
        }
      />
      <AlertDialog open={dialog?.kind === 'delete'} onOpenChange={(open) => !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{dialog?.kind === 'delete' ? dialog.project.name : ''}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The project and its folders are removed. Its boards move to the trash, where you can restore them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                if (dialog?.kind === 'delete') remove.mutate(dialog.project.id);
                setDialog(null);
              }}
            >
              Delete project
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Sidebar contents (rendered in the desktop aside and in the mobile sheet). */
export function SidebarContent() {
  const { workspace } = useCurrentWorkspace();
  const base = `/w/${workspace.id}`;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-2">
        <WorkspaceSwitcher />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label="Dashboard" className="grid gap-5 px-2 pb-4">
          <div className="grid gap-0.5">
            <SidebarLink to={base} end icon={Home} testId="home-nav">
              Home
            </SidebarLink>
            <SidebarLink to={`${base}/favorites`} icon={Star} testId="favorites-nav">
              Favorites
            </SidebarLink>
            <SidebarLink to={`${base}/shared`} icon={Users} testId="shared-nav">
              Shared with me
            </SidebarLink>
            <SidebarLink to={`${base}/templates`} icon={LayoutTemplate} testId="templates-nav">
              Templates
            </SidebarLink>
            <SidebarLink to={`${base}/trash`} icon={Trash2} testId="trash-nav">
              Trash
            </SidebarLink>
          </div>
          <ProjectsNav />
        </nav>
      </ScrollArea>
      <div className="border-t border-sidebar-border p-2">
        <SidebarLink to={`${base}/settings`} icon={Settings} testId="workspace-settings-nav">
          Workspace settings
        </SidebarLink>
      </div>
    </div>
  );
}
