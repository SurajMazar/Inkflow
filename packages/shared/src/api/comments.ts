import { z } from 'zod';
import type { IsoDate, PublicUserDto } from './common';

export const commentAnchorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('point'), x: z.number().finite(), y: z.number().finite() }),
  z.object({
    type: z.literal('element'),
    elementId: z.string().min(1).max(64),
    /** Offset relative to the element's top-left corner. */
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  z.object({
    type: z.literal('frame'),
    elementId: z.string().min(1).max(64),
    x: z.number().finite(),
    y: z.number().finite(),
  }),
]);
export type CommentAnchor = z.infer<typeof commentAnchorSchema>;

export const COMMENT_BODY_MAX = 5000;

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(COMMENT_BODY_MAX),
  anchor: commentAnchorSchema,
  mentions: z.array(z.string()).max(50).default([]),
});
export type CreateCommentRequest = z.input<typeof createCommentSchema>;

export const updateCommentSchema = z.object({
  body: z.string().trim().min(1).max(COMMENT_BODY_MAX),
  mentions: z.array(z.string()).max(50).default([]),
});
export type UpdateCommentRequest = z.input<typeof updateCommentSchema>;

export const createReplySchema = z.object({
  body: z.string().trim().min(1).max(COMMENT_BODY_MAX),
  mentions: z.array(z.string()).max(50).default([]),
});
export type CreateReplyRequest = z.input<typeof createReplySchema>;

export interface CommentReplyDto {
  id: string;
  commentId: string;
  author: PublicUserDto;
  body: string;
  mentions: string[];
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface CommentDto {
  id: string;
  boardId: string;
  author: PublicUserDto;
  body: string;
  anchor: CommentAnchor;
  mentions: string[];
  resolvedAt: IsoDate | null;
  resolvedBy: PublicUserDto | null;
  replies: CommentReplyDto[];
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

/** Extracts `@[Name](userId)` mention tokens from a comment body. */
export function extractMentionIds(body: string): string[] {
  const ids = new Set<string>();
  const re = /@\[[^\]]{1,80}\]\(([A-Za-z0-9_-]{1,64})\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) ids.add(m[1]!);
  return [...ids];
}
