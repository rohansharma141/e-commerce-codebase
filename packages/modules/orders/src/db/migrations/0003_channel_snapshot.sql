-- Orders carry the channel they were sold through, and snapshot how it looked.
--
-- Same discipline as the price and promotion snapshots already in 0001: an
-- order records what was true at checkout, so later edits to the channel never
-- rewrite history. A channel can be renamed, or archived when a market closes;
-- neither may change what an existing order says it was.
--
-- WHY FOUR COLUMNS AND NOT A FOREIGN KEY
--
-- channel_id alone would make rendering an old order a join into another
-- module's table, which the architecture forbids, and would break outright once
-- the channel is archived or channels is extracted. The key and name are copied
-- because they are *display* facts with an order's lifetime, not the channel's.
--
-- currency_minor_units is stored even though the exponent is derived everywhere
-- else (ISO 4217, via Intl). Different rules for different lifetimes: config
-- derives so there is one source of truth and nobody can create
-- GBP-with-exponent-0, but an order must render exactly as it was charged even
-- if a standard later changes. Applying the config rule here would lose history;
-- applying this rule to config would create a writable duplicate of a standard.

ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS channel_id           uuid,
  ADD COLUMN IF NOT EXISTS channel_key          text,
  ADD COLUMN IF NOT EXISTS channel_name         text,
  ADD COLUMN IF NOT EXISTS currency_minor_units integer
    CHECK (currency_minor_units IS NULL OR (currency_minor_units >= 0 AND currency_minor_units <= 4));

-- Backfill: existing orders were placed when the tenant had exactly one selling
-- context, which is precisely what its default channel represents. Naming that
-- is accurate.
--
-- But channel_key and channel_name are deliberately LEFT NULL for those rows.
-- Those are snapshots of how the channel looked at purchase, and at purchase
-- the channel did not exist, so there is no historical name to record. Copying
-- today's name onto a historical order would be inventing a fact rather than
-- preserving one — and it would be indistinguishable from a real snapshot,
-- which is worse than an honest gap. A null here means "placed before this
-- tenant had channels", and the read path renders nothing rather than
-- something false.
--
-- Runs as the table owner, so it is not subject to the FORCE RLS policy on
-- either table and sees every tenant's rows. `0 = 0` is not a risk here because
-- the statement is a correlated UPDATE rather than a count comparison: if it
-- matched nothing, nothing claims it did.
-- GUARDED ON THE SOURCE EXISTING. Module migrations run in whatever order the
-- modules initialise, so on a cold database `channels.channels` may not exist
-- yet. Failing here would make module migration order significant, which it
-- deliberately is not -- and it is invisible on a developer machine, where
-- channels migrated days ago. This project has shipped that exact bug twice
-- (a CREATE EXTENSION race, and a backfill reading a since-dropped column);
-- branding's 0001 carries the same guard for the same reason.
--
-- Skipping quietly is correct. An order with a null channel_id is already the
-- documented state for "placed before this tenant had channels", and the next
-- boot after channels has migrated is not going to re-run this file -- but a
-- database old enough to have both orders and no channels is a database where
-- those orders genuinely predate channels, which is what null means.
--
-- Reading another module's table is otherwise forbidden. A one-time backfill at
-- deploy time is the single exception the architecture allows, exactly as
-- branding's handoff did: it runs once, never on a request path, and the
-- alternative is leaving every existing order unattributable.
DO $$
BEGIN
  IF to_regclass('channels.channels') IS NOT NULL THEN
    UPDATE orders.orders o
       SET channel_id = c.id
      FROM channels.channels c
     WHERE c.tenant_id = o.tenant_id
       AND c.is_default
       AND o.channel_id IS NULL;
  END IF;
END
$$;

-- Deliberately NOT NOT NULL yet. CHANNEL-MODEL section 9 sequences it: nullable
-- first, tighten once the write path always sets it. Tightening now would make
-- this migration fail on any database whose orders predate a default channel --
-- exactly the cold-boot ordering problem that has bitten this project twice.
CREATE INDEX IF NOT EXISTS orders_tenant_channel_idx
  ON orders.orders (tenant_id, channel_id);
