CREATE INDEX IF NOT EXISTS idx_stock_product_id
ON stock(product_id);

CREATE INDEX IF NOT EXISTS idx_orders_status
ON orders(status);

CREATE INDEX IF NOT EXISTS idx_outbox_status
ON outbox_events(status);