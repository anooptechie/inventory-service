const redis = require("../../db/redis");
const { idempotencyCacheHits } = require("../../utils/metrics");

const createIdempotencyMiddleware = (prefix, options = { required: true }) => {
  return async (req, res, next) => {
    try {
      const key = req.headers["x-idempotency-key"];

      if (!key) {
        if (options.required) {
          return res.status(400).json({
            error: "IDEMPOTENCY_KEY_REQUIRED",
            message: "X-Idempotency-Key header is required",
          });
        }
        return next();
      }

      const redisKey = `idempotency:${prefix}:${key}`;
      const lockKey = `${redisKey}:lock`;
      const isTest = process.env.NODE_ENV === "test";

      const cached = await redis.get(redisKey);
      if (cached) {
        idempotencyCacheHits.inc();
        const parsed = JSON.parse(cached);
        return res.status(parsed.status).json(parsed.body);
      }

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

      const originalJson = res.json.bind(res);
      res.json = async (body) => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            await redis.set(
              redisKey,
              JSON.stringify({ status: res.statusCode, body }),
              "EX",
              86400,
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
