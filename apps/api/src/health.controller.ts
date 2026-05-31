import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly bootedAt = Date.now();

  @Get()
  @ApiOperation({ summary: 'Liveness probe (no tenant required)' })
  check() {
    return {
      status: 'ok',
      uptimeMs: Date.now() - this.bootedAt,
      version: process.env['npm_package_version'] ?? '0.0.0',
    };
  }
}
