const express = require("express");
const router = express.Router();

const categoryService = require("../../services/categoryService");

router.get("/", async (req, res, next) => {
  try {
    const result = await categoryService.list(req.query);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const result = await categoryService.create(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const result = await categoryService.update(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await categoryService.remove(req.params.id);
    res.json({ message: "DELETED" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;