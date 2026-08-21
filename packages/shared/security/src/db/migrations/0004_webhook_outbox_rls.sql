-- RLS for the webhook outbox.
--
-- This table is the one place where the usual "bind a tenant, see that
-- tenant's rows" model does not fit on its own. Rows are WRITTEN inside a
-- tenant-scoped request, exactly like every other table. But they are READ by
-- a background delivery worker on a timer, which has no request and therefore
-- no tenant — and legitimately needs to see every tenant's due deliveries in
-- one pass.
--
-- Three options were considered:
--
--   1. Leave RLS off this table. Rejected: "every table has RLS" stops being
--      true, and the exception would sit in a security schema.
--   2. Have the worker iterate tenants and bind each in turn. Rejected: it
--      needs a tenant list to iterate, and every table that could supply one
--      is itself RLS-protected — the worker would be unable to discover work
--      it is supposed to do.
--   3. An explicit, single-purpose system-worker setting. Chosen.
--
-- `app.system_worker` is set only by the outbox delivery worker, on its own
-- connection, and by nothing on any request path — the tenant middleware sets
-- `app.tenant_id` and never this. It fails closed the same way tenant binding
-- does: absent the setting, `current_setting(..., true)` is NULL, the
-- predicate is false, and the session sees zero rows.
--
-- This is deliberately narrower than the alternative people usually reach for,
-- which is running background work as a BYPASSRLS superuser. That would hand
-- one connection unrestricted access to every table in the database; this
-- grants visibility to exactly one table, names the reason in the policy, and
-- leaves the platform role non-superuser and non-bypassrls as the RLS proof
-- requires.
ALTER TABLE audit.webhook_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.webhook_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON audit.webhook_outbox FOR ALL
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    OR current_setting('app.system_worker', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)
    OR current_setting('app.system_worker', true) = 'on'
  );
