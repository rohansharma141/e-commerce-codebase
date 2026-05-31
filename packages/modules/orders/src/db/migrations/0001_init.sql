-- Orders module: the transactional core's schema.
-- Snapshots prices, the applied promotion, and the tax rate at checkout time
-- so future edits to catalog/pricing/promotion records never mutate history.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS orders.orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  status              text NOT NULL DEFAULT 'created',
  currency            char(3) NOT NULL,
  subtotal_cents      bigint NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents      bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_rate_bps        integer NOT NULL CHECK (tax_rate_bps >= 0),
  tax_cents           bigint NOT NULL CHECK (tax_cents >= 0),
  grand_total_cents   bigint NOT NULL CHECK (grand_total_cents >= 0),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_tenant_created_idx ON orders.orders (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orders.order_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
  product_id          uuid NOT NULL,
  sku                 text NOT NULL,
  name                text NOT NULL,
  unit_price_cents    bigint NOT NULL CHECK (unit_price_cents >= 0),
  qty                 integer NOT NULL CHECK (qty > 0),
  line_total_cents    bigint NOT NULL CHECK (line_total_cents >= 0)
);
CREATE INDEX IF NOT EXISTS order_lines_order_idx ON orders.order_lines (order_id);

CREATE TABLE IF NOT EXISTS orders.order_promotion_snapshot (
  order_id        uuid PRIMARY KEY REFERENCES orders.orders(id) ON DELETE CASCADE,
  promotion_id    uuid NOT NULL,                 -- reference, not FK (promo may be deleted later)
  kind            text NOT NULL,
  code            text,
  action_type     text NOT NULL,
  action_value    bigint NOT NULL,
  discount_cents  bigint NOT NULL CHECK (discount_cents >= 0)
);

CREATE TABLE IF NOT EXISTS orders.idempotency_keys (
  tenant_id        text NOT NULL,
  idempotency_key  text NOT NULL,
  order_id         uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key)
);
