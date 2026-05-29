/**
 * Integration tests for the catalog repositories + services against a real
 * Postgres. Set TEST_DATABASE_URL to opt in; otherwise skipped (so the unit
 * suite is still runnable without Docker). CI runs Postgres as a service
 * container and exports TEST_DATABASE_URL so this suite runs there.
 *
 * After step 3, RLS is enabled on the catalog tables. Every service call must
 * run inside withTenantConnection() — that's what binds app.tenant_id to the
 * connection so RLS sees the right tenant. The asT helper does the wrapping.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { EventBus } from '@platform/shared/event-bus';
import {
  MigrationRunner,
  tenantDrizzleAccessor,
  withTenantConnection,
} from '@platform/shared/database';
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
  let defsService: AttributeDefinitionsService;
  let productsService: ProductsService;
  let bus: EventBus;

  const asT = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    withTenantConnection(sql, tenantId, fn);

  beforeAll(async () => {
    sql = postgres(TEST_URL as string, { max: 4 });

    const runner = new MigrationRunner(sql);
    await sql.unsafe('DROP SCHEMA IF EXISTS catalog CASCADE');
    await runner.apply(join(__dirname, 'db', 'migrations'), 'catalog');

    bus = new EventBus();
    const defsRepo = new AttributeDefinitionsRepository(tenantDrizzleAccessor);
    defsService = new AttributeDefinitionsService(defsRepo, bus);
    const productsRepo = new ProductsRepository(tenantDrizzleAccessor);
    const validator = new AttributeValidator(defsRepo);
    productsService = new ProductsService(productsRepo, validator, bus);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  afterEach(async () => {
    // TRUNCATE is not subject to RLS policies — runs on the singleton sql client.
    await sql`TRUNCATE catalog.products, catalog.attribute_definitions RESTART IDENTITY`;
    bus.clear();
  });

  it('creates and lists an attribute definition for one tenant only', async () => {
    const t1 = `t-${randomUUID().slice(0, 8)}`;
    const t2 = `t-${randomUUID().slice(0, 8)}`;

    await asT(t1, () =>
      defsService.create(t1, {
        code: 'color',
        type: 'enum',
        config: { allowedValues: ['red', 'blue'] },
      }),
    );

    const t1List = await asT(t1, () => Promise.resolve(defsService.list(t1)));
    const t2List = await asT(t2, () => Promise.resolve(defsService.list(t2)));
    expect(await t1List).toHaveLength(1);
    expect(await t2List).toHaveLength(0);
  });

  it('rejects duplicate attribute codes per tenant', async () => {
    const t = `t-${randomUUID().slice(0, 8)}`;
    await asT(t, () => defsService.create(t, { code: 'sz', type: 'string' }));
    await expect(
      asT(t, () => defsService.create(t, { code: 'sz', type: 'string' })),
    ).rejects.toThrow(/already defined/);
  });

  it('validates product attributes against tenant definitions on create', async () => {
    const t = `t-${randomUUID().slice(0, 8)}`;
    await asT(t, () =>
      defsService.create(t, {
        code: 'color',
        type: 'enum',
        config: { allowedValues: ['red', 'blue'] },
      }),
    );

    const good = await asT(t, () =>
      productsService.create(t, {
        sku: 'SKU-1',
        name: 'Shoe',
        attributes: { color: 'red' },
      }),
    );
    expect(good.attributes['color']).toBe('red');

    await expect(
      asT(t, () =>
        productsService.create(t, {
          sku: 'SKU-2',
          name: 'Shoe',
          attributes: { color: 'purple' },
        }),
      ),
    ).rejects.toThrow();
  });

  it('isolates products by tenant in app-layer reads', async () => {
    const t1 = `t-${randomUUID().slice(0, 8)}`;
    const t2 = `t-${randomUUID().slice(0, 8)}`;

    await asT(t1, () => productsService.create(t1, { sku: 'A', name: 'a' }));
    await asT(t2, () => productsService.create(t2, { sku: 'B', name: 'b' }));

    const t1List = await asT(t1, () => productsService.list(t1, {}));
    const t2List = await asT(t2, () => productsService.list(t2, {}));
    expect(t1List.items).toHaveLength(1);
    expect(t1List.items[0]?.sku).toBe('A');
    expect(t2List.items).toHaveLength(1);
    expect(t2List.items[0]?.sku).toBe('B');
  });

  it('a different tenant cannot reference another tenant attribute definitions', async () => {
    const t1 = `t-${randomUUID().slice(0, 8)}`;
    const t2 = `t-${randomUUID().slice(0, 8)}`;
    await asT(t1, () =>
      defsService.create(t1, {
        code: 'color',
        type: 'enum',
        config: { allowedValues: ['red'] },
      }),
    );

    const attempt = asT(t2, () =>
      productsService.create(t2, {
        sku: 'X',
        name: 'x',
        attributes: { color: 'red' },
      }),
    );
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

    await asT(t, () => productsService.create(t, { sku: 'SKU-EVT', name: 'evt' }));

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]?.[0];
    expect(event.tenantId).toBe(t);
    expect(event.payload.product.sku).toBe('SKU-EVT');
  });

  it('rejects duplicate SKU within a tenant', async () => {
    const t = `t-${randomUUID().slice(0, 8)}`;
    await asT(t, () => productsService.create(t, { sku: 'DUP', name: 'a' }));
    await expect(
      asT(t, () => productsService.create(t, { sku: 'DUP', name: 'b' })),
    ).rejects.toThrow(/already exists/);
  });

  it('updates, then deletes, scoped to tenant', async () => {
    const t = `t-${randomUUID().slice(0, 8)}`;
    const created = await asT(t, () =>
      productsService.create(t, { sku: 'U1', name: 'orig' }),
    );

    const updated = await asT(t, () =>
      productsService.update(t, created.id, { name: 'renamed' }),
    );
    expect(updated.name).toBe('renamed');

    await asT(t, () => productsService.delete(t, created.id));
    await expect(asT(t, () => productsService.getById(t, created.id))).rejects.toThrow();
  });
});
