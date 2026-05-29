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

/**
 * Hero-feature seed. Bulk-indexes ~PRODUCTS_PER_TENANT products per tenant
 * across the 3 default fixtures directly into OpenSearch via the same
 * TenantSearchClient + document/mapping helpers the live indexer uses.
 *
 * We deliberately do NOT round-trip through the catalog HTTP API here —
 * 100k REST inserts on a laptop is a multi-minute affair and adds zero
 * signal for the search demo. The mapping/document transforms are the same
 * code paths the event-driven indexer runs in production.
 */

const PRODUCTS_PER_TENANT = Number.parseInt(
  process.env['SEED_PRODUCTS_PER_TENANT'] ?? '33000',
  10,
);
const BULK_SIZE = Number.parseInt(process.env['SEED_BULK_SIZE'] ?? '500', 10);
const SEARCH_SAMPLES = Number.parseInt(process.env['SEED_SEARCH_SAMPLES'] ?? '200', 10);
const OS_URL = process.env['OPENSEARCH_URL'] ?? 'http://localhost:9200';

async function seedTenant(
  fixture: TenantFixture,
  os: TenantSearchClient,
): Promise<{ batchTimings: number[]; productCount: number }> {
  const defs: AttributeDefinition[] = fixture.attributes.map((spec) =>
    toAttributeDefinition(fixture.tenantId, spec, randomUUID()),
  );

  const idx = os.forTenant(fixture.tenantId);
  await idx.deleteIndex(); // start clean for repeatable runs
  await idx.ensureIndex(buildMapping(defs));

  const batchTimings: number[] = [];
  const total = fixture.productCount;
  let inserted = 0;

  for (let offset = 0; offset < total; offset += BULK_SIZE) {
    const batch: { id: string; source: Record<string, unknown> }[] = [];
    const upper = Math.min(offset + BULK_SIZE, total);
    for (let i = offset; i < upper; i++) {
      const product = generateProduct(fixture, i);
      batch.push({ id: product.id, source: productToDocument(product) });
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
  return { batchTimings, productCount: inserted };
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
  for (const fixture of fixtures) {
    const t0 = process.hrtime.bigint();
    const { batchTimings } = await seedTenant(fixture, tenantClient);
    const elapsed = elapsedMs(t0);
    console.log(
      `  ${fixture.tenantId}: ${fixture.productCount.toLocaleString()} indexed in ${(elapsed / 1000).toFixed(1)}s (index: ${indexNameFor(fixture.tenantId)})`,
    );
    allBatchTimings.push(...batchTimings);
  }
  const totalElapsed = elapsedMs(startedAt) / 1000;
  const bulk = percentiles(allBatchTimings);
  console.log(
    `\nseed: indexed ${totalTarget.toLocaleString()} products in ${totalElapsed.toFixed(1)}s`,
  );
  console.log(
    `  bulk batch (size=${BULK_SIZE}): p50=${bulk.p50}ms p95=${bulk.p95}ms p99=${bulk.p99}ms max=${bulk.max}ms\n`,
  );

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
