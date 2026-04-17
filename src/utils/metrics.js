const redis = require("../db/redis");
const client = require("prom-client");

const register = new client.Registry();

client.collectDefaultMetrics({ register });

// --- HTTP Metrics ---
const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
});

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
});

// --- Business Metrics ---
const ordersCreated = new client.Counter({
  name: "orders_created_total",
  help: "Total number of orders created",
});

const ordersConfirmed = new client.Counter({
  name: "orders_confirmed_total",
  help: "Total number of orders confirmed",
});

const ordersFulfilled = new client.Counter({
  name: "orders_fulfilled_total",
  help: "Total number of orders successfully fulfilled",
});

const ordersCancelled = new client.Counter({
  name: "orders_cancelled_total",
  help: "Total number of orders cancelled",
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

// Register all metrics
register.registerMetric(httpRequestsTotal);
register.registerMetric(httpRequestDuration);
register.registerMetric(ordersCreated);
register.registerMetric(ordersConfirmed);
register.registerMetric(ordersFulfilled);
register.registerMetric(ordersCancelled);
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
  ordersFulfilled,
  ordersCancelled,
  idempotencyCacheHits,
  idempotencyDbFallback,
  stockInsufficient,
  outboxEventsCreated,
};
