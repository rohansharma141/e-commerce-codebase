/**
 * End-to-end search integration test against a real OpenSearch.
 * Skipped unless TEST_OPENSEARCH_URL is set. CI brings up an opensearch
 * service container and exports the env var so this suite runs there.
 *
 * Covers the hero-feature guarantees:
 *  - per-tenant indices (physical isolation by construction)
 *  - text + filter + facet query in a single round-trip
 *  - mapping evolution: a new attribute definition adds a field to the
 *    tenant's index without disturbing the other tenants' indices
 *  - product update → document re-index → new value visible immediately
 *    after an explicit refresh
 *  - product delete → 404 on subsequent fetch
 */
import { randomUUID } from 'node:crypto';
import { EventBus } from '@platform/shared/event-bus';
import {
  TenantSearchClient,
  createOpenSearchClient,
  indexNameFor,
} from '@platform/shared/opensearch';
import {
  CATALOG_EVENTS,
  type AttributeDefinition,
  type Product,
} from '@platform/modules/catalog/contracts';
import { ProductIndexerService } from './indexer/product-indexer.service';
import { SearchService } from './search/search.service';

const OS_URL = process.env['TEST_OPENSEARCH_URL'];
const describeIfOs = OS_URL ? describe : describe.skip;

jest.setTimeout(20_000);

