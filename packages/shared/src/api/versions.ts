import { z } from 'zod';
import type { IsoDate, PublicUserDto } from './common';
import type { SerializedDocument } from './boards';

export const VERSION_KINDS = ['AUTO', 'MANUAL', 'RESTORE_BACKUP'] as const;
export type VersionKind = (typeof VERSION_KINDS)[number];

export const createVersionSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
});
export type CreateVersionRequest = z.input<typeof createVersionSchema>;

export interface BoardVersionDto {
  id: string;
  boardId: string;
  number: number;
  label: string | null;
  kind: VersionKind;
  elementCount: number;
  seq: number;
  createdBy: PublicUserDto | null;
  createdAt: IsoDate;
}

export interface BoardVersionDetailDto extends BoardVersionDto {
  document: SerializedDocument;
}

export interface VersionComparisonDto {
  fromVersionId: string;
  /** `current` when comparing against the live board. */
  toVersionId: string | 'current';
  added: string[];
  removed: string[];
  modified: string[];
  unchangedCount: number;
}
