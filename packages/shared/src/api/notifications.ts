import type { IsoDate, PublicUserDto } from './common';

export const NOTIFICATION_TYPES = [
  'BOARD_SHARED',
  'WORKSPACE_INVITE',
  'COMMENT_CREATED',
  'COMMENT_REPLY',
  'MENTION',
  'COMMENT_RESOLVED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationDto {
  id: string;
  type: NotificationType;
  actor: PublicUserDto | null;
  title: string;
  body: string;
  /** In-app route to open when the notification is clicked. */
  link: string | null;
  readAt: IsoDate | null;
  createdAt: IsoDate;
}

export interface NotificationListDto {
  items: NotificationDto[];
  unreadCount: number;
}
