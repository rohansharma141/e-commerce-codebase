import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  TENANT_DRIZZLE,
  clampLimit,
  decodeCursor,
  toPage,
  type TenantDrizzleAccessor,
} from '@platform/shared/database';
import type {
  IPromotionsQuery,
  Promotion,
  PromotionAction,
  PromotionActionType,
  PromotionCondition,
  PromotionConditionType,
  PromotionKind,
} from '@platform/modules/pricing/contracts';
import { promotions, type PromotionRow } from '../db/schema';

export interface NewPromotion {
  readonly tenantId: string;
  readonly kind: PromotionKind;
  readonly code: string | null;
  readonly condition: PromotionCondition;
  readonly action: PromotionAction;
  readonly expiresAt: Date | null;
  readonly maxUses: number | null;
  readonly active: boolean;
}

export interface PromotionPatch {
  readonly active?: boolean;
  readonly expiresAt?: Date | null;
  readonly maxUses?: number | null;
  readonly action?: PromotionAction;
}

@Injectable()
export class PromotionsRepository implements IPromotionsQuery {
  constructor(@Inject(TENANT_DRIZZLE) private readonly accessor: TenantDrizzleAccessor) {}
  private get db() {
    return this.accessor.get();
  }

  async insert(input: NewPromotion): Promise<Promotion> {
    const [row] = await this.db
      .insert(promotions)
      .values({
        tenantId: input.tenantId,
        kind: input.kind,
        code: input.code,
        conditionType: input.condition.type,
        conditionValue: input.condition.value,
        actionType: input.action.type,
        actionValue: input.action.value,
        expiresAt: input.expiresAt,
        maxUses: input.maxUses,
        active: input.active,
      })
      .returning();
    if (!row) throw new Error('promotions insert returned no row');
    return toDomain(row);
  }

  async listByTenant(tenantId: string): Promise<readonly Promotion[]> {
    const rows = await this.db
      .select()
      .from(promotions)
      .where(eq(promotions.tenantId, tenantId));
    return rows.map(toDomain);
  }

  /**
   * Newest first, paged by an opaque keyset cursor on `(created_at, id)`.
   *
   * `created_at` alone is not a total order — two promotions created in the
   * same millisecond tie, and a tie under a single-column keyset drops every
   * row sharing the boundary. `id` breaks it.
   *
   * Kept separate from `listByTenant`, which returns everything: this is the
   * admin list, that one is not paginated and its caller wants the full set.
   */
  async listPage(
    tenantId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<{ items: readonly Promotion[]; nextCursor: string | null }> {
    const cap = clampLimit(opts.limit);
    const keyset = opts.cursor ? decodeCursor(opts.cursor, 2) : undefined;
    // ISO strings with explicit casts, not `new Date` — a Date inside a raw
    // `sql` fragment has no column type to infer from, so postgres-js cannot
    // serialise it and throws at bind time. See the same note in
    // orders.repository.ts.
    const where = keyset
      ? and(
          eq(promotions.tenantId, tenantId),
          sql`(${promotions.createdAt}, ${promotions.id}) < (${keyset[0]}::timestamptz, ${keyset[1]}::uuid)`,
        )
      : eq(promotions.tenantId, tenantId);

    const rows = await this.db
      .select()
      .from(promotions)
      .where(where)
      .orderBy(desc(promotions.createdAt), desc(promotions.id))
      .limit(cap + 1);

    const page = toPage(rows, cap, (row) => [row.createdAt.toISOString(), row.id]);
    return { items: page.items.map(toDomain), nextCursor: page.nextCursor };
  }

  async listActiveCandidates(tenantId: string): Promise<readonly Promotion[]> {
    const rows = await this.db
      .select()
      .from(promotions)
      .where(and(eq(promotions.tenantId, tenantId), eq(promotions.active, true)));
    return rows.map(toDomain);
  }

  async findById(tenantId: string, id: string): Promise<Promotion | null> {
    const rows = await this.db
      .select()
      .from(promotions)
      .where(and(eq(promotions.tenantId, tenantId), eq(promotions.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async update(tenantId: string, id: string, patch: PromotionPatch): Promise<Promotion | null> {
    const values: Record<string, unknown> = {};
    if (patch.active !== undefined) values['active'] = patch.active;
    if (patch.expiresAt !== undefined) values['expiresAt'] = patch.expiresAt;
    if (patch.maxUses !== undefined) values['maxUses'] = patch.maxUses;
    if (patch.action !== undefined) {
      values['actionType'] = patch.action.type;
      values['actionValue'] = patch.action.value;
    }
    if (Object.keys(values).length === 0) return this.findById(tenantId, id);
    const [row] = await this.db
      .update(promotions)
      .set(values)
      .where(and(eq(promotions.tenantId, tenantId), eq(promotions.id, id)))
      .returning();
    return row ? toDomain(row) : null;
  }

  /**
   * Atomic conditional increment. Returns true iff the row was successfully
   * incremented (i.e., still within max_uses). Used inside checkout's tx so
   * a concurrent checkout racing for the last use can detect "lost" without
   * an explicit row lock — see orders/checkout.service.ts.
   */
  async tryIncrementUsesCount(tenantId: string, id: string): Promise<boolean> {
    const result = await this.db
      .update(promotions)
      .set({ usesCount: sql`${promotions.usesCount} + 1` })
      .where(
        and(
          eq(promotions.tenantId, tenantId),
          eq(promotions.id, id),
          sql`(${promotions.maxUses} IS NULL OR ${promotions.usesCount} < ${promotions.maxUses})`,
        ),
      )
      .returning({ id: promotions.id });
    return result.length > 0;
  }
}

function toDomain(row: PromotionRow): Promotion {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind as PromotionKind,
    code: row.code,
    condition: {
      type: row.conditionType as PromotionConditionType,
      value: (row.conditionValue ?? {}) as Record<string, unknown>,
    },
    action: {
      type: row.actionType as PromotionActionType,
      value: row.actionValue,
    },
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    maxUses: row.maxUses,
    usesCount: row.usesCount,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}
