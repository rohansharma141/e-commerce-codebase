import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { TENANT_DRIZZLE, type TenantDrizzleAccessor } from '@platform/shared/database';
import type {
  Order,
  OrderLine,
  OrderStatus,
} from '@platform/modules/orders/contracts';
import type { AppliedPromotionSnapshot } from '@platform/modules/pricing/contracts';
import {
  idempotencyKeys,
  orderLines,
  orderPromotionSnapshot,
  orders,
} from './db/schema';

export interface NewOrderInput {
  readonly tenantId: string;
  readonly currency: string;
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly taxRateBps: number;
  readonly taxCents: number;
  readonly grandTotalCents: number;
  readonly lines: ReadonlyArray<{
    productId: string;
    sku: string;
    name: string;
    unitPriceCents: number;
    qty: number;
    lineTotalCents: number;
  }>;
  readonly appliedPromotion: AppliedPromotionSnapshot | null;
}

@Injectable()
export class OrdersRepository {
  constructor(@Inject(TENANT_DRIZZLE) private readonly accessor: TenantDrizzleAccessor) {}
  private get db() {
    return this.accessor.get();
  }

  async findById(tenantId: string, id: string): Promise<Order | null> {
    const orderRows = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
      .limit(1);
    const orderRow = orderRows[0];
    if (!orderRow) return null;

    const lineRows = await this.db.select().from(orderLines).where(eq(orderLines.orderId, id));
    const snapRows = await this.db
      .select()
      .from(orderPromotionSnapshot)
      .where(eq(orderPromotionSnapshot.orderId, id))
      .limit(1);

    return toDomain(orderRow, lineRows, snapRows[0] ?? null);
  }

  async list(
    tenantId: string,
    opts: { limit: number },
  ): Promise<{ items: readonly Order[] }> {
    const cap = Math.min(Math.max(opts.limit, 1), 100);
    const orderRows = await this.db
      .select()
      .from(orders)
      .where(eq(orders.tenantId, tenantId))
      .orderBy(desc(orders.createdAt))
      .limit(cap);
    // N+1 friendly enough for the demo list; switch to a JOIN/aggregate when needed.
    const items: Order[] = [];
    for (const o of orderRows) {
      const fetched = await this.findById(tenantId, o.id);
      if (fetched) items.push(fetched);
    }
    return { items };
  }
}

function toDomain(
  o: {
    id: string;
    tenantId: string;
    status: string;
    currency: string;
    subtotalCents: number;
    discountCents: number;
    taxRateBps: number;
    taxCents: number;
    grandTotalCents: number;
    createdAt: Date;
  },
  lines: ReadonlyArray<{
    id: string;
    orderId: string;
    productId: string;
    sku: string;
    name: string;
    unitPriceCents: number;
    qty: number;
    lineTotalCents: number;
  }>,
  snap: {
    promotionId: string;
    kind: string;
    code: string | null;
    actionType: string;
    actionValue: number;
    discountCents: number;
  } | null,
): Order {
  const orderLinesDomain: OrderLine[] = lines.map((l) => ({
    id: l.id,
    productId: l.productId,
    sku: l.sku,
    name: l.name,
    unitPriceCents: l.unitPriceCents,
    qty: l.qty,
    lineTotalCents: l.lineTotalCents,
  }));
  return {
    id: o.id,
    tenantId: o.tenantId,
    status: o.status as OrderStatus,
    currency: o.currency,
    subtotalCents: o.subtotalCents,
    discountCents: o.discountCents,
    taxRateBps: o.taxRateBps,
    taxCents: o.taxCents,
    grandTotalCents: o.grandTotalCents,
    lines: orderLinesDomain,
    appliedPromotion: snap
      ? {
          promotionId: snap.promotionId,
          kind: snap.kind as AppliedPromotionSnapshot['kind'],
          code: snap.code,
          actionType: snap.actionType as AppliedPromotionSnapshot['actionType'],
          actionValue: snap.actionValue,
          discountCents: snap.discountCents,
        }
      : null,
    createdAt: o.createdAt.toISOString(),
  };
}

// Table references exported so checkout.service can use them inside its tx.
export { orders, orderLines, orderPromotionSnapshot, idempotencyKeys };
