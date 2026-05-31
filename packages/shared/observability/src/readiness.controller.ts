import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReadinessService, type ReadinessReport } from './readiness.service';

@ApiTags('Health')
@Controller('ready')
export class ReadinessController {
  constructor(private readonly service: ReadinessService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Readiness probe — Postgres, Redis, OpenSearch (no tenant required)',
  })
  async check(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    const report = await this.service.check();
    res.status(report.ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
