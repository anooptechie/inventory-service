const express = require("express");
const router = express.Router();

const {
  createOrder,
  confirmOrder,
  cancelOrder,
  fulfilOrder,
} = require("../../services/orderService");

const idempotency = require("../middlewares/idempotency");
const authenticate = require("../middlewares/authenticate");
const authorize = require("../middlewares/authorize");

const { isValidUUID, isPositiveNumber } = require("../../utils/validate");

// 🔹 Create Order (any authenticated user)
router.post("/", idempotency("orders"), authenticate, async (req, res) => {
  try {
    const { items } = req.body;

    // 🔹 Validate items array
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "INVALID_ITEMS" });
    }

    // 🔹 Validate each item
    for (const item of items) {
      if (!isValidUUID(item.productId)) {
        return res.status(400).json({
          error: "INVALID_PRODUCT_ID",
        });
      }

      if (
        !isPositiveNumber(item.quantity) ||
        !Number.isInteger(item.quantity)
      ) {
        return res.status(400).json({
          error: "INVALID_QUANTITY",
          message: "Quantity must be a positive integer",
        });
      }
    }

    const customerId = req.user.userId;
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

// 🔹 Confirm Order (admin / manager)
router.post(
  "/:id/confirm",
  authenticate,
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const orderId = req.params.id;
      const userId = req.user.userId;

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
  },
);

// 🔹 Cancel Order (any authenticated user)
router.post("/:id/cancel", authenticate, async (req, res) => {
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

// 🔹 Fulfil Order (admin / manager)
router.post(
  "/:id/fulfil",
  authenticate,
  authorize("admin", "manager"),
  async (req, res) => {
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
  },
);

module.exports = router;
