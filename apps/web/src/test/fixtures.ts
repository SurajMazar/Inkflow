import {
  DEFAULT_USER_PREFERENCES,
  type BoardSummaryDto,
  type PublicUserDto,
  type UserDto,
  type WorkspaceDto,
} from '@inkflow/shared';

export const NOW = '2026-09-20T10:00:00.000Z';

export function makeUser(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'u1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    avatarUrl: null,
    emailVerified: true,
    hasPassword: true,
    oauthProviders: [],
    preferences: structuredClone(DEFAULT_USER_PREFERENCES),
    createdAt: NOW,
    ...overrides,
  };
}

export function publicUser(user: Pick<UserDto, 'id' | 'name' | 'email' | 'avatarUrl'>): PublicUserDto {
  return { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
}

export function makeWorkspace(overrides: Partial<WorkspaceDto> = {}): WorkspaceDto {
  return {
    id: 'w1',
    name: 'Acme',
    slug: 'acme',
    role: 'OWNER',
    memberCount: 3,
    boardCount: 2,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeBoard(overrides: Partial<BoardSummaryDto> = {}): BoardSummaryDto {
  return {
    id: 'b1',
    workspaceId: 'w1',
    projectId: null,
    folderId: null,
    title: 'Roadmap',
    role: 'OWNER',
    workspaceAccess: 'VIEWER',
    isFavorite: false,
    thumbnailUrl: null,
    owner: publicUser(makeUser()),
    elementCount: 4,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    lastViewedAt: null,
    ...overrides,
  };
}
