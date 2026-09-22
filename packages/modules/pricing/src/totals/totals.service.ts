import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  computeTotals,
  selectBest,
  unservableChannel,
  type ComputedTotals,
  type ITotalsService,
  type LineInput,
  type PricedLine,
  type PricingScope,
  type TenantConfig,
  type TotalsComputeInput,
} from '@platform/modules/pricing/contracts';
import { PricesRepository } from '../prices/prices.repository';
import { PromotionsRepository } from '../promotions/promotions.repository';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { UnservableChannelException } from './unservable-channel.exception';

@Injectable()
export class TotalsService implements ITotalsService {
  constructor(
    private readonly tenantConfig: TenantConfigService,
    private readonly prices: PricesRepository,
    private readonly promotions: PromotionsRepository,
  ) {}

  async assertServable(tenantId: string, scope: PricingScope): Promise<void> {
    const cfg = await this.tenantConfig.findOptional(tenantId);
    // No price list, nothing to contradict. `compute` answers that case where
    // it matters, with its own 404.
    if (cfg) refuseUnservable(cfg, scope);
  }

  /**
   * Single entry point for "what does this set of lines cost right now?"
   * Used by the cart's GET-with-totals path AND re-run inside the orders
   * checkout transaction (single source of truth for money math).
   */
  async compute(input: TotalsComputeInput): Promise<ComputedTotals> {
    const cfg = await this.tenantConfig.findOptional(input.tenantId);
    if (!cfg) {
      throw new NotFoundException(
        'tenant_config not set — admin must PUT /admin/tenant-config before pricing is available',
      );
    }
    // Before any price is read: an unservable channel is refused, not priced
    // and then discarded.
    refuseUnservable(cfg, input.scope);
    validateLines(input.lines);

    const productIds = input.lines.map((l) => l.productId);
    const priceMap = await this.prices.findByProductIds(input.tenantId, productIds);

    const pricedLines: PricedLine[] = [];
    for (const line of input.lines) {
      const price = priceMap.get(line.productId);
      if (!price) {
        throw new BadRequestException(`no price set for product ${line.productId}`);
      }
      pricedLines.push({
        productId: line.productId,
        qty: line.qty,
        unitPriceCents: price.unitPriceCents,
        lineTotalCents: price.unitPriceCents * line.qty,
      });
    }

    const subtotalCents = pricedLines.reduce((acc, l) => acc + l.lineTotalCents, 0);

    let appliedPromotion = null;
    if (pricedLines.length > 0) {
      const candidates = await this.promotions.listActiveCandidates(input.tenantId);
      appliedPromotion = selectBest(
        candidates,
        {
          subtotalCents,
          lineProductIds: productIds,
          appliedCouponCode: input.couponCode,
        },
        new Date(),
      );
    }

    return computeTotals({
      currency: cfg.currency,
      taxRateBps: cfg.taxRateBps,
      lines: pricedLines,
      appliedPromotion,
    });
  }
}

/** The one enforcement of `unservableChannel`; both public methods call it. */
function refuseUnservable(cfg: TenantConfig, scope: PricingScope): void {
  const refusal = unservableChannel(cfg.currency, scope);
  if (refusal) throw new UnservableChannelException(refusal);
}

function validateLines(lines: readonly LineInput[]): void {
  for (const l of lines) {
    if (!l.productId || typeof l.productId !== 'string') {
      throw new BadRequestException('every line requires a productId string');
    }
    if (!Number.isInteger(l.qty) || l.qty <= 0) {
      throw new BadRequestException(`line ${l.productId}: qty must be a positive integer`);
    }
  }
}
