const paginate = (data, page = 1, limit = 10, total = 0) => {
  page = parseInt(page);
  limit = parseInt(limit);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      hasNext: page * limit < total,
    },
  };
};

module.exports = paginate;