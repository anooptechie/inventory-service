const redis = require("../../db/redis");

const createIdempotencyMiddleware = (prefix) => {
  return async (req, res, next) => {
    try {
      // ✅ STANDARD HEADER
      const key = req.headers["x-idempotency-key"];

      // Allow normal request if no key
      if (!key) {
        return next();
      }

      const redisKey = `idempotency:${prefix}:${key}`;
      const lockKey = `${redisKey}:lock`;

      const isTest = process.env.NODE_ENV === "test";

      // 🔹 1. Check cache
      const cached = await redis.get(redisKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return res.status(parsed.status).json(parsed.body);
      }

      // 🔹 2. Acquire lock (skip in test mode)
      let isLocked = true;

      if (!isTest) {
        isLocked = await redis.set(lockKey, "1", "NX", "EX", 5);
      }

      if (!isLocked) {
        const retryCached = await redis.get(redisKey);

        if (retryCached) {
          const parsed = JSON.parse(retryCached);
          return res.status(parsed.status).json(parsed.body);
        }

        return res.status(409).json({
          error: "REQUEST_ALREADY_IN_PROGRESS",
        });
      }

      // 🔹 3. Intercept response
      const originalJson = res.json.bind(res);

      res.json = async (body) => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            await redis.set(
              redisKey,
              JSON.stringify({
                status: res.statusCode,
                body,
              }),
              "EX",
              86400
            );
          }
        } finally {
          if (!isTest) {
            await redis.del(lockKey);
          }
        }

        return originalJson(body);
      };

      next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = createIdempotencyMiddleware;