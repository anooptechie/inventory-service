const express = require("express");
const router = express.Router();

const { adjustStock } = require("../../services/stockService");
const idempotency = require("../middlewares/idempotency");
const stockModel = require("../../models/stock.model");

const authenticate = require("../middlewares/authenticate");
const authorize = require("../middlewares/authorize");

const isUUID = (id) => /^[0-9a-fA-F-]{36}$/.test(id);

const VALID_REASONS = ["sale", "restock", "return", "correction", "damage"];

// 🔹 PATCH stock (admin / manager)
router.patch(
  "/:productId",
  idempotency("stock"),
  authenticate,
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { productId } = req.params;
      const { adjustment, reason } = req.body;

      if (!isUUID(productId)) {
        return res.status(400).json({ error: "INVALID_PRODUCT_ID" });
      }

      const parsedAdjustment = Number(adjustment);

      if (isNaN(parsedAdjustment) || parsedAdjustment === 0) {
        return res.status(400).json({
          error: "INVALID_ADJUSTMENT",
        });
      }

      if (!VALID_REASONS.includes(reason)) {
        return res.status(400).json({
          error: "INVALID_REASON",
          allowed: VALID_REASONS,
        });
      }

      const result = await adjustStock({
        productId,
        adjustment: parsedAdjustment,
        reason,
        userId: req.user.userId,
      });

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

// 🔹 GET stock (any authenticated user)
router.get("/:productId", authenticate, async (req, res, next) => {
  try {
    const { productId } = req.params;

    if (!isUUID(productId)) {
      return res.status(400).json({ error: "INVALID_PRODUCT_ID" });
    }

    const stock = await stockModel.findByProductId(productId);

    if (!stock) {
      return res.status(404).json({ error: "STOCK_NOT_FOUND" });
    }

    return res.json({
      productId: stock.product_id,
      quantity: stock.quantity,
      threshold: stock.low_stock_threshold,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
