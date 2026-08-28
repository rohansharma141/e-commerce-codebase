-- RLS for the channels tables.
--
-- Same shape as every other tenant-scoped table: ENABLE plus FORCE, so the
-- non-superuser `platform` role cannot bypass it, and a predicate that fails
-- closed when app.tenant_id is unset.
--
-- Keyed on tenant_id ONLY. There is deliberately no channel predicate: a
-- channel is scope selection *within* an already-resolved tenant, and a policy
-- would imply channels distrust one another, which is not the model. Two
-- channels of one tenant must both be visible to that tenant — the C-5 check
-- asserts exactly that, as a negative control against someone later "hardening"
-- this by adding a channel clause.
--
-- The `app.system_worker` escape hatch is the same one audit.webhook_outbox
-- uses, and it is here for the same reason: reconciliation (C-15) runs on a
-- timer with no request and therefore no bound tenant. Without it RLS would
-- show the reconciler zero rows and it would report success having read
-- nothing — this project's `0 = 0` scar. It is deliberately narrower than
-- running background work as a BYPASSRLS superuser: it grants visibility to
-- these two tables, names the reason, and leaves the platform role
-- non-superuser and non-bypassrls so the RLS proof still means something.
--
-- It fails closed the same way tenant binding does: absent the setting,
-- current_setting(..., true) is NULL, the predicate is false, zero rows.

ALTER TABLE channels.tenant_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels.tenant_defaults FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON channels.tenant_defaults FOR ALL
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    OR current_setting('app.system_worker', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)
    OR current_setting('app.system_worker', true) = 'on'
  );

ALTER TABLE channels.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels.channels FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON channels.channels FOR ALL
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    OR current_setting('app.system_worker', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)
    OR current_setting('app.system_worker', true) = 'on'
  );
