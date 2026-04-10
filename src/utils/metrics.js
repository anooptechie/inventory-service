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

// 🔥 NEW METRICS

const ordersCreated = new client.Counter({
  name: "orders_created_total",
  help: "Total number of orders created",
});

const ordersConfirmed = new client.Counter({
  name: "orders_confirmed_total",
  help: "Total number of orders confirmed",
});

const idempotencyCacheHits = new client.Counter({
  name: "idempotency_cache_hits_total",
  help: "Number of times idempotency cache was hit",
});

const idempotencyDbFallback = new client.Counter({
  name: "idempotency_db_fallback_total",
  help: "Number of times DB fallback was used for idempotency",
});

const stockInsufficient = new client.Counter({
  name: "stock_insufficient_total",
  help: "Number of insufficient stock errors",
});

const outboxEventsCreated = new client.Counter({
  name: "outbox_events_created_total",
  help: "Number of outbox events created",
});

// register metrics
register.registerMetric(httpRequestsTotal);
register.registerMetric(httpRequestDuration);
register.registerMetric(ordersCreated);
register.registerMetric(ordersConfirmed);
register.registerMetric(idempotencyCacheHits);
register.registerMetric(idempotencyDbFallback);
register.registerMetric(stockInsufficient);
register.registerMetric(outboxEventsCreated);

module.exports = {
  register,
  httpRequestsTotal,
  httpRequestDuration,
  ordersCreated,
  ordersConfirmed,
  idempotencyCacheHits,
  idempotencyDbFallback,
  stockInsufficient,
  outboxEventsCreated,
};