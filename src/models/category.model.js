const pool = require("../db/postgres");

// Create
const createCategory = async (name, description) => {
  const { rows } = await pool.query(
    `INSERT INTO categories (name, description)
     VALUES ($1, $2)
     RETURNING *`,
    [name, description]
  );
  return rows[0];
};

// Get all
const getCategories = async (limit, offset) => {
  const { rows } = await pool.query(
    `SELECT * FROM categories
     WHERE is_active = true
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  const count = await pool.query(
    `SELECT COUNT(*) FROM categories WHERE is_active = true`
  );

  return {
    data: rows,
    total: parseInt(count.rows[0].count),
  };
};

// Find by ID
const findById = async (id) => {
  const { rows } = await pool.query(
    `SELECT * FROM categories WHERE id = $1 AND is_active = true`,
    [id]
  );
  return rows[0];
};

// Update
const updateCategory = async (id, name, description) => {
  const { rows } = await pool.query(
    `UPDATE categories
     SET name = COALESCE($1, name),
         description = COALESCE($2, description),
         updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [name, description, id]
  );
  return rows[0];
};

// Soft delete
const deleteCategory = async (id) => {
  await pool.query(
    `UPDATE categories SET is_active = false WHERE id = $1`,
    [id]
  );
};

module.exports = {
  createCategory,
  getCategories,
  findById,
  updateCategory,
  deleteCategory,
};