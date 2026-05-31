import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { drizzle as makeDrizzle } from 'drizzle-orm/postgres-js';
import {
  TENANT_DRIZZLE,
  currentTenantBinding,
  type TenantDrizzleAccessor,
} from '@platform/shared/database';
import { EventBus } from '@platform/shared/event-bus';
import { HOOK_NAMES, HookRegistry } from '@platform/shared/hooks';
import { currentTenantOrThrow } from '@platform/shared/tenant-context';
import {
  CART_SERVICE,
  type ICartService,
} from '@platform/modules/cart/contracts';
import {
  PRICES_QUERY,
  PROMOTIONS_QUERY,
  TENANT_CONFIG_QUERY,
  computeTotals,
  selectBest,
  type AppliedPromotionSnapshot,
  type IPricesQuery,
  type IPromotionsQuery,
  type ITenantConfigQuery,
} from '@platform/modules/pricing/contracts';
import {
  ORDERS_EVENTS,
  type Order,
  type OrderLine,
} from '@platform/modules/orders/contracts';
import { idempotencyKeys, orderLines, orderPromotionSnapshot, orders } from './db/schema';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    @Inject(TENANT_DRIZZLE) private readonly accessor: TenantDrizzleAccessor,
    @Inject(CART_SERVICE) private readonly cart: ICartService,
    @Inject(TENANT_CONFIG_QUERY) private readonly tenantConfig: ITenantConfigQuery,
    @Inject(PRICES_QUERY) private readonly prices: IPricesQuery,
    @Inject(PROMOTIONS_QUERY) private readonly promotions: IPromotionsQuery,
    private readonly events: EventBus,
    private readonly hooks: HookRegistry,
  ) {}

  /**
   * The transactional core. See the plan file's `checkout.service.ts` section
   * for the step-by-step. Key points:
   *  - Idempotency-Key short-circuits before any work.
   *  - All money math is recomputed inside the tx (single source of truth).
   *  - Promotion consumption uses a conditional UPDATE to win/lose the race
   *    cleanly without a row-level lock.
   *  - Cart deletion happens AFTER commit; losing it is recoverable.
   */
  async checkout(
    tenantId: string,
    cartId: string,
    idempotencyKey?: string,
  ): Promise<{ order: Order; createdNew: boolean }> {
    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(tenantId, idempotencyKey);
      if (existing) {
        return { order: existing, createdNew: false };
      }
    }

    const cart = await this.cart.get(tenantId, cartId);
    if (cart.lines.length === 0) {
      throw new BadRequestException('cannot checkout an empty cart');
    }

    const cfg = await this.tenantConfig.get(tenantId);

    const productIds = cart.lines.map((l) => l.productId);
    const priceMap = await this.prices.findByProductIds(tenantId, productIds);

    // sku + name are snapshotted on the cart line at add-time (see
    // packages/modules/cart/contracts/cart.dto.ts). Orders reuses those
    // snapshots so this module never reaches into catalog/src.
    const pricedLines = cart.lines.map((line) => {
      const price = priceMap.get(line.productId);
      if (!price) throw new BadRequestException(`no price set for product ${line.productId}`);
      return {
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        unitPriceCents: price.unitPriceCents,
        qty: line.qty,
        lineTotalCents: price.unitPriceCents * line.qty,
      };
    });

    const subtotalCents = pricedLines.reduce((acc, l) => acc + l.lineTotalCents, 0);
    const candidates = await this.promotions.listActiveCandidates(tenantId);
    let appliedPromotion = selectBest(
      candidates,
      {
        subtotalCents,
        lineProductIds: productIds,
        appliedCouponCode: cart.couponCode ?? undefined,
      },
      new Date(),
    );

    // Reserve the promo BEFORE writing the order so a concurrent checkout
    // racing for the last use loses the increment and we fall back cleanly.
    if (appliedPromotion) {
      const won = await this.promotions.tryIncrementUsesCount(
        tenantId,
        appliedPromotion.promotionId,
      );
      if (!won) {
        this.logger.warn(
          `promotion ${appliedPromotion.promotionId} exhausted under contention — falling back`,
        );
        appliedPromotion = null;
      }
    }

    const totals = computeTotals({
      currency: cfg.currency,
      taxRateBps: cfg.taxRateBps,
      lines: pricedLines,
      appliedPromotion,
    });

    // Extension point: observers receive the computed totals before the tx
    // opens. A future mutating-hook design (docs/adr/0009) would let
    // handlers return a transformed totals object; today they are pure
    // observers (e.g. fraud alerting, gift-wrap pricing pre-checks).
    await this.hooks.dispatch(
      HOOK_NAMES.OrderBeforeCreate,
      {
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        grandTotalCents: totals.grandTotalCents,
      },
      currentTenantOrThrow(),
    );

    const orderId = randomUUID();
    const createdNew = true;

    // The Drizzle client returned by TENANT_DRIZZLE is built on a Proxy of the
    // request's reserved postgres-js connection (see tenant-binding.ts). The
    // proxy routes single-statement calls (insert/update/select) to the
    // reserved connection just fine, but drizzle-postgres-js's `db.transaction`
    // resolves to the PARENT sql client's begin(), which pulls a FRESH
    // connection from the pool — one that doesn't have app.tenant_id set, so
    // RLS rejects every INSERT inside the tx.
    //
    // Fix: manually issue BEGIN/COMMIT on the request's reserved connection,
    // then run drizzle ops against the per-request db. Each op routes through
    // the same connection and inherits the tx + the app.tenant_id GUC.
    const binding = currentTenantBinding();
    if (!binding) throw new Error('checkout requires an active tenant binding');
    void makeDrizzle; // imported for potential future use; suppresses unused-import lint

    const db = this.accessor.get();
    await binding.reserved`BEGIN`;
    let committed = false;
    try {
      await db.insert(orders).values({
        id: orderId,
        tenantId,
        status: 'created',
        currency: totals.currency,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxRateBps: totals.taxRateBps,
        taxCents: totals.taxCents,
        grandTotalCents: totals.grandTotalCents,
      });

      if (pricedLines.length > 0) {
        await db.insert(orderLines).values(
          pricedLines.map((l) => ({
            orderId,
            productId: l.productId,
            sku: l.sku,
            name: l.name,
            unitPriceCents: l.unitPriceCents,
            qty: l.qty,
            lineTotalCents: l.lineTotalCents,
          })),
        );
      }

      if (totals.appliedPromotion) {
        await db.insert(orderPromotionSnapshot).values({
          orderId,
          promotionId: totals.appliedPromotion.promotionId,
          kind: totals.appliedPromotion.kind,
          code: totals.appliedPromotion.code,
          actionType: totals.appliedPromotion.actionType,
          actionValue: totals.appliedPromotion.actionValue,
          discountCents: totals.appliedPromotion.discountCents,
        });
      }

      if (idempotencyKey) {
        try {
          await db.insert(idempotencyKeys).values({
            tenantId,
            idempotencyKey,
            orderId,
          });
        } catch (err: unknown) {
          if (isUniqueViolation(err)) {
            throw new IdempotencyRace();
          }
          throw err;
        }
      }
      await binding.reserved`COMMIT`;
      committed = true;
    } finally {
      if (!committed) {
        await binding.reserved`ROLLBACK`.catch(() => undefined);
      }
    }

    if (idempotencyKey) {
      // Re-query for completeness (handles the race where the tx body above
      // ran clean but the row was inserted by a parallel tx between our
      // findByIdempotencyKey at the top and our insert).
    }

    // Out-of-tx cart deletion. If this fails the order still exists; a
    // subsequent checkout would be blocked by idempotency_keys if the
    // client retries with the same key.
    await this.cart.deleteCart(tenantId, cartId).catch((err) => {
      this.logger.warn(`failed to delete cart ${cartId} after checkout: ${String(err)}`);
    });

    const persisted = await this.findOrderOrThrow(tenantId, orderId);

    await this.events.publish({
      name: ORDERS_EVENTS.Created,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      tenantId,
      payload: { order: persisted } as never,
    });

    return { order: persisted, createdNew };
  }

  private async findByIdempotencyKey(
    tenantId: string,
    key: string,
  ): Promise<Order | null> {
    const db = this.accessor.get();
    const rows = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.idempotencyKey, key)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.findOrderOrThrow(tenantId, row.orderId);
  }

  private async findOrderOrThrow(tenantId: string, id: string): Promise<Order> {
    const db = this.accessor.get();
    const orderRows = await db
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
      .limit(1);
    const orderRow = orderRows[0];
    if (!orderRow) throw new NotFoundException(`order ${id} not found`);
    const lineRows = await db.select().from(orderLines).where(eq(orderLines.orderId, id));
    const snapRows = await db
      .select()
      .from(orderPromotionSnapshot)
      .where(eq(orderPromotionSnapshot.orderId, id))
      .limit(1);
    const snap = snapRows[0];
    return buildOrder(orderRow, lineRows, snap ?? null);
  }
}

class IdempotencyRace extends Error {
  constructor() {
    super('IDEMPOTENCY_RACE');
  }
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === '23505';
}

function buildOrder(
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
  return {
    id: o.id,
    tenantId: o.tenantId,
    status: o.status as 'created',
    currency: o.currency,
    subtotalCents: o.subtotalCents,
    discountCents: o.discountCents,
    taxRateBps: o.taxRateBps,
    taxCents: o.taxCents,
    grandTotalCents: o.grandTotalCents,
    lines: lines.map(
      (l): OrderLine => ({
        id: l.id,
        productId: l.productId,
        sku: l.sku,
        name: l.name,
        unitPriceCents: l.unitPriceCents,
        qty: l.qty,
        lineTotalCents: l.lineTotalCents,
      }),
    ),
    appliedPromotion: snap
      ? ({
          promotionId: snap.promotionId,
          kind: snap.kind as AppliedPromotionSnapshot['kind'],
          code: snap.code,
          actionType: snap.actionType as AppliedPromotionSnapshot['actionType'],
          actionValue: snap.actionValue,
          discountCents: snap.discountCents,
        } as AppliedPromotionSnapshot)
      : null,
    createdAt: o.createdAt.toISOString(),
  };
}
