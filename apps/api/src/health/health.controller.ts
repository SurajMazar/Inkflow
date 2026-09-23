import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { HealthCheckDto } from '@inkflow/shared';
import { Public } from '../common/request';
import { HealthService } from './health.service';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness' })
  live(): HealthCheckDto {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: database, Redis and object storage (503 when not ready)' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthCheckDto> {
    const result = await this.health.readiness();
    res.status(result.status === 'ok' ? 200 : 503);
    res.setHeader('Cache-Control', 'no-store');
    return result;
  }
}
