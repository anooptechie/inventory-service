const express = require("express");
const pool = require("./db/postgres");
const redis = require("./db/redis");
const stockRoutes = require("./api/routes/stock.routes");
const orderRoutes = require("./api/routes/order.routes");
const categoryRoutes = require("./api/routes/category.routes");
const productRoutes = require("./api/routes/product.routes");



const app = express();
app.use(express.json());

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    await redis.ping();

    res.json({
      status: "ok",
      postgres: "connected",
      redis: "connected",
    });
  } catch (err) {
    res.status(503).json({
      status: "error",
      message: err.message,
    });
  }
});

app.use("/stock", stockRoutes);
app.use("/orders", orderRoutes);
app.use("/categories", categoryRoutes);
app.use("/products", productRoutes);

app.use((err, req, res, next) => {
  console.error(err);

  // 🔴 Postgres: Unique violation (e.g. SKU)
  if (err.code === "23505") {
    if (err.constraint === "products_sku_unique") {
      return res.status(409).json({
        error: "SKU_ALREADY_EXISTS",
        message: "Product with this SKU already exists",
      });
    }

    return res.status(409).json({
      error: "RESOURCE_ALREADY_EXISTS",
      message: "Duplicate value violates unique constraint",
    });
  }

  // 🔴 Postgres: Foreign key violation
  if (err.code === "23503") {
    return res.status(400).json({
      error: "INVALID_REFERENCE",
      message: "Referenced resource does not exist",
    });
  }

  // 🔴 Custom thrown errors
  if (err.status && err.message) {
    return res.status(err.status).json({
      error: err.message,
      message: err.message,
    });
  }

  // 🔴 Fallback
  return res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong",
  });
});

module.exports = app;