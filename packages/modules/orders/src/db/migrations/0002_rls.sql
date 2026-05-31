-- RLS for orders schema. Same pattern as catalog/pricing — FORCE RLS makes the
-- platform role subject to policies (platform is non-superuser per
-- docker/postgres/init/01-platform-role.sql).

ALTER TABLE orders.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON orders.orders FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- order_lines and order_promotion_snapshot have no tenant_id of their own;
-- their isolation is via the FK to orders.orders. Postgres still enforces RLS
-- if enabled on these tables: policies use a subquery to check the parent
-- order's tenant_id. This makes a raw `SELECT * FROM orders.order_lines` on
-- an unbound session also return zero rows (the parent isn't visible).

ALTER TABLE orders.order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.order_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON orders.order_lines FOR ALL
  USING (EXISTS (
    SELECT 1 FROM orders.orders o
    WHERE o.id = orders.order_lines.order_id
      AND o.tenant_id = current_setting('app.tenant_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM orders.orders o
    WHERE o.id = orders.order_lines.order_id
      AND o.tenant_id = current_setting('app.tenant_id', true)
  ));

ALTER TABLE orders.order_promotion_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.order_promotion_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON orders.order_promotion_snapshot FOR ALL
  USING (EXISTS (
    SELECT 1 FROM orders.orders o
    WHERE o.id = orders.order_promotion_snapshot.order_id
      AND o.tenant_id = current_setting('app.tenant_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM orders.orders o
    WHERE o.id = orders.order_promotion_snapshot.order_id
      AND o.tenant_id = current_setting('app.tenant_id', true)
  ));

ALTER TABLE orders.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON orders.idempotency_keys FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
