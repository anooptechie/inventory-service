const pool = require("../db/postgres");
const { writeEvent } = require("./outboxService");
// 1. Import your custom metrics
const { stockInsufficient } = require("../utils/metrics");

const adjustStock = async ({ productId, adjustment, reason, userId }) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Lock row to prevent race conditions (Pessimistic Locking)
    const { rows } = await client.query(
      `SELECT quantity, low_stock_threshold
       FROM stock
       WHERE product_id = $1
       FOR UPDATE`,
      [productId],
    );

    if (!rows.length) {
      throw { status: 404, code: "PRODUCT_NOT_FOUND" };
    }

    const stock = rows[0];
    const newQty = stock.quantity + adjustment;

    // 2. Prevent negative stock
    if (newQty < 0) {
      // 🔥 TRIGGER METRIC: Record the failed attempt in Prometheus
      stockInsufficient.inc();

      throw {
        status: 409,
        code: "INSUFFICIENT_STOCK",
        available: stock.quantity,
        requested: Math.abs(adjustment),
      };
    }

    // 3. Update stock level
    await client.query(
      `UPDATE stock
       SET quantity = $1, updated_at = NOW()
       WHERE product_id = $2`,
      [newQty, productId],
    );

    // 4. Write audit log (Atomic inside the transaction)
    await client.query(
      `INSERT INTO stock_movements
       (product_id, adjustment, quantity_before, quantity_after, reason, performed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [productId, adjustment, stock.quantity, newQty, reason, userId],
    );

    // 5. Outbox Pattern: Trigger low stock event if threshold reached
    if (newQty <= stock.low_stock_threshold) {
      await writeEvent(client, "inventory.low_stock", {
        productId,
        quantity: newQty,
        threshold: stock.low_stock_threshold,
      });
    }

    await client.query("COMMIT");

    return {
      productId,
      quantity: newQty,
      threshold: stock.low_stock_threshold,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    // 🔥 Release the client back to the pool
    client.release();
  }
};

module.exports = { adjustStock };
