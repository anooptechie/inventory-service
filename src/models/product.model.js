const pool = require("../db/postgres");

const createProductWithStock = async (product) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const productRes = await client.query(
      `INSERT INTO products (name, description, sku, price, category_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        product.name,
        product.description,
        product.sku,
        product.price,
        product.categoryId,
      ]
    );

    const createdProduct = productRes.rows[0];

    // auto-create stock
    await client.query(
      `INSERT INTO stock (product_id, quantity, low_stock_threshold)
       VALUES ($1, 0, 10)`,
      [createdProduct.id]
    );

    await client.query("COMMIT");

    return createdProduct;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// Get all products (with stock + filters)
const getProducts = async ({ limit, offset, category, search }) => {
  let query = `
    SELECT p.*, s.quantity
    FROM products p
    JOIN stock s ON s.product_id = p.id
    WHERE p.is_active = true
  `;

  const values = [];
  let idx = 1;

  if (category) {
    query += ` AND p.category_id = $${idx++}`;
    values.push(category);
  }

  if (search) {
    query += ` AND p.name ILIKE $${idx++}`;
    values.push(`%${search}%`);
  }

  query += ` ORDER BY p.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  values.push(limit, offset);

  const { rows } = await pool.query(query, values);

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM products WHERE is_active = true`
  );

  return {
    data: rows,
    total: parseInt(countRes.rows[0].count),
  };
};

// Get single product (with stock)
const findByIdWithStock = async (id) => {
  const { rows } = await pool.query(
    `SELECT p.*, s.quantity
     FROM products p
     JOIN stock s ON s.product_id = p.id
     WHERE p.id = $1 AND p.is_active = true`,
    [id]
  );

  return rows[0];
};

module.exports = {
  createProductWithStock,
  getProducts,
  findByIdWithStock,
};