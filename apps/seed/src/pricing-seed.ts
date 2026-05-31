import postgres, { type Sql } from 'postgres';
import type { TenantFixture } from './catalogs/fixtures';

export interface GeneratedProduct {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly priceCents: number;
}

export interface PricingSeedSummary {
  readonly tenantId: string;
  readonly currency: string;
  readonly taxRateBps: number;
  readonly pricesUpserted: number;
  readonly promotionsCreated: number;
}

const TAX_RATES_BY_TENANT: Record<string, number> = {
  't-fashion': 875, // 8.75%
  't-electronics': 725, // 7.25%
  't-books': 0,
};

const PROMOS_BY_TENANT: Record<
  string,
  ReadonlyArray<{
    kind: 'coupon-code' | 'automatic';
    code?: string;
    conditionType: 'always' | 'cart-total-min' | 'contains-product';
    conditionValue: Record<string, unknown>;
    actionType: 'percent' | 'fixed';
    actionValue: number;
  }>
> = {
  't-fashion': [
    {
      kind: 'coupon-code',
      code: 'SPRING25',
      conditionType: 'always',
      conditionValue: {},
      actionType: 'percent',
      actionValue: 2500, // 25%
    },
    {
      kind: 'automatic',
      conditionType: 'cart-total-min',
      conditionValue: { minCents: 10_000 }, // $100
      actionType: 'percent',
      actionValue: 1000, // 10%
    },
  ],
  't-electronics': [
    {
      kind: 'coupon-code',
      code: 'GEAR15',
      conditionType: 'always',
      conditionValue: {},
      actionType: 'percent',
      actionValue: 1500, // 15%
    },
    {
      kind: 'automatic',
      conditionType: 'cart-total-min',
      conditionValue: { minCents: 50_000 }, // $500
      actionType: 'fixed',
      actionValue: 5000, // $50 off
    },
  ],
  't-books': [
    {
      kind: 'coupon-code',
      code: 'READMORE',
      conditionType: 'always',
      conditionValue: {},
      actionType: 'fixed',
      actionValue: 500, // $5 off
    },
  ],
};

/**
 * Seeds pricing data for one tenant directly via postgres-js. Sets
 * `app.tenant_id` on the connection so RLS policies admit the inserts (same
 * pattern as the api's per-request binding). Wipes and re-populates the
 * tenant's pricing rows so the seed is repeatable.
 */
export async function seedPricingForTenant(
  fixture: TenantFixture,
  products: readonly GeneratedProduct[],
  sql: Sql,
): Promise<PricingSeedSummary> {
  const taxRateBps = TAX_RATES_BY_TENANT[fixture.tenantId] ?? 0;
  const promos = PROMOS_BY_TENANT[fixture.tenantId] ?? [];

  await sql`SELECT set_config('app.tenant_id', ${fixture.tenantId}, false)`;

  // Wipe + re-seed for repeatability. RLS already scopes to the bound tenant.
  await sql`DELETE FROM pricing.promotions`;
  await sql`DELETE FROM pricing.prices`;
  await sql`DELETE FROM pricing.tenant_config`;

  await sql`
    INSERT INTO pricing.tenant_config (tenant_id, currency, tax_rate_bps, updated_at)
    VALUES (${fixture.tenantId}, 'USD', ${taxRateBps}, now())
  `;

  // Bulk INSERT prices. postgres-js batches efficiently with the helper form.
  let upserted = 0;
  const BATCH = 1000;
  for (let i = 0; i < products.length; i += BATCH) {
    const slice = products.slice(i, i + BATCH);
    await sql`
      INSERT INTO pricing.prices ${sql(
        slice.map((p) => ({
          tenant_id: fixture.tenantId,
          product_id: p.id,
          unit_price_cents: p.priceCents,
        })),
      )}
    `;
    upserted += slice.length;
  }

  let promosCreated = 0;
  for (const promo of promos) {
    await sql`
      INSERT INTO pricing.promotions (
        tenant_id, kind, code, condition_type, condition_value,
        action_type, action_value, active
      ) VALUES (
        ${fixture.tenantId},
        ${promo.kind},
        ${promo.code ?? null},
        ${promo.conditionType},
        ${sql.json(promo.conditionValue as never)},
        ${promo.actionType},
        ${promo.actionValue},
        true
      )
    `;
    promosCreated++;
  }

  // RESET so the next tenant's loop iteration starts clean.
  await sql`RESET "app.tenant_id"`;

  return {
    tenantId: fixture.tenantId,
    currency: 'USD',
    taxRateBps,
    pricesUpserted: upserted,
    promotionsCreated: promosCreated,
  };
}

export function createSeedSqlClient(databaseUrl: string): Sql {
  return postgres(databaseUrl, { max: 4 });
}
