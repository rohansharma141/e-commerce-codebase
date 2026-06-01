-- Pricing: add a `theme` JSONB column to tenant_config for storefront branding.
--
-- Why theme lives on pricing.tenant_config: it's another piece of per-tenant
-- configuration, naturally one row per tenant, already RLS-scoped to the
-- tenant. The architectural shortcut is acknowledged in docs/CAVEATS.md —
-- a future "branding" module would own this concern independently; the
-- migration shape stays the same when that extraction happens.
--
-- Shape: JSONB so the storefront's theme contract can evolve (more fields,
-- nested overrides) without further migrations.

ALTER TABLE pricing.tenant_config
  ADD COLUMN IF NOT EXISTS theme jsonb;
