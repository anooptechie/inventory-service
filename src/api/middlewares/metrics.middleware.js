const {
  httpRequestsTotal,
  httpRequestDuration,
} = require("../../utils/metrics");

const metricsMiddleware = (req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = (Date.now() - start) / 1000;

    const labels = {
      method: req.method,
      route: req.route?.path || req.baseUrl || req.originalUrl,
      status: res.statusCode,
    };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, duration);
  });

  next();
};

module.exports = metricsMiddleware;