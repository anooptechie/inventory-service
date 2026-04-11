const redis = require("../db/redis");

const addToBlocklist = async (jti, ttl) => {
  await redis.set(`bl:${jti}`, "1", "EX", ttl);
};

const isBlocked = async (jti) => {
  const result = await redis.get(`bl:${jti}`);
  return !!result;
};

module.exports = { addToBlocklist, isBlocked };