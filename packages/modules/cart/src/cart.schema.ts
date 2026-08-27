import { ApiProperty } from '@nestjs/swagger';
import type {
  AppliedPromotionSnapshot,
  ComputedTotals,
  PricedLine,
  PromotionActionType,
  PromotionKind,
} from '@platform/modules/pricing/contracts';
import type * as Contract from '@platform/modules/cart/contracts';

/**
 * The cart module's HTTP representation.
 *
 * These classes exist because `@nestjs/swagger` reads decorator metadata, and
 * a TypeScript interface leaves none behind: every cart body and response in
 * `/docs-json` was `{}`, which is also why `packages/api-client/src/rest.ts`
 * has been maintained by hand.
 *
 * They live here rather than in `contracts/` deliberately. The contracts
 * packages have no dependencies at all, and putting `@ApiProperty` in them
 * would mean anything importing the public contract — including a consumer
 * that never speaks HTTP — pulling in our web framework. Serialisation is a
 * property of this module's REST surface, not of the contract.
 *
 * Each class `implements` its contract counterpart, so the two cannot drift
 * without the build failing. The contracts are imported as a namespace purely
 * so the class names can match the interface names: those names become the
 * schema names in the published OpenAPI document, and `Cart` reads better
 * there than `CartDto`.
 *
 * The three totals classes are the exception, and are prefixed. They describe
 * pricing's shapes, which the orders module also returns — and since a module
 * may not import another module's `src/`, orders will declare its own. Two
 * schemas with one name would collide in the document, so the name says which
 * endpoint it came from. Both still implement the one pricing interface, which
 * is what keeps them honest.
 */

export class CartLine implements Contract.CartLine {
  @ApiProperty({ format: 'uuid' })
  readonly productId!: string;

  @ApiProperty({ example: 'T-FASHION-0000286' })
  readonly sku!: string;

  @ApiProperty({ example: 'Vesper Oxford Shirt' })
  readonly name!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  readonly qty!: number;
}

export class CartTotalsLine implements PricedLine {
  @ApiProperty({ format: 'uuid' })
  readonly productId!: string;

  @ApiProperty({ example: 2 })
  readonly qty!: number;

  @ApiProperty({
    example: 4999,
    description: 'Minor units. Divide by the currency exponent from Query.capabilities.',
  })
  readonly unitPriceCents!: number;

  @ApiProperty({ example: 9998, description: 'Minor units.' })
  readonly lineTotalCents!: number;
}

export class CartAppliedPromotion implements AppliedPromotionSnapshot {
  @ApiProperty({ format: 'uuid' })
  readonly promotionId!: string;

  @ApiProperty({ enum: ['coupon-code', 'automatic'], example: 'coupon-code' })
  readonly kind!: PromotionKind;

  @ApiProperty({ type: String, nullable: true, example: 'SPRING25' })
  readonly code!: string | null;

  @ApiProperty({ enum: ['percent', 'fixed'], example: 'percent' })
  readonly actionType!: PromotionActionType;

  @ApiProperty({
    example: 2500,
    description: 'Basis points for a percent action, minor units for a fixed one.',
  })
  readonly actionValue!: number;

  @ApiProperty({ example: 2500, description: 'Minor units taken off this cart.' })
  readonly discountCents!: number;
}

export class CartTotals implements ComputedTotals {
  @ApiProperty({ example: 'USD', description: 'ISO 4217.' })
  readonly currency!: string;

  @ApiProperty({ type: () => [CartTotalsLine] })
  readonly lines!: readonly CartTotalsLine[];

  @ApiProperty({ example: 9998, description: 'Minor units.' })
  readonly subtotalCents!: number;

  @ApiProperty({ example: 2500, description: 'Minor units.' })
  readonly discountCents!: number;

  @ApiProperty({
    example: 7498,
    description: 'subtotal - discount; the base tax is charged on.',
  })
  readonly taxedAmountCents!: number;

  @ApiProperty({ example: 875, description: 'Basis points: 875 is 8.75%.' })
  readonly taxRateBps!: number;

  @ApiProperty({ example: 656, description: 'Minor units.' })
  readonly taxCents!: number;

  @ApiProperty({ example: 8154, description: 'Minor units.' })
  readonly grandTotalCents!: number;

  @ApiProperty({ type: () => CartAppliedPromotion, nullable: true })
  readonly appliedPromotion!: CartAppliedPromotion | null;
}

export class Cart implements Contract.Cart {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 't-fashion' })
  readonly tenantId!: string;

  @ApiProperty({ type: () => [CartLine] })
  readonly lines!: readonly CartLine[];

  @ApiProperty({ type: String, nullable: true, example: 'SPRING25' })
  readonly couponCode!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  readonly updatedAt!: string;
}

export class CartWithTotals extends Cart implements Contract.CartWithTotals {
  @ApiProperty({ type: () => CartTotals })
  readonly totals!: CartTotals;
}

export class CreateCartResponse implements Contract.CreateCartResponse {
  @ApiProperty({ format: 'uuid' })
  readonly cartId!: string;
}

export class AddItemDto implements Contract.AddItemDto {
  @ApiProperty({ format: 'uuid' })
  readonly productId!: string;

  @ApiProperty({
    example: 'T-FASHION-0000286',
    description: 'Snapshot taken at add time, so checkout needs no catalog lookup.',
  })
  readonly sku!: string;

  @ApiProperty({ example: 'Vesper Oxford Shirt', description: 'Snapshot taken at add time.' })
  readonly name!: string;

  @ApiProperty({ example: 1, minimum: 1 })
  readonly qty!: number;
}

export class SetItemQtyDto implements Contract.SetItemQtyDto {
  @ApiProperty({ example: 3, minimum: 0, description: '0 removes the line.' })
  readonly qty!: number;
}

export class ApplyCouponDto implements Contract.ApplyCouponDto {
  @ApiProperty({ example: 'SPRING25' })
  readonly code!: string;
}
