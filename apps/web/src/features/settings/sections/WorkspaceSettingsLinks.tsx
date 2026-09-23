import { Link } from 'react-router';
import { ChevronRight, Plus } from 'lucide-react';
import { Badge, Button, Skeleton } from '@inkflow/ui';
import { formatRole, pluralize } from '@/lib/format';
import { useWorkspaces } from '@/features/workspaces/hooks';
import { getLastWorkspaceId } from '@/features/workspaces/last-workspace';
import { SettingsSection } from '../components';

export function WorkspaceSettingsLinks() {
  const workspaces = useWorkspaces();
  const lastId = getLastWorkspaceId();
  const list = [...(workspaces.data ?? [])].sort((a, b) => Number(b.id === lastId) - Number(a.id === lastId) || a.name.localeCompare(b.name));
  return (
    <div className="grid gap-8">
      <SettingsSection title="Your workspaces" description="Members, invitations and workspace names are managed per workspace.">
        {workspaces.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : list.length === 0 ? (
          <div className="flex items-center justify-between gap-3 p-4 text-sm text-muted-foreground">
            You're not in any workspace yet.
            <Button asChild size="sm">
              <Link to="/">
                <Plus aria-hidden />
                Create workspace
              </Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y">
            {list.map((workspace) => (
              <li key={workspace.id}>
                <Link
                  to={`/w/${workspace.id}/settings`}
                  className="flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent/60"
                  data-testid="settings-workspace-link"
                >
                  <span aria-hidden className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
                    {workspace.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{workspace.name}</span>
                      {workspace.id === lastId ? <Badge variant="outline">Current</Badge> : null}
                    </span>
                    <span className="block truncate text-[13px] text-muted-foreground">
                      {formatRole(workspace.role)} · {pluralize(workspace.memberCount, 'member')} · {pluralize(workspace.boardCount, 'board')}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </div>
  );
}
