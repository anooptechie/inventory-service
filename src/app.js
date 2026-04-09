const express = require("express");
const pool = require("./db/postgres");
const redis = require("./db/redis");

const stockRoutes = require("./api/routes/stock.routes");
const orderRoutes = require("./api/routes/order.routes");
const categoryRoutes = require("./api/routes/category.routes");
const productRoutes = require("./api/routes/product.routes");

const traceId = require("./utils/traceId");
const { register } = require("./utils/metrics"); // ✅ FIXED
const metricsMiddleware = require("./api/middlewares/metrics.middleware");

const app = express();

// 🔥 1. core middleware
app.use(express.json());

// 🔥 2. traceId MUST come early
app.use(traceId);

// 🔥 3. metrics middleware
app.use(metricsMiddleware);

// 🔥 4. metrics endpoint
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// 🔥 5. request logging middleware
app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;

    req.log.info({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration,
    });
  });

  next();
});

// 🔥 6. health route
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

// 🔥 7. routes
app.use("/stock", stockRoutes);
app.use("/orders", orderRoutes);
app.use("/categories", categoryRoutes);
app.use("/products", productRoutes);

// 🔥 8. error handler (always last)
app.use((err, req, res, next) => {
  req.log.error({ err }, "Unhandled error");

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

  if (err.code === "23503") {
    return res.status(400).json({
      error: "INVALID_REFERENCE",
      message: "Referenced resource does not exist",
    });
  }

  if (err.status && err.message) {
    return res.status(err.status).json({
      error: err.message,
      message: err.message,
    });
  }

  return res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong",
  });
});

module.exports = app;