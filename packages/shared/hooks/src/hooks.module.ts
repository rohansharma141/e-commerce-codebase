import { Global, Module } from '@nestjs/common';
import { HookRegistry } from './hook-registry';
import { HOOK_REGISTRY } from './tokens';

@Global()
@Module({
  providers: [
    HookRegistry,
    { provide: HOOK_REGISTRY, useExisting: HookRegistry },
  ],
  exports: [HOOK_REGISTRY, HookRegistry],
})
export class HooksModule {}
