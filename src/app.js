const express = require("express");
const pool = require("./db/postgres");
const redis = require("./db/redis");
const stockRoutes = require("./api/routes/stock.routes");


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

module.exports = app;