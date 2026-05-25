# Inventory Management System

![CI/CD](https://github.com/anooptechie/inventory-service/actions/workflows/ci.yml/badge.svg)

A production-grade backend service for managing products, stock, and orders in an e-commerce system. Integrates with the [Auth Service](https://github.com/anooptechie/authnz) for stateless JWT authentication and RBAC.

**Live:** `http://52.7.155.214/inv/health`

---

## What makes this non-trivial

This isn't a CRUD tutorial. It solves real distributed systems problems:

- **Concurrency control** — `SELECT FOR UPDATE` prevents overselling under concurrent load. 10 concurrent requests on stock of 10 → exactly 5 succeed, 5 get 409. Stock never goes negative.
- **Idempotency** — Redis cache + DB fallback on every state-changing endpoint. Same `X-Idempotency-Key` returns the same response forever. Safe retries with zero duplicate orders or stock deductions.
- **Outbox Pattern** — low stock events written inside the same DB transaction as the stock update. Eliminates the dual-write problem. No silent event loss even on process crash.
- **Price snapshot** — `unit_price` copied from product at order creation. Future price changes never corrupt historical orders.
- **Cross-service token revocation** — logout from Auth Service immediately blocklists the token in Redis. Inventory Service checks this blocklist on every request — revocation is instant.

---

## Table of Contents

- [Live Deployment](#live-deployment)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [How to Run](#how-to-run)
- [API Reference](#api-reference)
- [Deployment](#deployment)
- [Key Design Decisions](#key-design-decisions)
- [Order Lifecycle](#order-lifecycle)
- [Testing](#testing)
- [CI/CD Pipeline](#cicd-pipeline)
- [Trade-offs & Future Work](#trade-offs--future-work)

---

## Live Deployment

| | |
|---|---|
| **Health check** | `http://52.7.155.214/inv/health` |
| **Base URL** | `http://52.7.155.214/inv` |
| **Auth Service** | `http://52.7.155.214` |
| **Region** | ap-south-1 (Mumbai) |
| **Instance** | t3.small — 2 vCPU, 2GB RAM, 20GB gp3 |
| **OS** | Ubuntu 22.04 LTS |

See [docs/IMS_E2E_Postman_Collection.json](docs/IMS_E2E_Postman_Collection.json) to import the full E2E collection and test against the live server.

---

## Architecture

```
Client
  │
  │  POST /auth/login  ──►  Auth Service :4000  ──►  Issues JWT
  │
  │  Any request       ──►  Inventory Service :5000
  │                              │
  │                    authenticate middleware  →  verify JWT locally (no Auth Service call)
  │                    authorize middleware     →  check role
  │                              │
  │              ┌───────────────┼───────────────┐
  │              │               │               │
  │         Products          Stock           Orders
  │                               │
  │                    outbox_events table
  │                               │
  │                    BullMQ outbox worker
  │                               │
  │                    Notification Service  ──►  Email + Webhook
```

**Key principles:**
- Inventory Service never calls Auth Service at runtime — JWT verification is local via shared `JWT_SECRET`
- Low stock events written inside the same DB transaction as the stock update — guaranteed delivery
- All state-changing endpoints are idempotent — safe to retry from any client

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Runtime | Node.js | Non-blocking I/O |
| Framework | Express.js | Minimal, unopinionated |
| Primary DB | PostgreSQL (pg) | ACID transactions, row-level locking |
| Cache / Idempotency | Redis (ioredis) | O(1) lookups, native TTL, blocklist checks |
| Job Queue | BullMQ | Outbox worker, retry logic, DLQ |
| Auth | JWT middleware from Auth Service | Shared JWT_SECRET — no runtime dependency |
| Logging | Pino | Structured JSON, traceId propagation |
| Metrics | prom-client | Prometheus-compatible business metrics |
| Testing | Jest + Supertest | Integration tests, mocked dependencies |
| CI/CD | GitHub Actions | Automated test + deploy pipeline |

---

## Project Structure

```
inventory-service/
├── src/
│   ├── api/
│   │   ├── routes/
│   │   │   ├── category.routes.js       # /categories
│   │   │   ├── product.routes.js        # /products
│   │   │   ├── stock.routes.js          # /stock
│   │   │   └── order.routes.js          # /orders
│   │   └── middlewares/
│   │       ├── authenticate.js          # JWT verify + claims validation + blocklist
│   │       ├── authorize.js             # Role check — authorize("admin","manager")
│   │       └── idempotency.js           # X-Idempotency-Key — Redis + DB fallback
│   ├── services/
│   │   ├── productService.js
│   │   ├── stockService.js              # SELECT FOR UPDATE
│   │   ├── orderService.js              # Order lifecycle
│   │   └── outboxService.js             # Writes events inside transactions
│   ├── workers/
│   │   └── outboxWorker.js              # BullMQ worker — polls and delivers events
│   ├── models/                          # DB query layer
│   ├── db/
│   │   ├── postgres.js
│   │   ├── redis.js
│   │   ├── migrate.js
│   │   └── migrations/                  # 8 ordered SQL files
│   └── app.js
├── src/__tests__/                       # 9 test suites
├── docs/
│   └── IMS_E2E_Postman_Collection.json  # Full E2E collection — live server URLs
├── server.js
└── .env.example
```

---

## How to Run

**1. Start infrastructure**
```bash
docker compose up -d
```

**2. Run migrations**
```bash
node src/db/migrate.js
```

**3. Start the server**
```bash
node server.js
```

**4. Start the outbox worker** (separate terminal)
```bash
node src/workers/outboxWorker.js
```

Server runs on `http://localhost:5000`

---

## API Reference

### Categories

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/categories` | Any authenticated | List all active categories. Paginated. |
| POST | `/categories` | Admin only | Create category. |
| PATCH | `/categories/:id` | Admin only | Update name or description. |
| DELETE | `/categories/:id` | Admin only | Soft-delete. Fails if active products exist. |

### Products

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/products` | Any authenticated | List active products. Supports `?category=&search=&page=`. |
| GET | `/products/:id` | Any authenticated | Single product with current stock quantity. |
| POST | `/products` | Admin, Manager | Create product. Auto-creates stock row at 0. |
| PATCH | `/products/:id` | Admin, Manager | Update product details. |

### Stock

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/stock/:productId` | Any authenticated | Current stock level and threshold. |
| PATCH | `/stock/:productId` | Admin, Manager | Adjust stock. Requires `X-Idempotency-Key`. Uses `SELECT FOR UPDATE`. |

### Orders

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/orders` | Any authenticated | Create order. Requires `X-Idempotency-Key`. Status: PENDING. |
| GET | `/orders/:id` | Owner or Admin/Manager | Order details with line items. |
| GET | `/orders` | Admin, Manager | All orders. Supports `?status=&page=`. |
| POST | `/orders/:id/confirm` | Admin, Manager | Confirm order. Deducts stock atomically. |
| POST | `/orders/:id/cancel` | Owner or Admin/Manager | Cancel order. |
| POST | `/orders/:id/fulfil` | Admin, Manager | Mark fulfilled. Terminal state. |

### Observability

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Dependency-aware. Returns 503 on degraded state. |
| GET | `/metrics` | Prometheus metrics. |

---

## Deployment

Both services run on the same AWS EC2 instance. Nginx routes by path prefix:

```
http://52.7.155.214/        → Auth Service (port 4000)
http://52.7.155.214/inv/    → Inventory Service (port 5000)
```

**Deploy flow:**
```
git push origin main
        ↓
GitHub Actions runs tests
        ↓
Tests pass → SSH into EC2 → git pull → npm ci → pm2 restart
        ↓
Live at http://52.7.155.214/inv
```

---

## Key Design Decisions

### Concurrency Control

`SELECT FOR UPDATE` serialises concurrent stock updates at the DB level. The first request acquires the row lock — all others wait. No race conditions, no overselling.

```
Initial stock: 10
10 concurrent requests × -2 each

Result: 5 succeed, 5 get 409 INSUFFICIENT_STOCK
Final stock: 0 — never negative
```

### Idempotency — Redis + DB Fallback

```
POST /orders + X-Idempotency-Key: "abc"

1. Redis hit → return cached response immediately
2. Redis miss → check orders table WHERE idempotency_key = "abc"
3. DB miss → execute business logic, cache result
```

Error responses (4xx) are never cached — clients can retry after fixing the request.

### Outbox Pattern

```
BEGIN TRANSACTION
  UPDATE stock
  INSERT INTO stock_movements
  INSERT INTO outbox_events     ← same transaction
COMMIT

BullMQ worker polls outbox_events WHERE status = PENDING
  → POST to Notification Service
  → On success: DELIVERED
  → On failure: retry with backoff → FAILED after max attempts
```

If the stock update committed, the event will be delivered. Crash window eliminated.

### Middleware Order

```
Idempotency → Authenticate → Authorize → Handler
```

Idempotency runs first — a cache hit returns immediately before auth runs. Correct and intentional.

---

## Order Lifecycle

```
POST /orders              →  PENDING    (stock validated, not deducted)
POST /orders/:id/confirm  →  CONFIRMED  (stock deducted atomically)
POST /orders/:id/cancel   →  CANCELLED  (from PENDING or CONFIRMED)
POST /orders/:id/fulfil   →  FULFILLED  (terminal state)
```

| From | To | Allowed |
|---|---|---|
| PENDING | CONFIRMED | ✅ |
| PENDING | CANCELLED | ✅ |
| CONFIRMED | FULFILLED | ✅ |
| CONFIRMED | CANCELLED | ✅ |
| FULFILLED | any | ❌ Terminal |
| CANCELLED | any | ❌ Terminal |

---

## Testing

9 test suites using Jest + Supertest. All external dependencies mocked — no real DB or Redis required.

```bash
npm test
```

| Suite | Coverage |
|---|---|
| `products.test.js` | CRUD, soft delete, pagination, SKU uniqueness |
| `stock.test.js` | Adjustments, movements, threshold logic |
| `stock.concurrency.test.js` | 10 concurrent requests — proves no overselling |
| `stock.idempotency.test.js` | Cache hit, no side effects on retry |
| `orders.test.js` | Full order lifecycle |
| `orders.idempotency.test.js` | Same key = same orderId, one DB row |
| `confirmOrder.test.js` | Transaction safety, stock deduction |
| `confirmOrder.outbox.test.js` | Outbox event written inside transaction |
| `order.status.test.js` | Status transition validation |

---

## CI/CD Pipeline

```
Push to main
      ↓
GitHub Actions runs test suite
      ↓
Tests pass → SSH into EC2 → git pull → npm ci → pm2 restart
      ↓
Live at http://52.7.155.214/inv
```

---

## Trade-offs & Future Work

| Decision | Reason | Upgrade Path |
|---|---|---|
| Pessimistic locking (SELECT FOR UPDATE) | Correct for expected stock contention | Optimistic concurrency with version column, or Redis pre-decrement |
| Validate-at-create, deduct-at-confirm | Simpler than full reservation. Gap documented and handled. | Add `reserved_quantity` column |
| HS256 JWT (shared secret) | Correct for internal ecosystem | RS256 with JWKS endpoint |
| Limit+offset pagination | Simpler and explainable | Cursor-based for large datasets |
| Single warehouse | Clean schema, all design problems demonstrable | Add `locations` table, `stock_per_location` |
| Stock reservation gap | Order A confirmed before Order B — B gets 409 on confirm | `reserved_quantity` holds stock at creation |