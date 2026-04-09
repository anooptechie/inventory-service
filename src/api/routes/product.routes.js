const express = require("express");
const router = express.Router();

const productService = require("../../services/productService");

router.post("/", async (req, res, next) => {
  try {
    const result = await productService.create(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// CREATE
router.post("/", async (req, res, next) => {
  try {
    const result = await productService.create(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// GET ALL
router.get("/", async (req, res, next) => {
  try {
    const result = await productService.list(req.query);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET BY ID
router.get("/:id", async (req, res, next) => {
  try {
    const result = await productService.getById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;