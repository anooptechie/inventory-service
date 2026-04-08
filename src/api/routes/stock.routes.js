const express = require("express");
const router = express.Router();

const { adjustStock } = require("../../services/stockService");

// simple UUID regex
const isUUID = (id) =>
  /^[0-9a-fA-F-]{36}$/.test(id);

// allowed reasons
const VALID_REASONS = ["sale", "restock", "return", "correction", "damage"];

router.patch("/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const { adjustment, reason } = req.body;

    // 🔹 Validate productId
    if (!isUUID(productId)) {
      return res.status(400).json({
        error: "INVALID_PRODUCT_ID",
      });
    }

    // 🔹 Validate adjustment
    if (typeof adjustment !== "number" || adjustment === 0) {
      return res.status(400).json({
        error: "INVALID_ADJUSTMENT",
        message: "Adjustment must be a non-zero number",
      });
    }

    // 🔹 Validate reason
    if (!VALID_REASONS.includes(reason)) {
      return res.status(400).json({
        error: "INVALID_REASON",
        allowed: VALID_REASONS,
      });
    }

    const userId = "11111111-1111-1111-1111-111111111111";

    const result = await adjustStock({
      productId,
      adjustment,
      reason,
      userId,
    });

    res.status(200).json(result);

  } catch (err) {
    res.status(err.status || 500).json({
      error: err.code || "INTERNAL_SERVER_ERROR",
      message: err.message || "Something went wrong",
      ...(err.available !== undefined && { available: err.available }),
      ...(err.requested !== undefined && { requested: err.requested }),
    });
  }
});

module.exports = router;