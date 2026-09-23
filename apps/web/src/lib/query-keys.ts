import type { ListBoardsQuery } from '@inkflow/shared';

/**
 * Query key factory. Keys are hierarchical so that invalidating a prefix (e.g.
 * `queryKeys.boards.all`) refreshes every dependent query.
 */
export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    me: ['auth', 'me'] as const,
    providers: ['auth', 'providers'] as const,
    sessions: ['auth', 'sessions'] as const,
  },
  workspaces: {
    all: ['workspaces'] as const,
    list: ['workspaces', 'list'] as const,
    detail: (workspaceId: string) => ['workspaces', 'detail', workspaceId] as const,
    members: (workspaceId: string) => ['workspaces', 'detail', workspaceId, 'members'] as const,
    invitations: (workspaceId: string) =>
      ['workspaces', 'detail', workspaceId, 'invitations'] as const,
    projects: (workspaceId: string) => ['workspaces', 'detail', workspaceId, 'projects'] as const,
    folders: (workspaceId: string) => ['workspaces', 'detail', workspaceId, 'folders'] as const,
  },
  invitations: {
    preview: (token: string) => ['invitations', token] as const,
  },
  boards: {
    all: ['boards'] as const,
    lists: ['boards', 'list'] as const,
    list: (query: ListBoardsQuery) => ['boards', 'list', query] as const,
    detail: (boardId: string) => ['boards', 'detail', boardId] as const,
    sharing: (boardId: string) => ['boards', 'sharing', boardId] as const,
    versions: (boardId: string) => ['boards', 'versions', boardId] as const,
    comments: (boardId: string) => ['boards', 'comments', boardId] as const,
  },
  shareLinks: {
    resolve: (token: string) => ['share-links', token] as const,
  },
  templates: {
    all: ['templates'] as const,
    list: (workspaceId: string | null) => ['templates', 'list', workspaceId] as const,
    detail: (templateId: string) => ['templates', 'detail', templateId] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    list: ['notifications', 'list'] as const,
  },
  search: (workspaceId: string | null, q: string) => ['search', workspaceId, q] as const,
} as const;
