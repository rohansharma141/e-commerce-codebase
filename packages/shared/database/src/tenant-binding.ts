import { AsyncLocalStorage } from 'node:async_hooks';
import type { ReservedSql } from 'postgres';
import { createDrizzle, type DrizzleClient } from './drizzle';
import type { PostgresClient } from './pool';

interface TenantBinding {
  readonly reserved: ReservedSql;
  readonly db: DrizzleClient;
  readonly tenantId: string;
}

const tenantBindingStorage = new AsyncLocalStorage<TenantBinding>();

/**
 * Reserves a pooled connection, pins app.tenant_id to the given tenant for the
 * lifetime of that connection, runs fn inside an ALS scope that exposes a
 * Drizzle client built on the reserved connection, and releases on exit.
 *
 * Pairs with the catalog tables' RLS policies (see catalog/db/migrations/0002):
 * every query on this connection inherits the tenant via current_setting().
 */
export async function withTenantConnection<T>(
  sql: PostgresClient,
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const reserved = await sql.reserve();
  try {
    await reserved`SELECT set_config('app.tenant_id', ${tenantId}, false)`;
    // ReservedSql is callable as a tagged template but lacks the static
    // metadata (options.parsers, types, etc) drizzle's postgres-js driver
    // reads at construction. Proxy onto the parent for missing fields so
    // queries route through the reserved connection while drizzle still
    // sees the metadata it expects.
    const sqlLike = new Proxy(reserved as unknown as PostgresClient, {
      get(target, prop, receiver) {
        const direct = Reflect.get(target, prop, receiver);
        if (direct !== undefined) return direct;
        return Reflect.get(sql, prop, receiver);
      },
    });
    const db = createDrizzle(sqlLike);
    return await tenantBindingStorage.run({ reserved, db, tenantId }, fn);
  } finally {
    // CRITICAL: set_config with is_local=false persists on the connection;
    // without resetting before release, the next reservation could inherit
    // this tenant — which would silently defeat RLS for a "no-binding" caller.
    // RESET puts the GUC back to NULL so current_setting(..., true) returns NULL.
    try {
      await reserved`RESET "app.tenant_id"`;
    } catch {
      // swallow — release will return the connection to the pool either way,
      // and the next reserver will RESET before running its query anyway.
    }
    reserved.release();
  }
}

export function currentTenantBinding(): TenantBinding | undefined {
  return tenantBindingStorage.getStore();
}

export function currentTenantDrizzleOrThrow(): DrizzleClient {
  const binding = tenantBindingStorage.getStore();
  if (!binding) {
    throw new Error(
      'No tenant DB binding bound. Code that hits tenant-scoped tables must run inside withTenantConnection().',
    );
  }
  return binding.db;
}

/**
 * Accessor injected into repositories so they get the request-scoped Drizzle
 * client at query time rather than the global singleton. Trivially mockable
 * in unit tests: `{ get: () => stubDrizzle }`.
 */
export interface TenantDrizzleAccessor {
  get(): DrizzleClient;
}

export const tenantDrizzleAccessor: TenantDrizzleAccessor = {
  get: () => currentTenantDrizzleOrThrow(),
};
/**
 * Runs `fn` inside a transaction **on the request's tenant-bound connection**.
 *
 * Use this instead of `db.transaction()`. Always.
 *
 * The Drizzle client from `TENANT_DRIZZLE` is built on a Proxy of the
 * request's reserved postgres-js connection. Single statements route through
 * it correctly, but `db.transaction()` resolves to the PARENT client's
 * `begin()`, which pulls a **fresh** connection from the pool — one with no
 * `app.tenant_id` set. RLS then matches zero rows for everything inside the
 * transaction.
 *
 * The failure is silent, which is what makes it worth a helper. Reads return
 * empty and writes report success having changed nothing; no error is raised,
 * because "UPDATE ... WHERE <policy hides the row>" is a perfectly legal
 * statement that affects zero rows. It was found twice: once in checkout, and
 * again in the channels default-promotion, where a demonstrated probe printed
 * `OUTSIDE: probe-tenant  INSIDE: null`.
 *
 * Manual BEGIN/COMMIT on the reserved connection is the fix, so every Drizzle
 * op inside inherits both the transaction and the GUC.
 */
export async function withTenantTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const binding = tenantBindingStorage.getStore();
  if (!binding) {
    throw new Error(
      'withTenantTransaction requires an active tenant binding. It must run inside ' +
        'withTenantConnection(), or the transaction would silently see zero rows.',
    );
  }
  await binding.reserved`BEGIN`;
  try {
    const result = await fn();
    await binding.reserved`COMMIT`;
    return result;
  } catch (err) {
    try {
      await binding.reserved`ROLLBACK`;
    } catch {
      // The connection is being torn down or already aborted; surface the
      // original failure rather than masking it with a rollback error.
    }
    throw err;
  }
}
