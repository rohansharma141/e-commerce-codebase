-- Row-level security for catalog tables.
--
-- Every catalog.* row is scoped to a tenant_id; this migration enforces that
-- at the database, not just the app. Policies read app.tenant_id from the
-- session GUC, which the api sets via packages/shared/database/tenant-binding
-- once per request on a reserved pooled connection.
--
-- FORCE RLS is critical: without it, the table owner (the role we connect as
-- in dev) is exempt and the policies are silently a no-op for our queries.
-- With FORCE, the owner is subject to RLS too.
--
-- current_setting('app.tenant_id', true) — the `true` second arg makes the
-- function return NULL instead of erroring when the GUC isn't set. NULL
-- compared with tenant_id is always false, so an unbound session sees zero
-- rows rather than a hard error. That's deliberate: it's what makes the
-- killshot test ("no binding → 0 rows") meaningful.

ALTER TABLE catalog.attribute_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.attribute_definitions FORCE ROW LEVEL SECURITY;

ALTER TABLE catalog.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.products FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation
  ON catalog.attribute_definitions
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation
  ON catalog.products
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
