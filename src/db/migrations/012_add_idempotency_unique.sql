DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'unique_idempotency_key'
  ) THEN
    ALTER TABLE orders
    ADD CONSTRAINT unique_idempotency_key UNIQUE (idempotency_key);
  END IF;
END
$$;