DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_order'
  ) THEN
    ALTER TABLE order_items
    ADD CONSTRAINT fk_order
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_product'
  ) THEN
    ALTER TABLE order_items
    ADD CONSTRAINT fk_product
    FOREIGN KEY (product_id) REFERENCES products(id);
  END IF;
END
$$;