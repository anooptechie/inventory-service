const express = require("express");
const router = express.Router();

const {
  createOrder,
  confirmOrder,
  cancelOrder,
  fulfilOrder,
} = require("../../services/orderService");

const idempotency = require("../middlewares/idempotency");

// 🔹 Create Order
router.post("/", idempotency("orders"), async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "INVALID_ITEMS",
      });
    }

    const customerId = "11111111-1111-1111-1111-111111111111";

    // ✅ STANDARD HEADER
    const idempotencyKey = req.headers["x-idempotency-key"];

    const result = await createOrder({
      customerId,
      items,
      idempotencyKey,
    });

    return res.status(201).json(result);
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.code || "INTERNAL_SERVER_ERROR",
      message: err.message || "Something went wrong",
      ...(err.available !== undefined && { available: err.available }),
      ...(err.requested !== undefined && { requested: err.requested }),
    });
  }
});

// 🔹 Confirm Order
router.post("/:id/confirm", async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId = "11111111-1111-1111-1111-111111111111";

    const result = await confirmOrder({ orderId, userId });

    return res.status(200).json(result);
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.code || "INTERNAL_SERVER_ERROR",
      message: err.message || "Something went wrong",
      ...(err.available !== undefined && { available: err.available }),
      ...(err.requested !== undefined && { requested: err.requested }),
    });
  }
});

// 🔹 Cancel Order
router.post("/:id/cancel", async (req, res) => {
  try {
    const orderId = req.params.id;

    const result = await cancelOrder({ orderId });

    return res.status(200).json(result);
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.code || "INTERNAL_SERVER_ERROR",
      message: err.message || "Something went wrong",
    });
  }
});

// 🔹 Fulfil Order
router.post("/:id/fulfil", async (req, res) => {
  try {
    const orderId = req.params.id;

    const result = await fulfilOrder({ orderId });

    return res.status(200).json(result);
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.code || "INTERNAL_SERVER_ERROR",
      message: err.message || "Something went wrong",
    });
  }
});

module.exports = router;