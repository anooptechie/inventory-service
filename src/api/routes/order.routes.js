const express = require("express");
const router = express.Router();

const { createOrder } = require("../../services/orderService");
const idempotency = require("../middlewares/idempotency");

// basic validation
router.post(
  "/",
  idempotency("orders"),
  async (req, res) => {
    try {
      const { items } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error: "INVALID_ITEMS",
        });
      }

      const customerId = "11111111-1111-1111-1111-111111111111"; // temp
      const idempotencyKey = req.headers["x-idempotency-key"];

      const result = await createOrder({
        customerId,
        items,
        idempotencyKey,
      });

      res.status(201).json(result);

    } catch (err) {
      message: err.message || "Something went wrong"

      res.status(err.status || 500).json({
        error: err.code || "INTERNAL_SERVER_ERROR",
        message: err.message || "Something went wrong",
        ...(err.available !== undefined && { available: err.available }),
        ...(err.requested !== undefined && { requested: err.requested }),
      });
    }
  }
);

module.exports = router;