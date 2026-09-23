import type { IsoDate } from './common';

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface FileDto {
  id: string;
  boardId: string | null;
  mimeType: AllowedImageMimeType;
  size: number;
  width: number | null;
  height: number | null;
  originalName: string;
  /** API-relative URL for the file content; permission-checked by the server. */
  url: string;
  createdAt: IsoDate;
}
