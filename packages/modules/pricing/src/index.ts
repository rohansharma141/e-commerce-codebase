// Public surface for the pricing module's Nest composition. Cross-module
// consumers (cart, orders) inject services via the tokens in
// @platform/modules/pricing/contracts (PRICES_QUERY, PROMOTIONS_QUERY, etc.)
// and never reach into the implementations under this folder.
export { PricingModule } from './pricing.module';

// The refusal for a channel the price list cannot serve (C-32). Exported for
// the composition root's specs; modules receive it through ITotalsService.
export { UnservableChannelException } from './totals/unservable-channel.exception';
