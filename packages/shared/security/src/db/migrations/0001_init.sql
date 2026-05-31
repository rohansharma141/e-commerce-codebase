-- Audit log schema. One table only; RLS lands in 0002.
-- Records who did what when for every mutating admin/storefront-checkout
-- request. Joins to pino log lines via request_id for full forensics.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS audit.audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL,
  actor        text,
  method       text NOT NULL,
  path         text NOT NULL,
  status       integer NOT NULL,
  request_id   text NOT NULL,
  body_summary jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_created_idx
  ON audit.audit_log (tenant_id, created_at DESC);
