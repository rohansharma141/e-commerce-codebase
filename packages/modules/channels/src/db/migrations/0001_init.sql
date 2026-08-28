-- Channels module: initial schema.
--
-- Two tables. `tenant_defaults` is the per-tenant baseline; `channels` are the
-- selling contexts that inherit from it. Every config column on `channels` is
-- nullable and null means INHERIT — not "unset" and not "empty". That is what
-- keeps "inherited" distinguishable from "happens to equal the default", which
-- the back office needs in order to know whether to offer an override.
--
-- A sales channel only. Supply is a separate concept and will bring its own
-- InventorySource; see ADR-0014.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS channels.tenant_defaults (
  tenant_id          text PRIMARY KEY,
  currency_code      text        NOT NULL,              -- ISO 4217
  default_locale     text        NOT NULL,              -- BCP 47
  supported_locales  text[]      NOT NULL,              -- BCP 47
  country            text        NOT NULL,              -- ISO 3166-1 alpha-2
  timezone           text        NOT NULL,              -- IANA
  tax_display        text        NOT NULL,              -- gross | net
  -- Interim: one flat rate. No tax classes, no destination-based US tax, no
  -- EU OSS, no B2B reverse charge. Nullable so it can go away when a real tax
  -- provider lands without a second migration to make it optional.
  tax_rate_bps       integer,
  version            integer     NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenant_defaults_tax_display_valid
    CHECK (tax_display IN ('gross', 'net')),
  CONSTRAINT tenant_defaults_tax_rate_sane
    CHECK (tax_rate_bps IS NULL OR (tax_rate_bps >= 0 AND tax_rate_bps <= 100000)),
  CONSTRAINT tenant_defaults_locales_non_empty
    CHECK (array_length(supported_locales, 1) >= 1)
);

CREATE TABLE IF NOT EXISTS channels.channels (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text        NOT NULL,
  -- Immutable once status leaves 'draft'. Enforced in the repository rather
  -- than by DDL, because the rule is conditional on status and a CHECK cannot
  -- see the previous row. See channels/contracts/src/invariants.ts.
  key                text        NOT NULL,
  name               text        NOT NULL,
  status             text        NOT NULL DEFAULT 'draft',
  is_default         boolean     NOT NULL DEFAULT false,
  -- Set by the orders.created consumer. Freezes currency_code: changing it
  -- after money has moved silently reinterprets every existing order's
  -- minor-unit integers.
  has_transacted     boolean     NOT NULL DEFAULT false,
  version            integer     NOT NULL DEFAULT 1,

  -- NULL means inherit from channels.tenant_defaults.
  currency_code      text,
  default_locale     text,
  supported_locales  text[],
  country            text,
  timezone           text,
  tax_display        text,
  tax_rate_bps       integer,

  -- Opaque mapping to an ERP/OMS/PIM. The platform never interprets it.
  external_ref       text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT channels_status_valid
    CHECK (status IN ('draft', 'active', 'archived')),
  CONSTRAINT channels_tax_display_valid
    CHECK (tax_display IS NULL OR tax_display IN ('gross', 'net')),
  CONSTRAINT channels_tax_rate_sane
    CHECK (tax_rate_bps IS NULL OR (tax_rate_bps >= 0 AND tax_rate_bps <= 100000)),
  -- Matches CHANNEL_KEY_RE in the contracts. Duplicated here on purpose: the
  -- application check gives a readable error, this one means a direct SQL
  -- write cannot introduce a key that breaks a URL path.
  CONSTRAINT channels_key_format
    CHECK (key ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  CONSTRAINT channels_locales_non_empty
    CHECK (supported_locales IS NULL OR array_length(supported_locales, 1) >= 1)
);

-- Keys are unique per tenant, not globally: two tenants may both have a 'uk'.
CREATE UNIQUE INDEX IF NOT EXISTS channels_tenant_key_unique
  ON channels.channels (tenant_id, key);

-- Exactly one default per tenant.
--
-- A partial unique index rather than an application check, because the default
-- is what unspecified requests fall back to and an application-only guarantee
-- fails open. Promotion is two writes (unset the old, set the new) racing this
-- index, so the repository must do it in one transaction in a deterministic
-- order — otherwise the failure is an intermittent constraint violation that
-- appears in production and nowhere else.
CREATE UNIQUE INDEX IF NOT EXISTS channels_one_default_per_tenant
  ON channels.channels (tenant_id)
  WHERE is_default;

-- Resolution reads by (tenant, key) — covered by the unique index above — and
-- lists a tenant's active channels on the request path.
CREATE INDEX IF NOT EXISTS channels_tenant_status_idx
  ON channels.channels (tenant_id, status);
