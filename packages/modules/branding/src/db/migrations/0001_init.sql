-- Branding module: initial schema.
--
-- The theme was previously a jsonb column on pricing.tenant_config — a
-- storage shortcut that left the pricing module owning a concern that has
-- nothing to do with pricing. This table takes ownership.
--
-- One row per tenant, same as before. The theme stays jsonb rather than
-- becoming typed columns: every field is presentational, all of them have
-- defaults, and adding one should not need a migration.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS branding.theme (
  tenant_id  text PRIMARY KEY,
  theme      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Backfill from the pricing column so no tenant loses its branding when the
-- resolver switches over in the next step.
--
-- Two things make this less straightforward than a plain INSERT ... SELECT.
--
-- 1. RLS. Migrations run as `platform`, which is deliberately non-superuser
--    and non-BYPASSRLS, and pricing.tenant_config has FORCE RLS with a
--    predicate on app.tenant_id. With no tenant bound, a migration reading
--    that table sees zero rows and the copy silently succeeds having moved
--    nothing. `NO FORCE` lets the table's owner — which is what a migration
--    runs as — see through its own policy for the duration; non-owners are
--    unaffected. It is restored immediately, in the same transaction, so a
--    failure rolls the whole thing back rather than leaving the source table
--    unprotected. ALTER TABLE takes an ACCESS EXCLUSIVE lock, so no other
--    session can observe the gap.
--
-- 2. This migration touches another module's table, which the architecture
--    otherwise forbids. A handoff of data ownership is the one moment where
--    that is unavoidable: the data has to cross the boundary exactly once,
--    at deployment time, and the alternative is leaving every existing
--    tenant's branding behind. It runs once and is never part of a request.
--
-- Guarded on the source existing: on a fresh database branding may migrate
-- before pricing has created anything, and there is nothing to copy. Skipping
-- quietly is correct — failing would make module migration order significant,
-- which it deliberately is not.
DO $$
BEGIN
  IF to_regclass('pricing.tenant_config') IS NOT NULL THEN
    ALTER TABLE pricing.tenant_config NO FORCE ROW LEVEL SECURITY;

    INSERT INTO branding.theme (tenant_id, theme)
    SELECT tenant_id, theme
      FROM pricing.tenant_config
     WHERE theme IS NOT NULL
    ON CONFLICT (tenant_id) DO NOTHING;

    ALTER TABLE pricing.tenant_config FORCE ROW LEVEL SECURITY;
  END IF;
END
$$;
