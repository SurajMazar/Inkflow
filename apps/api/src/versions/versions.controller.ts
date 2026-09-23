import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createVersionSchema,
  isUuid,
  type BoardVersionDetailDto,
  type BoardVersionDto,
  type CreateVersionRequest,
  type VersionComparisonDto,
} from '@inkflow/shared';
import { z } from 'zod';
import { Errors } from '../common/errors';
import { AllowShareToken, CurrentPrincipal, type Principal } from '../common/request';
import { ApiZodBody, ApiZodQuery, IdParam, ZBody, ZQuery } from '../common/validation';
import { VersionsService } from './versions.service';

const compareSchema = z.object({ to: z.string().max(64).default('current') });

@ApiTags('versions')
@Controller('boards/:id/versions')
export class VersionsController {
  constructor(private readonly versions: VersionsService) {}

  @AllowShareToken()
  @Get()
  @ApiOperation({ summary: 'Version history' })
  list(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
  ): Promise<BoardVersionDto[]> {
    return this.versions.list(principal, boardId);
  }

  @AllowShareToken()
  @Post()
  @ApiZodBody(createVersionSchema)
  @ApiOperation({ summary: 'Save a named version (EDITOR+)' })
  create(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
    @ZBody(createVersionSchema) body: CreateVersionRequest,
  ): Promise<BoardVersionDto> {
    return this.versions.create(principal, boardId, body.label);
  }

  @AllowShareToken()
  @Get(':versionId')
  @ApiOperation({ summary: 'A version with its document' })
  get(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
    @IdParam('versionId', 'Version') versionId: string,
  ): Promise<BoardVersionDetailDto> {
    return this.versions.get(principal, boardId, versionId);
  }

  @AllowShareToken()
  @Post(':versionId/restore')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Restore a version (returns the automatic backup of the pre-restore state)',
  })
  restore(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
    @IdParam('versionId', 'Version') versionId: string,
  ): Promise<BoardVersionDto> {
    return this.versions.restore(principal, boardId, versionId);
  }

  @AllowShareToken()
  @Get(':versionId/compare')
  @ApiZodQuery(compareSchema)
  @ApiOperation({ summary: 'Compare a version with the current board or another version' })
  compare(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
    @IdParam('versionId', 'Version') versionId: string,
    @ZQuery(compareSchema) query: z.output<typeof compareSchema>,
  ): Promise<VersionComparisonDto> {
    if (query.to !== 'current' && !isUuid(query.to)) throw Errors.notFound('Version');
    return this.versions.compare(principal, boardId, versionId, query.to);
  }
}
