const categoryModel = require("../models/category.model");
const paginate = require("../utils/paginate");

const create = async (body) => {
  const { name, description } = body;

  if (!name) {
    throw { status: 400, message: "NAME_REQUIRED" };
  }

  return await categoryModel.createCategory(name, description);
};

const list = async (query) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const offset = (page - 1) * limit;

  const { data, total } = await categoryModel.getCategories(limit, offset);

  return paginate(data, page, limit, total);
};

const update = async (id, body) => {
  const { name, description } = body;

  const category = await categoryModel.findById(id);
  if (!category) {
    throw { status: 404, message: "CATEGORY_NOT_FOUND" };
  }

  return await categoryModel.updateCategory(id, name, description);
};

const remove = async (id) => {
  const category = await categoryModel.findById(id);
  if (!category) {
    throw { status: 404, message: "CATEGORY_NOT_FOUND" };
  }

  await categoryModel.deleteCategory(id);
};

module.exports = {
  create,
  list,
  update,
  remove,
};