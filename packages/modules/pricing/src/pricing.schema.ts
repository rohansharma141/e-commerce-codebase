import { ApiProperty } from '@nestjs/swagger';
import type * as Contract from '@platform/modules/pricing/contracts';

/**
 * The pricing module's HTTP representation.
 *
 * Same reasoning as `cart.schema.ts` and `orders.schema.ts`: `@nestjs/swagger`
 * reads decorator metadata and interfaces leave none, so without these the
 * admin price and promotion endpoints document as `{}` — and a `{}` schema is
 * exactly what `openapi-typescript` turns into a useless generated type.
 *
 * These classes live in `src/`, not `contracts/`, and that is deliberate: the
 * contracts packages have zero dependencies, and `@ApiProperty` would drag
 * `@nestjs/swagger` into the surface a consumer imports. `implements
 * Contract.X` is what keeps them honest — the class cannot drift from the
 * interface without a type error, which is the property that actually matters.
 */

export class Price implements Contract.Price {
  @ApiProperty({ example: 't-fashion' })
  readonly tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly productId!: string;

  @ApiProperty({ example: 14394, description: 'Minor units. Never a decimal.' })
  readonly unitPriceCents!: number;

  @ApiProperty({ format: 'date-time' })
  readonly updatedAt!: string;
}

export class PriceListResponse {
  @ApiProperty({ type: () => [Price] })
  readonly items!: readonly Price[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Opaque token for the next page, or null on the last page. Pass it back as ?cursor=. Do not parse it — prices are keyed on (tenantId, productId) with no id column, so the sort key is productId.',
  })
  readonly nextCursor!: string | null;
}

export class PromotionCondition implements Contract.PromotionCondition {
  @ApiProperty({ enum: ['always', 'cart-total-min', 'contains-product'] })
  readonly type!: Contract.PromotionConditionType;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Shape depends on type: always:{} | cart-total-min:{minCents} | contains-product:{productId}',
    example: { minCents: 5000 },
  })
  readonly value!: Record<string, unknown>;
}

export class PromotionAction implements Contract.PromotionAction {
  @ApiProperty({ enum: ['percent', 'fixed'] })
  readonly type!: Contract.PromotionActionType;

  @ApiProperty({
    example: 1000,
    description: 'Basis points when type is `percent`, minor units when `fixed`.',
  })
  readonly value!: number;
}

export class Promotion implements Contract.Promotion {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 't-fashion' })
  readonly tenantId!: string;

  @ApiProperty({ enum: ['coupon-code', 'automatic'] })
  readonly kind!: Contract.PromotionKind;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'WELCOME10',
    description: 'Null for automatic promotions, which need no code to apply.',
  })
  readonly code!: string | null;

  @ApiProperty({ type: () => PromotionCondition })
  readonly condition!: Contract.PromotionCondition;

  @ApiProperty({ type: () => PromotionAction })
  readonly action!: Contract.PromotionAction;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  readonly expiresAt!: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Null means unlimited.' })
  readonly maxUses!: number | null;

  @ApiProperty({ example: 0 })
  readonly usesCount!: number;

  @ApiProperty()
  readonly active!: boolean;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt!: string;
}

export class PromotionListResponse {
  @ApiProperty({ type: () => [Promotion] })
  readonly items!: readonly Promotion[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Opaque token for the next page, or null on the last page. Pass it back as ?cursor=. Do not parse it — the sort key is the (createdAt, id) pair.',
  })
  readonly nextCursor!: string | null;
}
