const Redis = require("ioredis");
const config = require("../config/env");

const redis = new Redis(config.redis.url, {
  tls: {},
  retryStrategy: (times) => {
    if (times > 3) return null;
    return Math.min(times * 200, 1000);
  },
});

redis.on("connect", () => {
  console.log("Redis connected");
});

redis.on("error", (err) => {
  console.error("Redis error", err);
});

module.exports = redis;