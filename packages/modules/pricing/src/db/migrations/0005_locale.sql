-- Pricing: per-tenant locale.
--
-- Query.capabilities has been reporting a single hardcoded 'en-US' for every
-- tenant since it was added. The storefront already reads that field and
-- formats from it, so the only thing standing between a de-DE tenant and
-- correctly-grouped prices is this column — the consumer side needs no change
-- at all, which is the payoff for having the storefront ask the api rather
-- than assume.
--
-- NOT NULL with a default so existing rows are correct immediately and
-- capabilities never has to answer "unknown". 'en-US' is what the platform
-- was already reporting, so this backfill changes nothing observable.
ALTER TABLE pricing.tenant_config
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en-US';
