const pool = require("../db/postgres");

const findByProductId = async (productId) => {
  const { rows } = await pool.query(
    `SELECT product_id, quantity, low_stock_threshold
     FROM stock
     WHERE product_id = $1`,
    [productId]
  );

  return rows[0];
};

module.exports = {
  findByProductId,
};