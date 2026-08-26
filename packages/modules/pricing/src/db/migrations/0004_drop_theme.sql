-- Pricing: drop the theme column. Branding owns it now.
--
-- 0003_branding.sql added this column with a comment explaining that theme
-- rode along on tenant_config because a per-tenant row already existed there.
-- That was a storage shortcut, and it left pricing owning a concern with
-- nothing to do with money. modules/branding now has its own schema, table
-- and resolver, and branding/0001_init.sql copied every row across before
-- anything started reading the new home.
--
-- Safe to drop because the read path moved first and was verified against the
-- old output: by the time this runs, nothing queries this column. Dropping it
-- is what makes the extraction real rather than aspirational — a column left
-- behind is a second source of truth waiting to drift.
ALTER TABLE pricing.tenant_config
  DROP COLUMN IF EXISTS theme;
