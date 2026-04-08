const redis = require("../../db/redis");

const createIdempotencyMiddleware = (prefix) => {
  return async (req, res, next) => {
    const key = req.headers["x-idempotency-key"];

    if (!key) {
      return res.status(400).json({
        error: "IDEMPOTENCY_KEY_REQUIRED",
      });
    }

    const redisKey = `idempotency:${prefix}:${key}`;

    const cached = await redis.get(redisKey);

    if (cached) {
      const parsed = JSON.parse(cached);
      return res.status(parsed.status).json(parsed.body);
    }

    // intercept response
    const originalJson = res.json.bind(res);

    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        redis.set(
          redisKey,
          JSON.stringify({
            status: res.statusCode,
            body,
          }),
          "EX",
          86400
        );
      }

      return originalJson(body);
    };

    next();
  };
};

module.exports = createIdempotencyMiddleware;