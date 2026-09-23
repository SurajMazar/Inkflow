import { Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createTemplateSchema,
  isUuid,
  type CreateTemplateRequest,
  type OkResponse,
  type TemplateDetailDto,
  type TemplateSummaryDto,
} from '@inkflow/shared';
import { z } from 'zod';
import { Errors } from '../common/errors';
import { CurrentUser, type AuthInfo } from '../common/request';
import { ApiZodBody, ApiZodQuery, IdParam, ZBody, ZQuery } from '../common/validation';
import { TemplatesService } from './templates.service';

const listSchema = z.object({ workspaceId: z.string().max(64).optional() });

@ApiTags('templates')
@ApiCookieAuth()
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @ApiZodQuery(listSchema)
  @ApiOperation({ summary: 'Built-in and workspace templates' })
  list(@CurrentUser() user: AuthInfo, @ZQuery(listSchema) query: z.output<typeof listSchema>): Promise<TemplateSummaryDto[]> {
    if (query.workspaceId && !isUuid(query.workspaceId)) throw Errors.notFound('Workspace');
    return this.templates.list(user.userId, query.workspaceId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Template with its document' })
  get(@CurrentUser() user: AuthInfo, @IdParam('id', 'Template') id: string): Promise<TemplateDetailDto> {
    return this.templates.get(user.userId, id);
  }

  @Post()
  @ApiZodBody(createTemplateSchema)
  @ApiOperation({ summary: 'Save a document as a workspace template' })
  create(@CurrentUser() user: AuthInfo, @ZBody(createTemplateSchema) body: CreateTemplateRequest): Promise<TemplateSummaryDto> {
    return this.templates.create(user.userId, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a workspace template (creator or workspace ADMIN+)' })
  async remove(@CurrentUser() user: AuthInfo, @IdParam('id', 'Template') id: string): Promise<OkResponse> {
    await this.templates.remove(user.userId, id);
    return { ok: true };
  }
}
