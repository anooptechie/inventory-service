CREATE INDEX IF NOT EXISTS idx_orders_idempotency_key
ON orders(idempotency_key);