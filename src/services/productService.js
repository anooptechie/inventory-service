const productModel = require("../models/product.model");
const categoryModel = require("../models/category.model");
const paginate = require("../utils/paginate");
const { isValidUUID } = require("../utils/validate");

const create = async (body) => {
  const { name, sku, price, categoryId } = body;

  if (!name || !sku || !price || !categoryId) {
    throw { status: 400, message: "INVALID_INPUT" };
  }

  // 🔥 FIX: validate UUID BEFORE DB
  if (!isValidUUID(categoryId)) {
    throw { status: 400, message: "INVALID_CATEGORY_ID" };
  }

  const category = await categoryModel.findById(categoryId);
  if (!category) {
    throw { status: 404, message: "CATEGORY_NOT_FOUND" };
  }

  return await productModel.createProductWithStock(body);
};

// GET /products
const list = async (query) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const offset = (page - 1) * limit;

  const { data, total } = await productModel.getProducts({
    limit,
    offset,
    category: query.category,
    search: query.search,
  });

  return paginate(data, page, limit, total);
};

// GET /products/:id
const getById = async (id) => {
  const product = await productModel.findByIdWithStock(id);

  if (!product) {
    throw { status: 404, message: "PRODUCT_NOT_FOUND" };
  }

  return product;
};

module.exports = {
  create,
  list,
  getById,
};
