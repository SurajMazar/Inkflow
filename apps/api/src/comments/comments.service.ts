import { Injectable } from '@nestjs/common';
import type { Prisma } from '@inkflow/database';
import {
  boardRoleAtLeast,
  extractMentionIds,
  isUuid,
  type CommentAnchor,
  type CommentDto,
  type CommentReplyDto,
} from '@inkflow/shared';
import { AccessService, type BoardAccess } from '../access/access.service';
import { RealtimeService } from '../collaboration/realtime.service';
import { AppConfig } from '../config/app-config';
import { Errors } from '../common/errors';
import { iso, publicUserSelect, toPublicUser, type PublicUserRow } from '../common/mappers';
import type { Principal } from '../common/request';
import { commentEmail, mentionEmail, plainMentions } from '../mail/templates';
import { NotificationsService, type NotifyInput } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const MAX_MENTIONS = 50;

const commentInclude = {
  author: { select: publicUserSelect },
  resolvedBy: { select: publicUserSelect },
  mentions: { where: { replyId: null }, select: { userId: true } },
  replies: {
    orderBy: { createdAt: 'asc' },
    include: { author: { select: publicUserSelect }, mentions: { select: { userId: true } } },
  },
} satisfies Prisma.CommentInclude;

type CommentRow = Prisma.CommentGetPayload<{ include: typeof commentInclude }>;
type ReplyRow = {
  id: string;
  commentId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: PublicUserRow;
  mentions: { userId: string }[];
};

