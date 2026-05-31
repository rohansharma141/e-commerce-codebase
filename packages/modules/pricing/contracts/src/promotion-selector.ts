import type { AppliedPromotionSnapshot, Promotion } from './promotion.dto';
import { clampNonNegative, mulBps } from './money-ops';

export interface SelectorContext {
  readonly subtotalCents: number;
  readonly lineProductIds: readonly string[];
  readonly appliedCouponCode?: string;
}

export function computeDiscount(
  promo: Promotion,
  ctx: SelectorContext,
  now: Date,
): number | null {
  if (!promo.active) return null;
  if (promo.expiresAt && new Date(promo.expiresAt).getTime() <= now.getTime()) return null;
  if (promo.maxUses !== null && promo.usesCount >= promo.maxUses) return null;

  if (promo.kind === 'coupon-code') {
    if (!promo.code || promo.code !== ctx.appliedCouponCode) return null;
  }
  if (!conditionMet(promo, ctx)) return null;

  const applied = applyAction(promo, ctx.subtotalCents);
  return applied > 0 ? applied : null;
}

function conditionMet(promo: Promotion, ctx: SelectorContext): boolean {
  switch (promo.condition.type) {
    case 'always':
      return true;
    case 'cart-total-min': {
      const min = Number((promo.condition.value as { minCents?: unknown })['minCents']);
      if (!Number.isFinite(min) || !Number.isInteger(min)) return false;
      return ctx.subtotalCents >= min;
    }
    case 'contains-product': {
      const productId = (promo.condition.value as { productId?: unknown })['productId'];
      if (typeof productId !== 'string') return false;
      return ctx.lineProductIds.includes(productId);
    }
    default:
      return false;
  }
}

function applyAction(promo: Promotion, subtotalCents: number): number {
  switch (promo.action.type) {
    case 'percent':
      return clampNonNegative(Math.min(subtotalCents, mulBps(subtotalCents, promo.action.value)));
    case 'fixed':
      return clampNonNegative(Math.min(subtotalCents, promo.action.value));
    default:
      return 0;
  }
}

/**
 * Best-single strategy: from the set of all applicable promotions, pick the
 * one yielding the largest discount. Ties broken by stable id ordering.
 */
export function selectBest(
  candidates: readonly Promotion[],
  ctx: SelectorContext,
  now: Date,
): AppliedPromotionSnapshot | null {
  let best: { promo: Promotion; discount: number } | null = null;
  for (const promo of candidates) {
    const discount = computeDiscount(promo, ctx, now);
    if (discount === null) continue;
    if (
      !best ||
      discount > best.discount ||
      (discount === best.discount && promo.id < best.promo.id)
    ) {
      best = { promo, discount };
    }
  }
  if (!best) return null;
  return {
    promotionId: best.promo.id,
    kind: best.promo.kind,
    code: best.promo.code,
    actionType: best.promo.action.type,
    actionValue: best.promo.action.value,
    discountCents: best.discount,
  };
}
