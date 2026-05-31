-- RLS for the pricing schema. Same shape as catalog/0002_rls.sql:
-- the platform role is non-superuser/non-bypassrls (see
-- docker/postgres/init/01-platform-role.sql), and FORCE RLS makes the table
-- owner subject to the policies. current_setting('app.tenant_id', true) is
-- set per-request by TenantBindingMiddleware on a reserved pooled connection.

ALTER TABLE pricing.tenant_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing.tenant_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pricing.tenant_config FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pricing.prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing.prices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pricing.prices FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pricing.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing.promotions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pricing.promotions FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
