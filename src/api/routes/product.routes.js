const express = require("express");
const router = express.Router();

const productService = require("../../services/productService");
const authenticate = require("../middlewares/authenticate");
const authorize = require("../middlewares/authorize");

// CREATE (admin / manager)
router.post(
  "/",
  authenticate,
  authorize("admin", "manager"),
  async (req, res, next) => {
    try {
      const result = await productService.create(req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// GET ALL (any authenticated)
router.get(
  "/",
  authenticate,
  async (req, res, next) => {
    try {
      const result = await productService.list(req.query);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

// GET BY ID (any authenticated)
router.get(
  "/:id",
  authenticate,
  async (req, res, next) => {
    try {
      const result = await productService.getById(req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;