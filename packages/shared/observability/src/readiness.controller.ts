import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReadinessService, type ReadinessReport } from './readiness.service';

@Controller('ready')
export class ReadinessController {
  constructor(private readonly service: ReadinessService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    const report = await this.service.check();
    res.status(report.ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
