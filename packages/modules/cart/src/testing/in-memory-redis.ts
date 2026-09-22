/**
 * Minimal stand-in for `TenantRedisClient`: a per-tenant key space in a Map.
 *
 * For specs that run the REAL `CartRepository`. A fake repository would test
 * the service's intent and miss the repository dropping a field on save, which
 * is the likelier bug, because `save` rebuilds the stored object field by
 * field. Not imported by production code, so no build includes it.
 */
export function inMemoryTenantRedis(): { client: never; store: Map<string, string> } {
  const store = new Map<string, string>();
  const client = {
    forTenant: (tenantId: string) => ({
      get: async (key: string) => store.get(`${tenantId}|${key}`) ?? null,
      set: async (key: string, value: string) => {
        store.set(`${tenantId}|${key}`, value);
      },
      del: async (key: string) => {
        store.delete(`${tenantId}|${key}`);
      },
    }),
  };
  return { client: client as never, store };
}
