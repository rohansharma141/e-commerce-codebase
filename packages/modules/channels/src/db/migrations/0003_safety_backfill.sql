-- C-11: safety backfill for tenants that predate channels.
--
-- WHAT IT IS FOR
--
-- A database created before the channels slice -- `main`, or any deployment
-- not re-seeded since -- has tenants in pricing.tenant_config and no channels
-- at all. A tenant without a default channel resolves nothing: cart creation
-- and checkout call findDefault, which throws, so every basket fails with a
-- 500. This gives each such tenant the smallest configuration that works: a
-- tenant_defaults row, and one default channel that inherits all of it.
--
-- It preserves nothing of value. Gate G-3 settled that the demo tenants are
-- fixtures the seed writes with real values, and the seed replaces these rows.
-- This exists so that a database which skipped a re-seed still works.
--
-- WHAT IT WRITES
--
-- Copied from pricing.tenant_config: currency, locale, tax rate.
-- DEFAULTED, not copied, because nothing held them before channels existed:
--   supported_locales = [locale]   the one locale the tenant already had
--   country           = 'US'
--   timezone          = 'UTC'
--   tax_display       = 'net'      what the engine computed before C-29
-- One channel: key 'web', name 'Web Store', active, the default, and every
-- config column NULL, so it inherits the row above.
--
-- Only tenants with NO channel row at all. On a database seeded since C-11a
-- this changes nothing: NOT EXISTS skips every tenant, and ON CONFLICT keeps a
-- tenant_defaults row that is already there. Without the NOT EXISTS, a second
-- default would violate channels_one_default_per_tenant and the api would fail
-- to boot.
--
-- RLS -- THE TRAP THIS FILE IS SHAPED BY
--
-- Migrations run as `platform`, which owns these tables and is NOSUPERUSER
-- NOBYPASSRLS. Every table touched here is FORCE ROW LEVEL SECURITY, and FORCE
-- is precisely what makes the policies apply to the owner. With no tenant
-- bound, a migration sees zero rows in pricing.tenant_config and may insert
-- nothing into the channels tables -- and neither is an error. Orders' 0003
-- assumed the opposite, and its backfill silently matched nothing (C-33).
--
-- So RLS is lifted explicitly, for this transaction only. NO FORCE lets the
-- owner through, and FORCE is restored before the block ends. The runner wraps
-- the file in a transaction, so a failure rolls everything back rather than
-- leaving a table unprotected, and ALTER TABLE's ACCESS EXCLUSIVE lock means no
-- other session can observe the gap. Branding's 0001 does the same to
-- pricing.tenant_config, for the same reason.
--
-- NO FORCE rather than the channels tables' app.system_worker clause: that
-- would need a setting, and a setting is one more thing that can outlive the
-- transaction on a pooled connection. pricing.tenant_config has no such clause
-- in any case.
--
-- READING ANOTHER MODULE'S TABLE
--
-- Forbidden on a request path. A one-time copy at deploy time is the single
-- exception the architecture allows (branding's 0001, orders' 0003): channels
-- takes ownership of per-tenant currency, locale and tax, and that data has to
-- cross the boundary once.
--
-- GUARDED on all three source columns existing, which also covers the table
-- not existing. Module migration order is not fixed, so on a fresh database
-- pricing may not have migrated yet; and a later pricing migration may drop a
-- column this reads, which is how branding's 0001 once failed a fresh install
-- at boot. Skipping is correct either way: there is nothing to copy.
DO $$
BEGIN
  IF (SELECT count(*)
        FROM information_schema.columns
       WHERE table_schema = 'pricing'
         AND table_name = 'tenant_config'
         AND column_name IN ('currency', 'locale', 'tax_rate_bps')) < 3 THEN
    RETURN;
  END IF;

  ALTER TABLE pricing.tenant_config    NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE channels.tenant_defaults NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE channels.channels        NO FORCE ROW LEVEL SECURITY;

  INSERT INTO channels.tenant_defaults
    (tenant_id, currency_code, default_locale, supported_locales,
     country, timezone, tax_display, tax_rate_bps)
  SELECT tc.tenant_id, tc.currency::text, tc.locale, ARRAY[tc.locale],
         'US', 'UTC', 'net', tc.tax_rate_bps
    FROM pricing.tenant_config tc
   WHERE NOT EXISTS (SELECT 1 FROM channels.channels c WHERE c.tenant_id = tc.tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  INSERT INTO channels.channels (tenant_id, key, name, status, is_default)
  SELECT tc.tenant_id, 'web', 'Web Store', 'active', true
    FROM pricing.tenant_config tc
   WHERE NOT EXISTS (SELECT 1 FROM channels.channels c WHERE c.tenant_id = tc.tenant_id);

  ALTER TABLE channels.channels        FORCE ROW LEVEL SECURITY;
  ALTER TABLE channels.tenant_defaults FORCE ROW LEVEL SECURITY;
  ALTER TABLE pricing.tenant_config    FORCE ROW LEVEL SECURITY;
END
$$;
