import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MAX_OPS_PER_BATCH, type ServerChange } from '@inkflow/collaboration';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AllowShareToken, CurrentPrincipal, type Principal } from '../common/request';
import { ApiZodBody, ApiZodQuery, IdParam, ZBody, ZQuery } from '../common/validation';
import { OperationsService, type BatchResult } from './operations.service';

const id = z.string().min(1).max(128);
/** Operations are validated one by one (an invalid op is rejected without failing the batch). */
export const operationsBatchSchema = z.object({
  clientId: id,
  batchId: id,
  ops: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_OPS_PER_BATCH),
});
const changesQuerySchema = z.object({ since: z.coerce.number().int().min(0) });

@ApiTags('operations')
@Controller('boards/:id')
export class OperationsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly access: AccessService,
  ) {}

  @AllowShareToken()
  @Post('operations')
  @HttpCode(200)
  @ApiZodBody(operationsBatchSchema)
  @ApiOperation({
    summary: 'Apply a batch of operations (HTTP fallback for the WebSocket; EDITOR+)',
  })
  async apply(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
    @ZBody(operationsBatchSchema) body: z.output<typeof operationsBatchSchema>,
  ): Promise<BatchResult> {
    const access = await this.access.requireBoard(boardId, principal, 'EDITOR');
    return this.operations.applyBatch(boardId, { userId: access.userId }, body.clientId, body.ops);
  }

  @AllowShareToken()
  @Get('changes')
  @ApiZodQuery(changesQuerySchema)
  @ApiOperation({ summary: 'Changes since a sequence number (null → reload the document)' })
  async changes(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
    @ZQuery(changesQuerySchema) query: z.output<typeof changesQuerySchema>,
  ): Promise<{ seq: number; changes: ServerChange[] | null }> {
    await this.access.requireBoard(boardId, principal, 'VIEWER');
    return this.operations.changesSince(boardId, query.since);
  }
}
