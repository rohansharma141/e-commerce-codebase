-- C-33: orders' channel backfill, written so that it can see the rows.
--
-- 0003_channel_snapshot.sql attempted this and matched nothing. Its comment
-- says the migration "runs as the table owner, so it is not subject to the
-- FORCE RLS policy on either table". FORCE means the opposite: it is what
-- makes the policies apply to the owner. `platform` is NOSUPERUSER
-- NOBYPASSRLS and 0003 binds no tenant, so both tables looked empty to its
-- UPDATE, which succeeded having changed nothing. It went unseen because
-- nothing ever ran it with orders already present: C-16a was verified on a
-- cold database, and checkout.integration drops the orders schema first.
--
-- 0003 cannot be corrected in place -- the runner checksums applied files
-- and refuses to boot on a change -- so its wrong comment stays and this file
-- is the correction. The intent is 0003's, unchanged: an order placed before
-- the tenant had channels was placed in its one selling context, which is
-- what the default channel represents. channel_key and channel_name stay NULL
-- for those orders, as 0003 argued: there was no channel name at purchase,
-- and copying today's would be indistinguishable from a real snapshot.
--
-- HOW RLS IS LIFTED
--
-- orders.orders is this module's own table and its policy has no system
-- worker clause: NO FORCE for this transaction, restored before the block
-- ends. The runner wraps the file in a transaction, so a failure rolls back
-- rather than leaving the table unprotected, and ALTER TABLE's ACCESS
-- EXCLUSIVE lock means no other session can observe the gap.
--
-- channels.channels belongs to another module, so this does not alter its
-- RLS. Its policy already admits `app.system_worker = 'on'`, for exactly this
-- kind of read with no request behind it. The setting is transaction-local --
-- set_config's third argument is `true` -- so it ends with the transaction and
-- cannot outlive it on the pooled connection the runner hands back.
--
-- ORDER. Modules migrate audit, catalog, channels, pricing, branding, orders
-- (observed in the boot log, 2026-09-22), so on an upgraded database the
-- channels migrations -- including C-11's backfill of a default channel for
-- every channel-less tenant -- have run before this. Guarded anyway, because
-- that order is a property of the composition root, not a guarantee: without
-- channels there is nothing to attribute to, and a null channel_id already
-- means "placed before this tenant had channels".
--
-- Only rows whose channel_id is null are touched. Every order checkout has
-- written since C-16a carries one, so on a current database this changes
-- nothing.
DO $$
BEGIN
  IF to_regclass('channels.channels') IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('app.system_worker', 'on', true);
  ALTER TABLE orders.orders NO FORCE ROW LEVEL SECURITY;

  UPDATE orders.orders o
     SET channel_id = c.id
    FROM channels.channels c
   WHERE c.tenant_id = o.tenant_id
     AND c.is_default
     AND o.channel_id IS NULL;

  ALTER TABLE orders.orders FORCE ROW LEVEL SECURITY;
END
$$;
