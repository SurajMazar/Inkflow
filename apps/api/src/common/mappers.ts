import type { PublicUserDto } from '@inkflow/shared';

export const publicUserSelect = { id: true, name: true, email: true, avatarUrl: true } as const;

export interface PublicUserRow {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export function toPublicUser(user: PublicUserRow): PublicUserDto {
  return { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
}

export function iso(date: Date): string;
export function iso(date: Date | null | undefined): string | null;
export function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

/** Placeholder id that never matches a row (used to keep Prisma includes static for anonymous users). */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Escapes `%`, `_` and `\` for use inside a LIKE/ILIKE pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Only allows same-site relative paths (prevents open redirects). */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 512) return '/';
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (/[\r\n]/.test(next)) return '/';
  return next;
}

export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'workspace';
}
