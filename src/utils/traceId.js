const { v4: uuidv4 } = require("uuid");
const logger = require("./logger");

const traceIdMiddleware = (req, res, next) => {
  const traceId = uuidv4();

  req.traceId = traceId;

  // 🔥 attach request-scoped logger
  req.log = logger.child({ traceId });

  res.setHeader("X-Trace-Id", traceId);

  next();
};


module.exports = traceIdMiddleware;