/**
 * Integration tests for the catalog repositories + services against a real
 * Postgres. Set TEST_DATABASE_URL to opt in; otherwise skipped (so the unit
 * suite is still runnable without Docker). CI runs Postgres as a service
 * container and exports TEST_DATABASE_URL so this suite runs there.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { EventBus } from '@platform/shared/event-bus';
import { MigrationRunner } from '@platform/shared/database';
import { AttributeDefinitionsRepository } from './attribute-definitions/attribute-definitions.repository';
import { AttributeDefinitionsService } from './attribute-definitions/attribute-definitions.service';
import { ProductsRepository } from './products/products.repository';
import { ProductsService } from './products/products.service';
import { AttributeValidator } from './products/attribute-validator';
import { CATALOG_EVENTS } from '@platform/modules/catalog/contracts';

const TEST_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_URL ? describe : describe.skip;

describeIfDb('catalog integration', () => {
  let sql: Sql;
  let db: PostgresJsDatabase<Record<string, never>>;
  let defsRepo: AttributeDefinitionsRepository;
  let defsService: AttributeDefinitionsService;
  let productsRepo: ProductsRepository;
  let productsService: ProductsService;
  let bus: EventBus;

  beforeAll(async () => {
    sql = postgres(TEST_URL as string, { max: 4 });
    db = drizzle(sql);

    const runner = new MigrationRunner(sql);
    await sql.unsafe('DROP SCHEMA IF EXISTS catalog CASCADE');
    await runner.apply(join(__dirname, 'db', 'migrations'), 'catalog');

    bus = new EventBus();
    defsRepo = new AttributeDefinitionsRepository(db);
    defsService = new AttributeDefinitionsService(defsRepo, bus);
    productsRepo = new ProductsRepository(db);
    const validator = new AttributeValidator(defsRepo);
    productsService = new ProductsService(productsRepo, validator, bus);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  afterEach(async () => {
    await sql`TRUNCATE catalog.products, catalog.attribute_definitions RESTART IDENTITY`;
    bus.clear();
  });

  it('creates and lists an attribute definition for one tenant only', async () => {
    const t1 = `t-${randomUUID().slice(0, 8)}`;
    const t2 = `t-${randomUUID().slice(0, 8)}`;

    await defsService.create(t1, {
      code: 'color',
      type: 'enum',
      config: { allowedValues: ['red', 'blue'] },
    });

    expect(await defsService.list(t1)).toHaveLength(1);
    expect(await defsService.list(t2)).toHaveLength(0);
  });

  it('rejects duplicate attribute codes per tenant', async () => {
    const t = `t-${randomUUID().slice(0, 8)}`;
    await defsService.create(t, { code: 'sz', type: 'string' });
    await expect(defsService.create(t, { code: 'sz', type: 'string' })).rejects.toThrow(
      /already defined/,
    );
  });

  it('validates product attributes against tenant definitions on create', async () => {
    const t = `t-${randomUUID().slice(0, 8)}`;
    await defsService.create(t, {
      code: 'color',
      type: 'enum',
      config: { allowedValues: ['red', 'blue'] },
    });

    const good = await productsService.create(t, {
      sku: 'SKU-1',
      name: 'Shoe',
      attributes: { color: 'red' },
    });
    expect(good.attributes['color']).toBe('red');

    await expect(
      productsService.create(t, {
        sku: 'SKU-2',
        name: 'Shoe',
        attributes: { color: 'purple' },
      }),
    ).rejects.toThrow();
  });

  it('isolates products by tenant in app-layer reads', async () => {
    const t1 = `t-${randomUUID().slice(0, 8)}`;
    const t2 = `t-${randomUUID().slice(0, 8)}`;

    await productsService.create(t1, { sku: 'A', name: 'a' });
    await productsService.create(t2, { sku: 'B', name: 'b' });

    const t1List = await productsService.list(t1, {});
    const t2List = await productsService.list(t2, {});
    expect(t1List.items).toHaveLength(1);
    expect(t1List.items[0]?.sku).toBe('A');
    expect(t2List.items).toHaveLength(1);
    expect(t2List.items[0]?.sku).toBe('B');
  });

  it('a different tenant cannot reference another tenant attribute definitions', async () => {
    const t1 = `t-${randomUUID().slice(0, 8)}`;
    const t2 = `t-${randomUUID().slice(0, 8)}`;
    await defsService.create(t1, {
      code: 'color',
      type: 'enum',
      config: { allowedValues: ['red'] },
    });

    const attempt = productsService.create(t2, {
      sku: 'X',
      name: 'x',
      attributes: { color: 'red' },
    });
    await expect(attempt).rejects.toMatchObject({
      response: {
        message: 'attribute validation failed',
        errors: [{ code: 'color', message: expect.stringMatching(/unknown attribute "color"/) }],
      },
    });
  });

  it('emits catalog.product.created on successful product create', async () => {
    const t = `t-${randomUUID().slice(0, 8)}`;
    const handler = jest.fn();
    bus.subscribe(CATALOG_EVENTS.ProductCreated, handler);

    await productsService.create(t, { sku: 'SKU-EVT', name: 'evt' });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]?.[0];
    expect(event.tenantId).toBe(t);
    expect(event.payload.product.sku).toBe('SKU-EVT');
  });

  it('rejects duplicate SKU within a tenant', async () => {
    const t = `t-${randomUUID().slice(0, 8)}`;
    await productsService.create(t, { sku: 'DUP', name: 'a' });
    await expect(productsService.create(t, { sku: 'DUP', name: 'b' })).rejects.toThrow(
      /already exists/,
    );
  });

  it('updates, then deletes, scoped to tenant', async () => {
    const t = `t-${randomUUID().slice(0, 8)}`;
    const created = await productsService.create(t, { sku: 'U1', name: 'orig' });

    const updated = await productsService.update(t, created.id, { name: 'renamed' });
    expect(updated.name).toBe('renamed');

    await productsService.delete(t, created.id);
    await expect(productsService.getById(t, created.id)).rejects.toThrow();
  });
});
