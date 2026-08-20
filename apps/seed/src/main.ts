import 'reflect-metadata';
import { faker } from '@faker-js/faker';
import { randomUUID } from 'node:crypto';
import {
  createOpenSearchClient,
  TenantSearchClient,
  indexNameFor,
  type TenantIndex,
} from '@platform/shared/opensearch';
import type { AttributeDefinition, Product } from '@platform/modules/catalog/contracts';
import {
  attributeFieldName,
  buildMapping,
  productToDocument,
} from '@platform/modules/search/src';
import { defaultFixtures, toAttributeDefinition, type TenantFixture } from './catalogs/fixtures';
import { elapsedMs, percentiles } from './percentiles';
import {
  createSeedSqlClient,
  seedPricingForTenant,
  type GeneratedProduct,
} from './pricing-seed';
import { seedCatalogForTenant } from './catalog-seed';

/**
 * Hero-feature seed. Bulk-indexes products per tenant via the live indexer's
 * code paths, AND seeds the pricing schema (tenant_config, prices, promotions)
 * for the transactional core. Step 5 + step 4 demo in one command.
 *
 * Skips HTTP round-trips for speed; the transforms used are the same code
 * paths the live api runs.
 */

const PRODUCTS_PER_TENANT = Number.parseInt(
  process.env['SEED_PRODUCTS_PER_TENANT'] ?? '33000',
  10,
);
const BULK_SIZE = Number.parseInt(process.env['SEED_BULK_SIZE'] ?? '500', 10);
const SEARCH_SAMPLES = Number.parseInt(process.env['SEED_SEARCH_SAMPLES'] ?? '200', 10);
const OS_URL = process.env['OPENSEARCH_URL'] ?? 'http://localhost:9200';
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://platform:platform@localhost:5432/platform';

async function seedTenant(
  fixture: TenantFixture,
  os: TenantSearchClient,
): Promise<{
  batchTimings: number[];
  productCount: number;
  generated: GeneratedProduct[];
  definitions: AttributeDefinition[];
}> {
  const defs: AttributeDefinition[] = fixture.attributes.map((spec) =>
    toAttributeDefinition(fixture.tenantId, spec, randomUUID()),
  );

  const idx = os.forTenant(fixture.tenantId);
  await idx.deleteIndex(); // start clean for repeatable runs
  await idx.ensureIndex(buildMapping(defs));

  const batchTimings: number[] = [];
  const total = fixture.productCount;
  let inserted = 0;
  const generated: GeneratedProduct[] = [];

  for (let offset = 0; offset < total; offset += BULK_SIZE) {
    const batch: { id: string; source: Record<string, unknown> }[] = [];
    const upper = Math.min(offset + BULK_SIZE, total);
    for (let i = offset; i < upper; i++) {
      const product = generateProduct(fixture, i);
      batch.push({ id: product.id, source: productToDocument(product) });
      generated.push({
        id: product.id,
        sku: product.sku,
        name: product.name,
        priceCents: priceCentsFor(product),
        attributes: product.attributes,
      });
    }
    const startedAt = process.hrtime.bigint();
    const { errors } = await idx.bulkIndex(batch);
    const ms = elapsedMs(startedAt);
    batchTimings.push(ms);
    if (errors) {
      console.warn(`bulk batch reported errors at offset=${offset}`);
    }
    inserted += batch.length;
    if (inserted % 5000 === 0 || inserted === total) {
      process.stdout.write(
        `  ${fixture.tenantId}: ${inserted.toLocaleString()}/${total.toLocaleString()}\r`,
      );
    }
  }
  process.stdout.write('\n');
  await idx.refresh();
  return { batchTimings, productCount: inserted, generated, definitions: defs };
}

/**
 * Maps the catalog's `price` attribute (if any) to a unit price in cents.
 * Tenants without a `price` attr (e.g. books) get a deterministic
 * SKU-derived price so checkout demos still work.
 */
function priceCentsFor(product: Product): number {
  const raw = product.attributes['price'];
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.round(raw * 100);
  }
  // Hash the SKU to a price in [$5.00, $50.00].
  let h = 0;
  for (let i = 0; i < product.sku.length; i++) h = (h * 31 + product.sku.charCodeAt(i)) | 0;
  const dollars = 5 + (Math.abs(h) % 4501) / 100; // 5.00 to 49.99
  return Math.round(dollars * 100);
}

function generateProduct(fixture: TenantFixture, n: number): Product {
  const attrs: Record<string, unknown> = {};
  for (const spec of fixture.attributes) {
    attrs[spec.code] = spec.generate();
  }
  const id = randomUUID();
  return {
    id,
    tenantId: fixture.tenantId,
    sku: `${fixture.tenantId.toUpperCase()}-${String(n).padStart(7, '0')}`,
    name: fixture.productName(),
    attributes: attrs,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function benchmarkSearches(idx: TenantIndex, fixture: TenantFixture): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < SEARCH_SAMPLES; i++) {
    const body = randomSearchBody(fixture);
    const startedAt = process.hrtime.bigint();
    await idx.search(body);
    samples.push(elapsedMs(startedAt));
  }
  return samples;
}