describeIfOs('search integration', () => {
  const t1 = `t1-${randomUUID().slice(0, 8)}`;
  const t2 = `t2-${randomUUID().slice(0, 8)}`;
  let osClient: ReturnType<typeof createOpenSearchClient>;
  let searchClient: TenantSearchClient;
  let bus: EventBus;
  let indexer: ProductIndexerService;
  let search: SearchService;

  const publish = (name: string, payload: unknown, tenantId: string) =>
    bus.publish({
      name,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      tenantId,
      payload: payload as never,
    });

  /**
   * The bus dispatches via queueMicrotask + chained promises; setImmediate
   * isn't long enough to guarantee an async handler that talks to OpenSearch
   * has actually completed. Poll the predicate instead.
   */
  const waitFor = async (
    pred: () => Promise<boolean>,
    { timeoutMs = 5000, intervalMs = 50 } = {},
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await pred()) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`waitFor: predicate not satisfied within ${timeoutMs}ms`);
  };

  const waitForCount = async (tenantId: string, expectedAtLeast: number): Promise<void> => {
    const idx = searchClient.forTenant(tenantId);
    await waitFor(async () => {
      try {
        await idx.refresh();
        const r = await idx.search({ size: 0, query: { match_all: {} } });
        return r.hits.total.value >= expectedAtLeast;
      } catch {
        return false;
      }
    });
  };

  /**
   * Publish an attribute-definition event and wait until the indexer has
   * applied the mapping. This mirrors the realistic operator flow ("define
   * attributes, then add products") and avoids the race where a product
   * arriving alongside its tenant's first attribute definition gets rejected
   * by the strict-dynamic mapping. Production callers wait the same way:
   * the catalog admin API doesn't return until the attribute def is persisted,
   * giving the indexer a head start.
   */
  const publishAttrDefAndWait = async (
    tenantId: string,
    defPartial: Partial<AttributeDefinition>,
  ): Promise<void> => {
    const d = def({ tenantId, ...defPartial });
    await publish(CATALOG_EVENTS.AttributeDefinitionCreated, { definition: d }, tenantId);
    const fieldName = `attr_${d.code}`;
    const idx = searchClient.forTenant(tenantId);
    await waitFor(async () => {
      try {
        const r = await osClient.indices.getMapping({ index: idx.indexName });
        const props = (r.body as Record<string, { mappings?: { properties?: Record<string, unknown> } }>)[
          idx.indexName
        ]?.mappings?.properties;
        return Boolean(props?.[fieldName]);
      } catch {
        return false;
      }
    });
  };

  const def = (partial: Partial<AttributeDefinition>): AttributeDefinition => ({
    id: randomUUID(),
    tenantId: t1,
    code: 'color',
    type: 'string',
    multiValue: false,
    config: {} as AttributeDefinition['config'],
    createdAt: new Date().toISOString(),
    ...partial,
  });

  const product = (partial: Partial<Product>): Product => ({
    id: randomUUID(),
    tenantId: t1,
    sku: 'SKU',
    name: 'thing',
    attributes: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  });

  beforeAll(async () => {
    osClient = createOpenSearchClient(OS_URL as string);
    searchClient = new TenantSearchClient(osClient);
    bus = new EventBus();
    indexer = new ProductIndexerService(bus, searchClient);
    indexer.onModuleInit();
    search = new SearchService(searchClient);

    // Reset both tenant indices for repeatable runs.
    for (const t of [t1, t2]) {
      await searchClient.forTenant(t).deleteIndex();
    }
  });

  afterAll(async () => {
    for (const t of [t1, t2]) {
      await searchClient.forTenant(t).deleteIndex();
    }
    await osClient.close();
  });

  it('a product.created event indexes the document and search finds it', async () => {
    await publishAttrDefAndWait(t1, {
      code: 'color',
      type: 'enum',
      config: { allowedValues: ['red', 'blue'] } as never,
    });
    const p = product({ tenantId: t1, sku: 'A1', name: 'Crimson Sneaker', attributes: { color: 'red' } });
    await publish(CATALOG_EVENTS.ProductCreated, { product: p }, t1);

    await waitForCount(t1, 1);

    const result = await search.search(t1, {
      query: 'Crimson',
      facets: ['color'],
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.sku).toBe('A1');
    expect(result.items[0]?.attributes['color']).toBe('red');
    const colorFacet = result.facets.find((f) => f.attribute === 'color');
    expect(colorFacet?.buckets).toEqual([{ value: 'red', count: 1 }]);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('physical isolation: t2 cannot see t1 products', async () => {
    await publishAttrDefAndWait(t2, {
      code: 'color',
      type: 'enum',
      config: { allowedValues: ['green'] } as never,
    });
    const p = product({
      tenantId: t2,
      sku: 'B1',
      name: 'Mint Mug',
      attributes: { color: 'green' },
    });
    await publish(CATALOG_EVENTS.ProductCreated, { product: p }, t2);

    await waitForCount(t2, 1);

    const t2Result = await search.search(t2, {});
    expect(t2Result.total).toBe(1);
    expect(t2Result.items[0]?.sku).toBe('B1');

    const t1Result = await search.search(t1, { query: 'Mug' });
    expect(t1Result.total).toBe(0);
  });

  it('the two tenants live in separate indices on disk', async () => {
    const i1 = indexNameFor(t1);
    const i2 = indexNameFor(t2);
    expect(i1).not.toBe(i2);
    const exists1 = await osClient.indices.exists({ index: i1 });
    const exists2 = await osClient.indices.exists({ index: i2 });
    expect(exists1.body).toBe(true);
    expect(exists2.body).toBe(true);
  });

  it('mapping evolution: a NEW attribute definition makes the new facet queryable without touching the other tenants', async () => {
    await publishAttrDefAndWait(t1, {
      code: 'size',
      type: 'enum',
      config: { allowedValues: ['M'] } as never,
    });
    const p = product({ tenantId: t1, sku: 'A2', name: 'Sized Item', attributes: { color: 'red', size: 'M' } });
    await publish(CATALOG_EVENTS.ProductCreated, { product: p }, t1);

    await waitFor(async () => {
      await searchClient.forTenant(t1).refresh();
      const r = await search.search(t1, { filters: [{ attribute: 'size', eq: 'M' }] });
      return r.total >= 1;
    });

    const result = await search.search(t1, {
      facets: ['size'],
      filters: [{ attribute: 'size', eq: 'M' }],
    });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.facets[0]?.attribute).toBe('size');
    expect(result.facets[0]?.buckets[0]).toEqual({ value: 'M', count: 1 });
  });

  it('product.updated re-indexes with the new attributes', async () => {
    const p = product({ tenantId: t1, sku: 'A3', name: 'Old', attributes: { color: 'red' } });
    await publish(CATALOG_EVENTS.ProductCreated, { product: p }, t1);

    const updated = { ...p, name: 'Renamed', attributes: { color: 'blue' }, updatedAt: new Date().toISOString() };
    await publish(CATALOG_EVENTS.ProductUpdated, { product: updated, previous: p }, t1);

    await waitFor(async () => {
      await searchClient.forTenant(t1).refresh();
      const r = await search.search(t1, { filters: [{ attribute: 'color', eq: 'blue' }] });
      return r.items.some((i) => i.sku === 'A3' && i.name === 'Renamed');
    });
  });

  it('product.deleted removes the document', async () => {
    const p = product({ tenantId: t1, sku: 'A4', name: 'Goner', attributes: { color: 'red' } });
    await publish(CATALOG_EVENTS.ProductCreated, { product: p }, t1);
    await waitFor(async () => (await search.search(t1, { query: 'Goner' })).total === 1);

    await publish(CATALOG_EVENTS.ProductDeleted, { product: p }, t1);
    await waitFor(async () => {
      await searchClient.forTenant(t1).refresh();
      return (await search.search(t1, { query: 'Goner' })).total === 0;
    });
  });

  it('event redelivery is idempotent (same eventId only indexes once)', async () => {
    const sharedEventId = randomUUID();
    const p = product({ tenantId: t1, sku: 'A5', name: 'Once', attributes: { color: 'red' } });
    const e = {
      name: CATALOG_EVENTS.ProductCreated,
      eventId: sharedEventId,
      occurredAt: new Date().toISOString(),
      tenantId: t1,
      payload: { product: p } as never,
    };
    await bus.publish(e);
    await bus.publish(e);
    await waitFor(async () => (await search.search(t1, { query: 'Once' })).total === 1);

    // Wait a beat to make sure a second indexing call would have completed
    // if dedupe was broken.
    await new Promise((r) => setTimeout(r, 250));
    await searchClient.forTenant(t1).refresh();
    expect((await search.search(t1, { query: 'Once' })).total).toBe(1);
  });
});
