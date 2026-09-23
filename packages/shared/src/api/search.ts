import { z } from 'zod';

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  workspaceId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type SearchQuery = z.input<typeof searchQuerySchema>;

export interface SearchElementMatchDto {
  elementId: string;
  elementType: string;
  /** Snippet of matched text (element text, label or frame name). */
  text: string;
}

export interface SearchResultDto {
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  titleMatch: boolean;
  matches: SearchElementMatchDto[];
  updatedAt: string;
}
