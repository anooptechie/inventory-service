const pool = require("../db/postgres");

const adjustStock = async ({ productId, adjustment, reason, userId }) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Lock row
    const { rows } = await client.query(
      `SELECT quantity, low_stock_threshold
       FROM stock
       WHERE product_id = $1
       FOR UPDATE`,
      [productId]
    );

    if (!rows.length) {
      throw { status: 404, code: "PRODUCT_NOT_FOUND" };
    }

    const stock = rows[0];
    const newQty = stock.quantity + adjustment;

    // 2. Prevent negative stock
    if (newQty < 0) {
      throw {
        status: 409,
        code: "INSUFFICIENT_STOCK",
        available: stock.quantity,
        requested: Math.abs(adjustment),
      };
    }

    // 3. Update stock
    await client.query(
      `UPDATE stock
       SET quantity = $1, updated_at = NOW()
       WHERE product_id = $2`,
      [newQty, productId]
    );

    // 4. Write audit (IMPORTANT: inside transaction)
    await client.query(
      `INSERT INTO stock_movements
       (product_id, adjustment, quantity_before, quantity_after, reason, performed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [productId, adjustment, stock.quantity, newQty, reason, userId]
    );

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
    client.release(); // 🔥 NEVER forget this
  }
};

module.exports = { adjustStock };