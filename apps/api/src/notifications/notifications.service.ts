import { Injectable } from '@nestjs/common';
import type { NotificationType, Prisma } from '@inkflow/database';
import type { NotificationDto, NotificationListDto } from '@inkflow/shared';
import { Errors } from '../common/errors';
import { iso, publicUserSelect, toPublicUser } from '../common/mappers';
import { MailService } from '../mail/mail.service';
import type { RenderedEmail } from '../mail/templates';
import { PrismaService, type Db } from '../prisma/prisma.service';
import { resolvePreferences } from '../users/users.service';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  actorId: string | null;
  title: string;
  body: string;
  link: string | null;
  data?: Prisma.InputJsonValue;
  /** Email to send when the recipient's preferences allow it. */
  email?: RenderedEmail & { link?: string };
}

/** Which preference switch controls email for a notification type. */
function emailPreferenceKey(type: NotificationType): 'mentions' | 'shares' | 'comments' {
  switch (type) {
    case 'MENTION':
      return 'mentions';
    case 'BOARD_SHARED':
    case 'WORKSPACE_INVITE':
      return 'shares';
    default:
      return 'comments';
  }
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Creates in-app notifications and sends emails in the background (honouring preferences). */
  async notify(inputs: NotifyInput[], db: Db = this.prisma): Promise<void> {
    const list = inputs.filter((n) => n.userId !== n.actorId);
    if (list.length === 0) return;
    await db.notification.createMany({
      data: list.map((n) => ({
        userId: n.userId,
        type: n.type,
        actorId: n.actorId,
        title: n.title.slice(0, 200),
        body: n.body.slice(0, 1000),
        link: n.link,
        ...(n.data !== undefined ? { data: n.data } : {}),
      })),
    });
    const withEmail = list.filter((n) => n.email);
    if (withEmail.length === 0) return;
    const recipients = await this.prisma.user.findMany({
      where: { id: { in: withEmail.map((n) => n.userId) } },
      select: { id: true, email: true, preferences: true },
    });
    const byId = new Map(recipients.map((r) => [r.id, r]));
    for (const n of withEmail) {
      const user = byId.get(n.userId);
      if (!user || !n.email) continue;
      const prefs = resolvePreferences(user.preferences).notifications;
      if (!prefs.email || !prefs[emailPreferenceKey(n.type)]) continue;
      this.mail.sendInBackground({ ...n.email, to: user.email });
    }
  }

  async list(userId: string, limit: number): Promise<NotificationListDto> {
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { actor: { select: publicUserSelect } },
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      items: items.map((n): NotificationDto => ({
        id: n.id,
        type: n.type,
        actor: n.actor ? toPublicUser(n.actor) : null,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: iso(n.readAt),
        createdAt: iso(n.createdAt),
      })),
      unreadCount,
    };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const res = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (res.count === 0) {
      const exists = await this.prisma.notification.findFirst({
        where: { id, userId },
        select: { id: true },
      });
      if (!exists) throw Errors.notFound('Notification');
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
