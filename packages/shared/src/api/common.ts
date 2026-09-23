import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), {
    message: 'Password must contain at least one letter and one number',
  });

export const emailSchema = z
  .email('Enter a valid email address')
  .max(254)
  .transform((v) => v.trim().toLowerCase());
export const nameSchema = z.string().trim().min(1, 'Name is required').max(80);
export const titleSchema = z.string().trim().min(1, 'Title is required').max(200);
export const idSchema = z.string().min(1).max(64);

/** ISO-8601 timestamp string as serialized by the API. */
export type IsoDate = string;

export interface PublicUserDto {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface OkResponse {
  ok: true;
}
