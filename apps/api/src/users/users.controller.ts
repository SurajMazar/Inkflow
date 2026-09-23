import { Controller, Get, Patch } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { isUuid, updateMeSchema, type PublicUserDto, type UpdateMeRequest, type UserDto } from '@inkflow/shared';
import { z } from 'zod';
import { Errors } from '../common/errors';
import { CurrentUser, type AuthInfo } from '../common/request';
import { ApiZodBody, ApiZodQuery, ZBody, ZQuery } from '../common/validation';
import { UsersService } from './users.service';

const userSearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  workspaceId: z.string().max(64).optional(),
  boardId: z.string().max(64).optional(),
});

@ApiTags('users')
@ApiCookieAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'The signed-in user' })
  me(@CurrentUser() user: AuthInfo): Promise<UserDto> {
    return this.users.getDto(user.userId);
  }

  @Patch('me')
  @ApiZodBody(updateMeSchema)
  @ApiOperation({ summary: 'Update profile and preferences' })
  update(@CurrentUser() user: AuthInfo, @ZBody(updateMeSchema) body: UpdateMeRequest): Promise<UserDto> {
    return this.users.updateMe(user.userId, body);
  }

  @Get('search')
  @ApiZodQuery(userSearchSchema)
  @ApiOperation({ summary: 'Find users sharing a workspace or board (mentions, invites)' })
  search(@CurrentUser() user: AuthInfo, @ZQuery(userSearchSchema) query: z.output<typeof userSearchSchema>): Promise<PublicUserDto[]> {
    if (query.workspaceId && !isUuid(query.workspaceId)) throw Errors.notFound('Workspace');
    if (query.boardId && !isUuid(query.boardId)) throw Errors.notFound('Board');
    return this.users.search(user.userId, query);
  }
}
