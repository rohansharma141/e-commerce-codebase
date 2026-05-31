import { Global, Module } from '@nestjs/common';
import { RedisModule } from '@platform/shared/redis';
import { CART_SERVICE } from '@platform/modules/cart/contracts';
import { CartController } from './cart.controller';
import { CartRepository } from './cart.repository';
import { CartService } from './cart.service';

// @Global for the same reason as PricingModule: orders needs CART_SERVICE
// injected, and listing CartModule in OrdersModule.imports would be a
// type:src → type:src boundary violation. The app composition root
// registers CartModule once; tokens propagate via the global DI scope.
@Global()
@Module({
  imports: [RedisModule],
  controllers: [CartController],
  providers: [
    CartRepository,
    CartService,
    { provide: CART_SERVICE, useExisting: CartService },
  ],
  exports: [CART_SERVICE],
})
export class CartModule {}
