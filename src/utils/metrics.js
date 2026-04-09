const client = require("prom-client");

// create registry
const register = new client.Registry();

// collect default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register });

// custom metrics

// total HTTP requests
const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
});

// request duration
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
});

// register metrics
register.registerMetric(httpRequestsTotal);
register.registerMetric(httpRequestDuration);

module.exports = {
  register,
  httpRequestsTotal,
  httpRequestDuration,
};