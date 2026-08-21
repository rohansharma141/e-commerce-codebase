-- Transactional outbox for storefront revalidation webhooks.
--
-- Before this table, the dispatcher POSTed to the storefront inline and logged
-- failures. A storefront that was restarting, briefly unreachable, or slow
-- meant the affected page silently stayed stale until the hourly cache
-- backstop expired. Delivery was best-effort with no record that it had been
-- attempted at all.
--
-- Rows are written in the same request that publishes the event, and a
-- background worker delivers them with exponential backoff. This is also the
-- shape the platform would need to move onto a real broker: the outbox is
-- what makes "the event was recorded" and "the event was delivered" two
-- separate, individually-observable facts.

CREATE TABLE IF NOT EXISTS audit.webhook_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  event           text NOT NULL,
  product_id      text,
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The worker's only query: undelivered rows that are due. Partial index so it
-- stays small no matter how much delivered history accumulates.
CREATE INDEX IF NOT EXISTS webhook_outbox_due_idx
  ON audit.webhook_outbox (next_attempt_at)
  WHERE delivered_at IS NULL;

CREATE INDEX IF NOT EXISTS webhook_outbox_tenant_created_idx
  ON audit.webhook_outbox (tenant_id, created_at DESC);
