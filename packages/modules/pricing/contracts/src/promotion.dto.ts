export type PromotionKind = 'coupon-code' | 'automatic';

export type PromotionConditionType = 'always' | 'cart-total-min' | 'contains-product';

export interface PromotionCondition {
  readonly type: PromotionConditionType;
  /** Shape depends on type: always:{} | cart-total-min:{minCents} | contains-product:{productId} */
  readonly value: Record<string, unknown>;
}

export type PromotionActionType = 'percent' | 'fixed';

export interface PromotionAction {
  readonly type: PromotionActionType;
  /** bps for `percent`, cents for `fixed`. */
  readonly value: number;
}

export interface Promotion {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: PromotionKind;
  readonly code: string | null;
  readonly condition: PromotionCondition;
  readonly action: PromotionAction;
  readonly expiresAt: string | null;
  readonly maxUses: number | null;
  readonly usesCount: number;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface CreatePromotionDto {
  readonly kind: PromotionKind;
  readonly code?: string;
  readonly condition: PromotionCondition;
  readonly action: PromotionAction;
  readonly expiresAt?: string;
  readonly maxUses?: number;
  readonly active?: boolean;
}

export interface UpdatePromotionDto {
  readonly active?: boolean;
  readonly expiresAt?: string | null;
  readonly maxUses?: number | null;
  readonly action?: PromotionAction;
}

/**
 * Snapshot of the promotion that was applied to an order. Stored on
 * orders.order_promotion_snapshot so editing the live promotion later doesn't
 * mutate historical orders.
 */
export interface AppliedPromotionSnapshot {
  readonly promotionId: string;
  readonly kind: PromotionKind;
  readonly code: string | null;
  readonly actionType: PromotionActionType;
  readonly actionValue: number;
  readonly discountCents: number;
}
