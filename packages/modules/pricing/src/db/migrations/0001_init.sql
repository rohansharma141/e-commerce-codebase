-- Pricing module: initial schema.
-- Owns money-config-per-tenant (currency + tax rate), per-product prices,
-- and the promotion engine's rule store. RLS lands in 0002.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS pricing.tenant_config (
  tenant_id     text PRIMARY KEY,
  currency      char(3) NOT NULL,
  tax_rate_bps  integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pricing.prices (
  tenant_id        text NOT NULL,
  product_id       uuid NOT NULL,
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_id)
);
CREATE INDEX IF NOT EXISTS prices_tenant_idx ON pricing.prices (tenant_id);

CREATE TABLE IF NOT EXISTS pricing.promotions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('coupon-code','automatic')),
  code             text,
  condition_type   text NOT NULL CHECK (condition_type IN ('always','cart-total-min','contains-product')),
  condition_value  jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type      text NOT NULL CHECK (action_type IN ('percent','fixed')),
  action_value     bigint NOT NULL CHECK (action_value > 0),
  expires_at       timestamptz,
  max_uses         integer CHECK (max_uses IS NULL OR max_uses > 0),
  uses_count       integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'coupon-code' AND code IS NOT NULL) OR (kind = 'automatic'))
);
CREATE UNIQUE INDEX IF NOT EXISTS promotions_tenant_code_unique
  ON pricing.promotions (tenant_id, code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS promotions_tenant_kind_active_idx
  ON pricing.promotions (tenant_id, kind, active);
