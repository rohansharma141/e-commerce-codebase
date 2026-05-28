import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  private readonly bootedAt = Date.now();

  @Get()
  check() {
    return {
      status: 'ok',
      uptimeMs: Date.now() - this.bootedAt,
      version: process.env['npm_package_version'] ?? '0.0.0',
    };
  }
}
