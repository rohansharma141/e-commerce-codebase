import type { Sql } from 'postgres';
import type { AttributeDefinition } from '@platform/modules/catalog/contracts';
import type { GeneratedProduct } from './pricing-seed';

export interface CatalogSeedSummary {
  readonly tenantId: string;
  readonly attributeDefinitions: number;
  readonly productsInserted: number;
}

/**
 * Seeds `catalog.attribute_definitions` and `catalog.products` for one tenant.
 *
 * Why this exists: the seed's fast path writes products straight into
 * OpenSearch, which is what the hero benchmark measures. That left
 * `catalog.products` empty, and Postgres — not the search index — is the
 * canonical store. The visible consequence was that the README's RLS proof
 * counted rows in an empty table, so the "bound vs unbound" comparison
 * returned 0 either way and demonstrated nothing.
 *
 * Definitions are written before products, mirroring the ordering the live
 * API enforces: `AttributeValidator` rejects a product carrying an attribute
 * the tenant has not defined, so a seed that wrote products first would be
 * seeding data the API itself would refuse.
 *
 * Writes go through `postgres-js` with `app.tenant_id` bound on the
 * connection, exactly as the api's per-request binding does — the seed gets
 * no RLS exemption, so a policy that would block the api blocks the seed too.
 */
export async function seedCatalogForTenant(
  tenantId: string,
  definitions: readonly AttributeDefinition[],
  products: readonly GeneratedProduct[],
  sql: Sql,
): Promise<CatalogSeedSummary> {
  await sql`SELECT set_config('app.tenant_id', ${tenantId}, false)`;

  // Wipe + re-seed for repeatability. RLS scopes both deletes to this tenant,
  // so a re-run never touches another tenant's rows.
  await sql`DELETE FROM catalog.products`;
  await sql`DELETE FROM catalog.attribute_definitions`;

  for (const def of definitions) {
    await sql`
      INSERT INTO catalog.attribute_definitions (
        id, tenant_id, code, type, multi_value, config
      ) VALUES (
        ${def.id},
        ${tenantId},
        ${def.code},
        ${def.type},
        ${def.multiValue},
        ${sql.json(def.config as never)}
      )
    `;
  }

  let inserted = 0;
  const BATCH = 1000;
  for (let i = 0; i < products.length; i += BATCH) {
    const slice = products.slice(i, i + BATCH);
    await sql`
      INSERT INTO catalog.products ${sql(
        slice.map((p) => ({
          id: p.id,
          tenant_id: tenantId,
          sku: p.sku,
          name: p.name,
          attributes: sql.json(p.attributes as never),
        })),
      )}
    `;
    inserted += slice.length;
  }

  await sql`RESET "app.tenant_id"`;

  return {
    tenantId,
    attributeDefinitions: definitions.length,
    productsInserted: inserted,
  };
}