function toReplyDto(r: ReplyRow): CommentReplyDto {
  return {
    id: r.id,
    commentId: r.commentId,
    author: toPublicUser(r.author),
    body: r.body,
    mentions: r.mentions.map((m) => m.userId),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function toCommentDto(c: CommentRow): CommentDto {
  return {
    id: c.id,
    boardId: c.boardId,
    author: toPublicUser(c.author),
    body: c.body,
    anchor: c.anchor as unknown as CommentAnchor,
    mentions: c.mentions.map((m) => m.userId),
    resolvedAt: iso(c.resolvedAt),
    resolvedBy: c.resolvedBy ? toPublicUser(c.resolvedBy) : null,
    replies: c.replies.map(toReplyDto),
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  };
}

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  /** Signed-in VIEWER+ (anonymous share-link visitors can read but not comment). */
  private async requireCommenter(
    principal: Principal,
    boardId: string,
  ): Promise<BoardAccess & { userId: string }> {
    const access = await this.access.requireBoard(boardId, principal, 'VIEWER');
    if (!access.userId) throw Errors.unauthorized('Sign in to comment');
    return access as BoardAccess & { userId: string };
  }

  /** Mentioned user ids (explicit list ∪ body tokens) that can actually see the board. */
  private async resolveMentions(
    boardId: string,
    authorId: string,
    body: string,
    explicit: string[],
  ): Promise<string[]> {
    const ids = [...new Set([...explicit, ...extractMentionIds(body)])]
      .filter((id) => isUuid(id) && id !== authorId)
      .slice(0, MAX_MENTIONS);
    const allowed: string[] = [];
    for (const id of ids) {
      if (await this.access.getBoardAccess(boardId, { userId: id, shareToken: null }))
        allowed.push(id);
    }
    return allowed;
  }

  private boardLink(boardId: string, commentId: string): string {
    return `/b/${boardId}?comment=${commentId}`;
  }

  private async notifyMentions(
    access: BoardAccess,
    actor: PublicUserRow,
    commentId: string,
    body: string,
    userIds: string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    const link = this.boardLink(access.board.id, commentId);
    const url = this.config.webLink(link);
    await this.notifications.notify(
      userIds.map((userId): NotifyInput => ({
        userId,
        type: 'MENTION',
        actorId: actor.id,
        title: `${actor.name} mentioned you on “${access.board.title}”`,
        body: plainMentions(body).slice(0, 1000),
        link,
        data: { boardId: access.board.id, commentId },
        email: {
          ...mentionEmail({ actorName: actor.name, boardTitle: access.board.title, body, url }),
          link: url,
        },
      })),
    );
  }

  private async load(commentId: string): Promise<CommentRow> {
    return this.prisma.comment.findUniqueOrThrow({
      where: { id: commentId },
      include: commentInclude,
    });
  }

  private async findComment(commentId: string) {
    const comment = isUuid(commentId)
      ? await this.prisma.comment.findUnique({ where: { id: commentId } })
      : null;
    if (!comment) throw Errors.notFound('Comment');
    return comment;
  }

  private changed(boardId: string, commentId: string | null): void {
    void this.realtime.emitEvent(boardId, { kind: 'comments-changed', commentId });
  }

  async list(
    principal: Principal,
    boardId: string,
    includeResolved: boolean,
  ): Promise<CommentDto[]> {
    await this.access.requireBoard(boardId, principal, 'VIEWER');
    const rows = await this.prisma.comment.findMany({
      where: { boardId, ...(includeResolved ? {} : { resolvedAt: null }) },
      include: commentInclude,
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    return rows.map(toCommentDto);
  }

  async create(
    principal: Principal,
    boardId: string,
    input: { body: string; anchor: CommentAnchor; mentions: string[] },
  ): Promise<CommentDto> {
    const access = await this.requireCommenter(principal, boardId);
    const mentions = await this.resolveMentions(boardId, access.userId, input.body, input.mentions);
    const comment = await this.prisma.comment.create({
      data: {
        boardId,
        authorId: access.userId,
        body: input.body,
        anchor: input.anchor as unknown as Prisma.InputJsonValue,
        mentions: { create: mentions.map((userId) => ({ userId })) },
      },
      include: commentInclude,
    });
    const actor = comment.author;
    await this.notifyMentions(access, actor, comment.id, input.body, mentions);
    // The board owner hears about new comments (unless they wrote it or were mentioned).
    if (access.board.ownerId !== access.userId && !mentions.includes(access.board.ownerId)) {
      const link = this.boardLink(boardId, comment.id);
      const url = this.config.webLink(link);
      await this.notifications.notify([
        {
          userId: access.board.ownerId,
          type: 'COMMENT_CREATED',
          actorId: access.userId,
          title: `${actor.name} commented on “${access.board.title}”`,
          body: plainMentions(input.body).slice(0, 1000),
          link,
          data: { boardId, commentId: comment.id },
          email: {
            ...commentEmail({
              actorName: actor.name,
              boardTitle: access.board.title,
              body: input.body,
              url,
              kind: 'comment',
            }),
            link: url,
          },
        },
      ]);
    }
    this.changed(boardId, comment.id);
    return toCommentDto(comment);
  }

  async update(
    principal: Principal,
    commentId: string,
    input: { body: string; mentions: string[] },
  ): Promise<CommentDto> {
    const existing = await this.findComment(commentId);
    const access = await this.requireCommenter(principal, existing.boardId);
    if (existing.authorId !== access.userId)
      throw Errors.forbidden('Only the author can edit a comment');
    const before = new Set(
      (
        await this.prisma.commentMention.findMany({
          where: { commentId, replyId: null },
          select: { userId: true },
        })
      ).map((m) => m.userId),
    );
    const mentions = await this.resolveMentions(
      existing.boardId,
      access.userId,
      input.body,
      input.mentions,
    );
    await this.prisma.$transaction([
      this.prisma.comment.update({ where: { id: commentId }, data: { body: input.body } }),
      this.prisma.commentMention.deleteMany({ where: { commentId, replyId: null } }),
      this.prisma.commentMention.createMany({
        data: mentions.map((userId) => ({ commentId, userId })),
      }),
    ]);
    const comment = await this.load(commentId);
    await this.notifyMentions(
      access,
      comment.author,
      commentId,
      input.body,
      mentions.filter((id) => !before.has(id)),
    );
    this.changed(existing.boardId, commentId);
    return toCommentDto(comment);
  }

  async setResolved(
    principal: Principal,
    commentId: string,
    resolved: boolean,
  ): Promise<CommentDto> {
    const existing = await this.findComment(commentId);
    const access = await this.requireCommenter(principal, existing.boardId);
    await this.prisma.comment.update({
      where: { id: commentId },
      data: resolved
        ? { resolvedAt: new Date(), resolvedById: access.userId }
        : { resolvedAt: null, resolvedById: null },
    });
    const comment = await this.load(commentId);
    if (resolved && existing.authorId !== access.userId && comment.resolvedBy) {
      const link = this.boardLink(existing.boardId, commentId);
      const url = this.config.webLink(link);
      const actor = comment.resolvedBy;
      await this.notifications.notify([
        {
          userId: existing.authorId,
          type: 'COMMENT_RESOLVED',
          actorId: access.userId,
          title: `${actor.name} resolved your comment on “${access.board.title}”`,
          body: plainMentions(existing.body).slice(0, 1000),
          link,
          data: { boardId: existing.boardId, commentId },
          email: {
            ...commentEmail({
              actorName: actor.name,
              boardTitle: access.board.title,
              body: existing.body,
              url,
              kind: 'resolved',
            }),
            link: url,
          },
        },
      ]);
    }
    this.changed(existing.boardId, commentId);
    return toCommentDto(comment);
  }

  async remove(principal: Principal, commentId: string): Promise<void> {
    const existing = await this.findComment(commentId);
    const access = await this.requireCommenter(principal, existing.boardId);
    if (existing.authorId !== access.userId && !boardRoleAtLeast(access.role, 'OWNER')) {
      throw Errors.forbidden('Only the author or the board owner can delete a comment');
    }
    await this.prisma.comment.delete({ where: { id: commentId } });
    this.changed(existing.boardId, commentId);
  }

  // ───────────── replies ─────────────

  async reply(
    principal: Principal,
    commentId: string,
    input: { body: string; mentions: string[] },
  ): Promise<CommentReplyDto> {
    const comment = await this.findComment(commentId);
    const access = await this.requireCommenter(principal, comment.boardId);
    const mentions = await this.resolveMentions(
      comment.boardId,
      access.userId,
      input.body,
      input.mentions,
    );
    const reply = await this.prisma.commentReply.create({
      data: {
        commentId,
        authorId: access.userId,
        body: input.body,
        mentions: { create: mentions.map((userId) => ({ userId, commentId })) },
      },
      include: { author: { select: publicUserSelect }, mentions: { select: { userId: true } } },
    });
    await this.notifyMentions(access, reply.author, commentId, input.body, mentions);
    // Thread participants (comment author + earlier repliers) get a reply notification.
    const participants = await this.prisma.commentReply.findMany({
      where: { commentId },
      select: { authorId: true },
      distinct: ['authorId'],
    });
    const recipients = new Set([comment.authorId, ...participants.map((p) => p.authorId)]);
    recipients.delete(access.userId);
    for (const id of mentions) recipients.delete(id);
    const link = this.boardLink(comment.boardId, commentId);
    const url = this.config.webLink(link);
    const notify: NotifyInput[] = [];
    for (const userId of recipients) {
      if (!(await this.access.getBoardAccess(comment.boardId, { userId, shareToken: null })))
        continue;
      notify.push({
        userId,
        type: 'COMMENT_REPLY',
        actorId: access.userId,
        title: `${reply.author.name} replied on “${access.board.title}”`,
        body: plainMentions(input.body).slice(0, 1000),
        link,
        data: { boardId: comment.boardId, commentId, replyId: reply.id },
        email: {
          ...commentEmail({
            actorName: reply.author.name,
            boardTitle: access.board.title,
            body: input.body,
            url,
            kind: 'reply',
          }),
          link: url,
        },
      });
    }
    await this.notifications.notify(notify);
    await this.prisma.comment.update({ where: { id: commentId }, data: { updatedAt: new Date() } });
    this.changed(comment.boardId, commentId);
    return toReplyDto(reply);
  }

  private async findReply(replyId: string) {
    const reply = isUuid(replyId)
      ? await this.prisma.commentReply.findUnique({
          where: { id: replyId },
          include: { comment: { select: { boardId: true } } },
        })
      : null;
    if (!reply) throw Errors.notFound('Reply');
    return reply;
  }

  async updateReply(
    principal: Principal,
    replyId: string,
    input: { body: string; mentions: string[] },
  ): Promise<CommentReplyDto> {
    const existing = await this.findReply(replyId);
    const access = await this.requireCommenter(principal, existing.comment.boardId);
    if (existing.authorId !== access.userId)
      throw Errors.forbidden('Only the author can edit a reply');
    const before = new Set(
      (
        await this.prisma.commentMention.findMany({ where: { replyId }, select: { userId: true } })
      ).map((m) => m.userId),
    );
    const mentions = await this.resolveMentions(
      existing.comment.boardId,
      access.userId,
      input.body,
      input.mentions,
    );
    await this.prisma.$transaction([
      this.prisma.commentReply.update({ where: { id: replyId }, data: { body: input.body } }),
      this.prisma.commentMention.deleteMany({ where: { replyId } }),
      this.prisma.commentMention.createMany({
        data: mentions.map((userId) => ({ commentId: existing.commentId, replyId, userId })),
      }),
    ]);
    const reply = await this.prisma.commentReply.findUniqueOrThrow({
      where: { id: replyId },
      include: { author: { select: publicUserSelect }, mentions: { select: { userId: true } } },
    });
    await this.notifyMentions(
      access,
      reply.author,
      existing.commentId,
      input.body,
      mentions.filter((id) => !before.has(id)),
    );
    this.changed(existing.comment.boardId, existing.commentId);
    return toReplyDto(reply);
  }

  async removeReply(principal: Principal, replyId: string): Promise<void> {
    const existing = await this.findReply(replyId);
    const access = await this.requireCommenter(principal, existing.comment.boardId);
    if (existing.authorId !== access.userId && !boardRoleAtLeast(access.role, 'OWNER')) {
      throw Errors.forbidden('Only the author or the board owner can delete a reply');
    }
    await this.prisma.commentReply.delete({ where: { id: replyId } });
    this.changed(existing.comment.boardId, existing.commentId);
  }
}
