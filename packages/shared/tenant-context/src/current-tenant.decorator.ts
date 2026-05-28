import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { currentTenantOrThrow, type TenantContext } from './tenant-context';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): TenantContext => currentTenantOrThrow(),
);
