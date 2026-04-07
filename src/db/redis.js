const Redis = require("ioredis");
const config = require("../config/env");

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
});

redis.on("connect", () => {
  console.log("Redis connected");
});

redis.on("error", (err) => {
  console.error("Redis error", err);
});

module.exports = redis;