function randomSearchBody(fixture: TenantFixture): Record<string, unknown> {
  // Realistic-ish query mix: text query + 1-2 attribute filters + facets on
  // the enum-typed attributes the storefront would actually surface.
  const filterCandidates = fixture.attributes.filter((a) =>
    ['enum', 'boolean'].includes(a.type),
  );
  const chosen = faker.helpers.arrayElements(filterCandidates, {
    min: 1,
    max: Math.min(2, filterCandidates.length),
  });
  const filter = chosen.map((spec) => ({
    term: { [attributeFieldName(spec.code)]: spec.generate() },
  }));

  return {
    size: 20,
    query: {
      bool: {
        must: [{ match: { name: { query: faker.commerce.productAdjective() } } }],
        filter,
      },
    },
    aggs: Object.fromEntries(
      fixture.attributes
        .filter((a) => a.type === 'enum')
        .map((a) => [`facet_${a.code}`, { terms: { field: attributeFieldName(a.code), size: 20 } }]),
    ),
  };
}

async function main(): Promise<void> {
  faker.seed(42);
  const fixtures = defaultFixtures(PRODUCTS_PER_TENANT);
  const totalTarget = fixtures.reduce((a, f) => a + f.productCount, 0);
  console.log(`seed: ${totalTarget.toLocaleString()} products across ${fixtures.length} tenants`);
  console.log(`  opensearch: ${OS_URL}`);
  console.log(`  per-tenant: ${PRODUCTS_PER_TENANT.toLocaleString()}`);
  console.log(`  bulk size:  ${BULK_SIZE}\n`);

  const osClient = createOpenSearchClient(OS_URL);
  const tenantClient = new TenantSearchClient(osClient);

  const startedAt = process.hrtime.bigint();
  const allBatchTimings: number[] = [];
  const generatedByTenant = new Map<string, GeneratedProduct[]>();
  const definitionsByTenant = new Map<string, AttributeDefinition[]>();
  for (const fixture of fixtures) {
    const t0 = process.hrtime.bigint();
    const { batchTimings, generated, definitions } = await seedTenant(fixture, tenantClient);
    const elapsed = elapsedMs(t0);
    console.log(
      `  ${fixture.tenantId}: ${fixture.productCount.toLocaleString()} indexed in ${(elapsed / 1000).toFixed(1)}s (index: ${indexNameFor(fixture.tenantId)})`,
    );
    allBatchTimings.push(...batchTimings);
    generatedByTenant.set(fixture.tenantId, generated);
    definitionsByTenant.set(fixture.tenantId, definitions);
  }
  const totalElapsed = elapsedMs(startedAt) / 1000;
  const bulk = percentiles(allBatchTimings);
  console.log(
    `\nseed: indexed ${totalTarget.toLocaleString()} products in ${totalElapsed.toFixed(1)}s`,
  );
  console.log(
    `  bulk batch (size=${BULK_SIZE}): p50=${bulk.p50}ms p95=${bulk.p95}ms p99=${bulk.p99}ms max=${bulk.max}ms\n`,
  );

  const sqlClient = createSeedSqlClient(DATABASE_URL);
  try {
    // Catalog first: Postgres is the canonical product store, and attribute
    // definitions must exist before products that reference them (the live
    // API's validator enforces the same ordering).
    console.log('catalog: writing attribute_definitions, products to Postgres');
    for (const fixture of fixtures) {
      const products = generatedByTenant.get(fixture.tenantId) ?? [];
      const definitions = definitionsByTenant.get(fixture.tenantId) ?? [];
      const summary = await seedCatalogForTenant(
        fixture.tenantId,
        definitions,
        products,
        sqlClient,
      );
      console.log(
        `  ${summary.tenantId.padEnd(15)} attrs=${summary.attributeDefinitions}  ` +
          `products=${summary.productsInserted.toLocaleString()}`,
      );
    }
    console.log('');

    console.log('pricing: writing tenant_config, prices, promotions to Postgres');
    for (const fixture of fixtures) {
      const products = generatedByTenant.get(fixture.tenantId) ?? [];
      const summary = await seedPricingForTenant(fixture, products, sqlClient);
      console.log(
        `  ${summary.tenantId.padEnd(15)} ${summary.currency} tax=${(summary.taxRateBps / 100).toFixed(2)}%  ` +
          `prices=${summary.pricesUpserted.toLocaleString()}  promos=${summary.promotionsCreated}`,
      );
    }
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
  console.log('');

  console.log(`post-seed search: ${SEARCH_SAMPLES} random queries per tenant`);
  for (const fixture of fixtures) {
    const idx = tenantClient.forTenant(fixture.tenantId);
    const samples = await benchmarkSearches(idx, fixture);
    const p = percentiles(samples);
    console.log(
      `  ${fixture.tenantId.padEnd(15)} p50=${p.p50}ms  p95=${p.p95}ms  p99=${p.p99}ms  avg=${p.avg.toFixed(1)}ms`,
    );
  }

  await osClient.close();
  console.log('\nseed: done.');
}

main().catch((err) => {
  console.error('seed: failed', err);
  process.exit(1);
});
