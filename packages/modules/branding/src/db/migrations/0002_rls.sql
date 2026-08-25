-- RLS for branding.theme. Same shape as every other tenant-scoped table:
-- FORCE so the non-superuser platform role cannot bypass it, and a predicate
-- that fails closed when app.tenant_id is unset.
ALTER TABLE branding.theme ENABLE ROW LEVEL SECURITY;
ALTER TABLE branding.theme FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON branding.theme FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
