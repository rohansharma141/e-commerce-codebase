import { ApiProperty } from '@nestjs/swagger';
import type {
  AppliedPromotionSnapshot,
  PromotionActionType,
  PromotionKind,
} from '@platform/modules/pricing/contracts';
import type * as Contract from '@platform/modules/orders/contracts';

/**
 * The orders module's HTTP representation.
 *
 * Same reasoning as the cart module's `cart.schema.ts`: `@nestjs/swagger`
 * reads decorator metadata, interfaces leave none, and without these the
 * checkout body and every order response document as `{}`.
 *
 * `OrderAppliedPromotion` is a second class describing the shape cart calls
 * `CartAppliedPromotion`. That duplication is the boundary rule showing
 * through rather than an oversight: both are pricing's
 * `AppliedPromotionSnapshot`, a module may not import another module's
 * `src/`, and two schemas sharing one name would collide in the document. The
 * shared interface is what keeps them from drifting — either one can be
 * edited wrongly, but not compiled wrongly.
 *
 * An order's money is a snapshot, not a live computation, which is why these
 * fields sit flat on the order rather than nested under `totals` the way the
 * cart's do. The descriptions say so, because a consumer looking at both
 * endpoints will otherwise assume the difference is an inconsistency.
 */

export class OrderLine implements Contract.OrderLine {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly productId!: string;

  @ApiProperty({ example: 'T-FASHION-0000286' })
  readonly sku!: string;

  @ApiProperty({
    example: 'Vesper Oxford Shirt',
    description: 'Name as it was at checkout. Renaming the product later does not change it.',
  })
  readonly name!: string;

  @ApiProperty({
    example: 14394,
    description: 'Minor units, snapshotted at checkout. Not the current catalog price.',
  })
  readonly unitPriceCents!: number;

  @ApiProperty({ example: 2 })
  readonly qty!: number;

  @ApiProperty({ example: 28788, description: 'Minor units.' })
  readonly lineTotalCents!: number;
}

export class OrderAppliedPromotion implements AppliedPromotionSnapshot {
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

  @ApiProperty({ example: 7197, description: 'Minor units taken off this order.' })
  readonly discountCents!: number;
}

export class Order implements Contract.Order {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 't-fashion' })
  readonly tenantId!: string;

  @ApiProperty({
    enum: ['created'],
    example: 'created',
    description: 'Only one state today. Payment and fulfilment states are not built.',
  })
  readonly status!: Contract.OrderStatus;

  @ApiProperty({ example: 'USD', description: 'ISO 4217, as at checkout.' })
  readonly currency!: string;

  @ApiProperty({ example: 28788, description: 'Minor units.' })
  readonly subtotalCents!: number;

  @ApiProperty({ example: 7197, description: 'Minor units.' })
  readonly discountCents!: number;

  @ApiProperty({ example: 875, description: 'Basis points: 875 is 8.75%.' })
  readonly taxRateBps!: number;

  @ApiProperty({ example: 1889, description: 'Minor units.' })
  readonly taxCents!: number;

  @ApiProperty({
    example: 23480,
    description: 'Minor units. The immutable total charged, snapshotted at checkout.',
  })
  readonly grandTotalCents!: number;

  @ApiProperty({ type: () => [OrderLine] })
  readonly lines!: readonly OrderLine[];

  @ApiProperty({ type: () => OrderAppliedPromotion, nullable: true })
  readonly appliedPromotion!: OrderAppliedPromotion | null;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt!: string;
}

export class OrderListResponse {
  @ApiProperty({ type: () => [Order] })
  readonly items!: readonly Order[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Opaque token for the next page, or null on the last page. Pass it back as ?cursor=. Do not parse it — it encodes the sort key, which here is the (createdAt, id) pair.',
  })
  readonly nextCursor!: string | null;
}

export class CheckoutDto implements Contract.CheckoutDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The cart to convert. It is priced once here and the result is frozen.',
  })
  readonly cartId!: string;
}
