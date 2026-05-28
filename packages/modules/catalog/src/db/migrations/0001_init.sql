-- Catalog module: initial schema.
-- The catalog Postgres schema is owned by this module exclusively.
-- No cross-schema joins allowed (CLAUDE.md non-negotiable rule).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS catalog.attribute_definitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL,
  code        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('string','number','boolean','enum','date')),
  multi_value boolean NOT NULL DEFAULT false,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attribute_definitions_tenant_idx
  ON catalog.attribute_definitions (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS attribute_definitions_tenant_code_unique
  ON catalog.attribute_definitions (tenant_id, code);

CREATE TABLE IF NOT EXISTS catalog.products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL,
  sku         text NOT NULL,
  name        text NOT NULL,
  attributes  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_tenant_idx
  ON catalog.products (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_sku_unique
  ON catalog.products (tenant_id, sku);
