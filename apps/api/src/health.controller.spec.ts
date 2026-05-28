import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok with uptime and version', () => {
    const controller = new HealthController();
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(typeof result.uptimeMs).toBe('number');
    expect(typeof result.version).toBe('string');
  });
});
