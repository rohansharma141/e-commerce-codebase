import type { AttributeDefinition, Product } from '@platform/modules/catalog/contracts';
import type { TenantFixture } from './catalogs/fixtures';

export interface ApiSeedSummary {
  readonly tenantId: string;
  readonly attributeDefinitions: number;
  readonly products: number;
  readonly prices: number;
}

/**
 * Seeds a slice of each tenant through the api's real HTTP endpoints instead
 * of writing to Postgres and OpenSearch directly.
 *
 * The bulk path exists for speed: 99,000 products land in about fifteen
 * seconds because it skips HTTP entirely and calls the same transforms the
 * api would. The cost of that is a blind spot — it exercises the storage
 * layers but never a controller, so a broken `POST /admin/products` would
 * still leave a perfectly populated demo, and attribute validation never runs
 * against seeded data at all.
 *
 * This mode closes the blind spot without paying the full price. A small
 * slice of each tenant's budget goes through the actual write path:
 * middleware, tenant binding, DTO handling, attribute validation, the
 * repository, the event bus, and the indexer that subscribes to it. If any of
 * that is broken, the seed fails loudly instead of quietly producing data
 * that only looks right.
 *
 * Opt in with SEED_VIA_API=1. It is off by default because it needs the api
 * running, which the bulk path does not.
 */

/** Carries the status so callers can distinguish "already done" from "broken". */
class ApiSeedError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
    this.name = 'ApiSeedError';
  }
}

/** Anything other than 2xx aborts the seed — that is the entire point. */
async function call<T>(
  apiUrl: string,
  path: string,
  tenantId: string,
  body: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `seed via api: POST ${path} could not reach ${apiUrl} — is the api running? ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const text = await res.text();
  if (!res.ok) {
    throw new ApiSeedError(
      `seed via api: POST ${path} returned ${res.status} for ${tenantId}: ${text.slice(0, 300)}`,
      res.status,
      text,
    );
  }
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * Attribute definitions must exist before any product that carries those
 * attributes — the api rejects unknown ones, which is the validation this
 * mode is here to exercise. A definition that already exists is fine: the
 * seed is re-runnable, and "already defined" means the state we wanted is
 * already true.
 */
async function ensureDefinitions(
  apiUrl: string,
  fixture: TenantFixture,
): Promise<number> {
  let created = 0;
  for (const spec of fixture.attributes) {
    try {
      await call<AttributeDefinition>(apiUrl, '/admin/attribute-definitions', fixture.tenantId, {
        code: spec.code,
        type: spec.type,
        multiValue: spec.multiValue ?? false,
        config: spec.config ?? {},
      });
      created++;
    } catch (err) {
      // Only "this already exists" is tolerable, because the seed is
      // re-runnable and a definition that is already there is the state we
      // wanted. The api answers 400 with "already defined for this tenant"
      // rather than 409, so match on what it actually says: anything else,
      // including a 400 from a genuinely malformed definition, is a real
      // failure and must stop the seed.
      const duplicate =
        err instanceof ApiSeedError &&
        (err.status === 409 || err.status === 400) &&
        /already (defined|exists)/i.test(err.body);
      if (duplicate) continue;
      throw err;
    }
  }
  return created;
}

export async function seedViaApi(
  apiUrl: string,
  fixture: TenantFixture,
  products: readonly Product[],
  priceCentsFor: (p: Product) => number,
): Promise<ApiSeedSummary> {
  const attributeDefinitions = await ensureDefinitions(apiUrl, fixture);

  let created = 0;
  let priced = 0;
  for (const p of products) {
    // The api assigns the id, so the product this creates is not the one that
    // was generated — only its sku, name and attributes carry over. That is
    // deliberate: a seed that supplied its own ids would be routing around
    // the very code path it is here to exercise.
    const saved = await call<{ id: string }>(apiUrl, '/admin/products', fixture.tenantId, {
      sku: p.sku,
      name: p.name,
      attributes: p.attributes,
    });
    created++;

    await call(apiUrl, '/admin/prices', fixture.tenantId, {
      productId: saved.id,
      unitPriceCents: priceCentsFor(p),
    });
    priced++;
  }

  return {
    tenantId: fixture.tenantId,
    attributeDefinitions,
    products: created,
    prices: priced,
  };
}
