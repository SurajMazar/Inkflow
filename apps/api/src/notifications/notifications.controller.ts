import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { NotificationListDto, OkResponse } from '@inkflow/shared';
import { z } from 'zod';
import { CurrentUser, type AuthInfo } from '../common/request';
import { ApiZodQuery, IdParam, ZQuery } from '../common/validation';
import { NotificationsService } from './notifications.service';

const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });

@ApiTags('notifications')
@ApiCookieAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiZodQuery(listSchema)
  @ApiOperation({ summary: 'Recent notifications and the unread count' })
  list(
    @CurrentUser() user: AuthInfo,
    @ZQuery(listSchema) query: z.output<typeof listSchema>,
  ): Promise<NotificationListDto> {
    return this.notifications.list(user.userId, query.limit);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async readAll(@CurrentUser() user: AuthInfo): Promise<OkResponse> {
    await this.notifications.markAllRead(user.userId);
    return { ok: true };
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a notification as read' })
  async read(
    @CurrentUser() user: AuthInfo,
    @IdParam('id', 'Notification') id: string,
  ): Promise<OkResponse> {
    await this.notifications.markRead(user.userId, id);
    return { ok: true };
  }
}
