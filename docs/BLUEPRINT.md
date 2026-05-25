# Inventory Management System

A production-style backend service for managing products, stock, and orders in an e-commerce system.

Built to solve real-world backend engineering problems — not a CRUD tutorial.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [How to Run](#how-to-run)
- [API Reference](#api-reference)
- [Milestones](#milestones)
- [Concurrency Control](#concurrency-control)
- [Idempotency](#idempotency)
- [Outbox Pattern](#outbox-pattern)
- [Order Lifecycle](#order-lifecycle)
- [Authentication & Authorisation](#authentication--authorisation)
- [Observability](#observability)
- [Testing](#testing)
- [CI Pipeline](#ci-pipeline)
- [Advanced System Guarantees](#advanced-system-guarantees)
- [Future Enhancements](#future-enhancements)
- [Trade-offs](#trade-offs)

---

## Project Overview

Most inventory systems stop at basic product and stock management. This service goes further:

| Capability                                | Why It Matters                                                      |
| ----------------------------------------- | ------------------------------------------------------------------- |
| Concurrency control via row-level locking | Prevents overselling under concurrent load                          |
| Idempotency with Redis + DB fallback      | Safe retries — no duplicate orders or stock deductions              |
| Outbox Pattern for event delivery         | Eliminates the dual-write problem — no silent event loss            |
| Price snapshot on order items             | Historical order accuracy — price changes never corrupt past orders |
| Atomic transactions throughout            | No partial writes — all or nothing on every critical operation      |
| RBAC via Auth Service middleware          | Stateless authorisation — no runtime coupling to Auth Service       |
| Structured logging with traceId           | Every request traceable across the entire ecosystem                 |
| Prometheus metrics                        | Business-level visibility — not just infrastructure health          |

---

## Architecture

```
Client
  │
  │  POST /auth/login  ──►  Auth Service  ──►  Issues JWT
  │
  │  Any request       ──►  Inventory Service :5000
  │                              │
  │                    authenticate middleware  →  verify JWT locally
  │                    authorize middleware     →  check role
  │                              │
  │              ┌───────────────┼───────────────┐
  │              │               │               │
  │         Products          Stock           Orders
  │              │               │               │
  │              └───────────────┼───────────────┘
  │                              │
  │                    outbox_events table
  │                              │
  │                    BullMQ outbox worker
  │                              │
  │                    Notification Service  ──►  Email + Webhook
```

**Key principles:**

- Inventory Service never calls Auth Service at runtime — JWT verification is local via shared secret
- Low stock events are written inside the same DB transaction as the stock update — guaranteed delivery via Outbox Pattern
- All state-changing endpoints are idempotent — safe to retry from any client

---

## Tech Stack

| Layer               | Technology                       | Reason                                                  |
| ------------------- | -------------------------------- | ------------------------------------------------------- |
| Runtime             | Node.js                          | Non-blocking I/O, consistent with portfolio ecosystem   |
| Framework           | Express.js                       | Minimal, unopinionated, explicit middleware chains      |
| Primary DB          | PostgreSQL (pg)                  | ACID transactions, row-level locking, CHECK constraints |
| Cache / Idempotency | Redis (ioredis)                  | O(1) idempotency lookups, native TTL, blocklist checks  |
| Job Queue           | BullMQ                           | Outbox worker, retry logic, DLQ                         |
| Auth                | JWT middleware from Auth Service | Shared JWT_SECRET — no runtime Auth Service dependency  |
| Logging             | Pino                             | Structured JSON, traceId propagation                    |
| Metrics             | prom-client                      | Prometheus-compatible, business-level metrics           |
| Testing             | Jest + Supertest                 | Integration tests with mocked dependencies              |
| CI                  | GitHub Actions                   | Automated runs on every push and PR                     |

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
│   │       ├── authenticate.js          # JWT verify + claims validation + blocklist check
│   │       ├── authorize.js             # Role check factory — authorize("admin","manager")
│   │       └── idempotency.js           # X-Idempotency-Key — Redis cache + DB fallback
│   ├── services/
│   │   ├── productService.js            # Product business logic
│   │   ├── stockService.js              # Stock updates with SELECT FOR UPDATE
│   │   ├── orderService.js              # Order lifecycle management
│   │   └── outboxService.js             # Writes events inside existing transactions
│   ├── workers/
│   │   └── outboxWorker.js              # BullMQ worker — polls and delivers outbox events
│   ├── models/
│   │   ├── category.model.js            # categories table queries
│   │   ├── product.model.js             # products table queries
│   │   ├── stock.model.js               # stock table queries
│   │   ├── order.model.js               # orders table queries
│   │   ├── orderItem.model.js           # order_items table queries
│   │   ├── stockMovement.model.js       # stock_movements append-only table
│   │   └── outboxEvent.model.js         # outbox_events table queries
│   ├── db/
│   │   ├── postgres.js                  # pg Pool connection
│   │   ├── redis.js                     # ioredis client
│   │   ├── migrate.js                   # runs migrations in order
│   │   └── migrations/
│   │       ├── 001_create_categories.sql
│   │       ├── 002_create_products.sql
│   │       ├── 003_create_stock.sql
│   │       ├── 004_create_orders.sql
│   │       ├── 005_create_order_items.sql
│   │       ├── 006_create_stock_movements.sql
│   │       ├── 007_create_outbox_events.sql
│   │       └── 008_create_indexes.sql
│   ├── config/
│   │   └── env.js                       # validates all env vars on startup
│   ├── utils/
│   │   ├── logger.js                    # Pino logger instance
│   │   ├── traceId.js                   # assigns traceId UUID to every request
│   │   └── paginate.js                  # consistent pagination envelope builder
│   └── app.js                           # Express app setup
├── src/__tests__/
│   ├── setup.js                         # global mocks — pg, Redis, axios
│   ├── products.test.js                 # product + category CRUD, soft delete, pagination
│   ├── stock.test.js                    # adjustments, movements, threshold logic
│   ├── stock.concurrency.test.js        # concurrent updates — the most critical test
│   ├── stock.idempotency.test.js        # cache hit, no side effects on retry
│   ├── orders.test.js                   # create, cancel, confirm, fulfil, status transitions
│   ├── orders.idempotency.test.js       # same key = same orderId, one DB row
│   ├── confirmOrder.test.js             # transaction safety, stock deduction
│   ├── confirmOrder.outbox.test.js      # outbox event written inside transaction
│   └── order.status.test.js             # status transition validation
├── server.js                            # entry point
├── .env.example
└── package.json
```

---

## Environment Variables

Copy `.env.example` to `.env` before running.

```env
PORT=5000
NODE_ENV=development

# PostgreSQL (Supabase)
POSTGRES_HOST=db.xxxx.supabase.co
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-password
POSTGRES_DB=postgres

# Redis (Upstash)
REDIS_URL=redis://default:password@endpoint.upstash.io:6379

# JWT — must match Auth Service
JWT_SECRET=same-value-as-auth-service

# Notification Service
NOTIFICATION_SERVICE_URL=http://localhost:4000

# Outbox Worker
OUTBOX_POLL_INTERVAL_MS=5000
OUTBOX_MAX_ATTEMPTS=5
```

---

## How to Run

**1. Install dependencies**

```bash
npm install
```

**2. Run database migrations**

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

**Health check:**

```bash
curl http://localhost:5000/health
```

---

## API Reference

### Category Endpoints

| Method | Path              | Auth              | Description                                  |
| ------ | ----------------- | ----------------- | -------------------------------------------- |
| GET    | `/categories`     | Any authenticated | List all active categories. Paginated.       |
| POST   | `/categories`     | admin only        | Create category. Name must be unique.        |
| PATCH  | `/categories/:id` | admin only        | Update name or description.                  |
| DELETE | `/categories/:id` | admin only        | Soft-delete. Fails if active products exist. |

### Product Endpoints

| Method | Path            | Auth              | Description                                                                  |
| ------ | --------------- | ----------------- | ---------------------------------------------------------------------------- |
| GET    | `/products`     | Any authenticated | List active products. Supports `?category=&search=&page=&limit=`. Paginated. |
| GET    | `/products/:id` | Any authenticated | Single product with current stock quantity.                                  |
| POST   | `/products`     | admin, manager    | Create product. Auto-creates stock row at quantity 0.                        |
| PATCH  | `/products/:id` | admin, manager    | Update product details.                                                      |

### Stock Endpoints

| Method | Path                | Auth              | Description                                                           |
| ------ | ------------------- | ----------------- | --------------------------------------------------------------------- |
| GET    | `/stock/:productId` | Any authenticated | Current stock level and threshold.                                    |
| PATCH  | `/stock/:productId` | admin, manager    | Adjust stock. Requires `X-Idempotency-Key`. Uses `SELECT FOR UPDATE`. |

### Order Endpoints

| Method | Path                  | Auth                    | Description                                                                   |
| ------ | --------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| POST   | `/orders`             | Any authenticated       | Create order. Validates stock. Requires `X-Idempotency-Key`. Status: PENDING. |
| GET    | `/orders/:id`         | Owner or admin, manager | Order details with line items.                                                |
| GET    | `/orders`             | admin, manager          | All orders. Supports `?status=&page=`. Paginated.                             |
| POST   | `/orders/:id/confirm` | admin, manager          | Confirm order. Deducts stock atomically. Triggers low stock check.            |
| POST   | `/orders/:id/cancel`  | Owner or admin, manager | Cancel order. Status validation enforced.                                     |
| POST   | `/orders/:id/fulfil`  | admin, manager          | Mark order fulfilled. Terminal state.                                         |

### Observability Endpoints

| Method | Path       | Description                                        |
| ------ | ---------- | -------------------------------------------------- |
| GET    | `/health`  | Dependency-aware health check. Returns 200 or 503. |
| GET    | `/metrics` | Prometheus metrics.                                |

---

## Milestones

### Milestone 1 — Infrastructure ✅

- PostgreSQL connection via pg Pool
- Redis connection via ioredis
- Migration system — runs 8 `.sql` files in order
- Environment configuration with startup validation
- Health check with active Postgres + Redis dependency verification
- Returns 503 on degraded state — load balancer compatible

### Milestone 2 — Categories + Products ✅

- Full CRUD for categories and products
- Soft delete on both — `is_active` flag, not hard delete
- SKU uniqueness enforced at DB level
- Product creation auto-creates a stock row at quantity 0 — atomic transaction
- Pagination envelope on all list endpoints: `{ data, meta: { page, limit, total, hasNext } }`
- Search and category filtering on GET /products
- GET /products/:id includes current stock quantity

### Milestone 3 — Stock Management + Concurrency ✅

- `PATCH /stock/:productId` uses `SELECT FOR UPDATE` inside a PostgreSQL transaction
- Concurrent requests are serialised at the database level — no race conditions
- Stock never goes negative — enforced in application and by DB `CHECK (quantity >= 0)`
- Every successful adjustment writes a `stock_movements` record in the same transaction
- 409 `INSUFFICIENT_STOCK` with `available` and `requested` fields on failure
- `client.release()` in `finally` block — pool exhaustion prevention

### Milestone 4 — Idempotency ✅

- `X-Idempotency-Key` header required on `PATCH /stock` and `POST /orders`
- Redis cache — scoped key: `idempotency:<resource>:<key>` — 24-hour TTL
- DB fallback — `idempotency_key` column on orders table — durable when Redis cache expires
- Error responses (4xx/5xx) are not cached — clients can retry after fixing their request
- 400 `IDEMPOTENCY_KEY_REQUIRED` when header is missing

### Milestone 5 — Outbox Pattern ✅

- Low stock events written to `outbox_events` table inside the same DB transaction as the stock update
- Eliminates the dual-write problem — stock update and event are atomic
- BullMQ outbox worker polls `PENDING` events every 5 seconds
- Delivers to Notification Service via HTTP POST
- Failed deliveries: attempts incremented, retried with exponential backoff
- After max attempts: status set to `FAILED` for manual inspection
- Threshold crossing logic — events fire only when stock crosses below threshold, not repeatedly

### Milestone 6 — Orders: Create + Cancel ✅

- `POST /orders` validates stock availability using `SELECT FOR UPDATE`
- Price snapshot — `unit_price` copied from product at order creation time
- Historical accuracy — future price changes do not affect past orders
- Idempotency enforced — same key returns same orderId, no duplicate DB rows
- `POST /orders/:id/cancel` validates status transitions
- Status must be `PENDING` or `CONFIRMED` to cancel — `FULFILLED` orders cannot be cancelled

### Milestone 7 — Orders: Confirm + Fulfil ✅

- `POST /orders/:id/confirm` deducts stock atomically inside a transaction
- Locks stock rows with `SELECT FOR UPDATE` — safe under concurrency
- Writes `stock_movements` records with `reason=sale` and `reference_id=orderId`
- Writes outbox event inside the same transaction if stock drops below threshold
- `POST /orders/:id/fulfil` marks terminal state — no further transitions allowed
- Full audit logging on every status transition

### Milestone 8 — Auth Integration ✅

- `authenticate.js` and `authorize.js` middleware from Auth Service
- JWT verified locally using shared `JWT_SECRET` — no runtime Auth Service call
- Claims validation: `userId` UUID format, `role` whitelist, `isActive` check
- Redis blocklist check via `jti` — revoked tokens rejected immediately
- RBAC applied at routing layer — not inside controllers
- Middleware order: `Idempotency → Authenticate → Authorize → Handler`

### Milestone 9 — Observability ✅

- Structured JSON logging via Pino
- `traceId` UUID assigned per request — propagated to all log lines and response headers
- `X-Trace-Id` header on every response — enables cross-service request tracing
- Prometheus metrics on `/metrics` — both system-level and business-level
- Health check actively verifies Postgres and Redis — returns 503 on degraded state

### Milestone 10 — Tests + CI ✅

- 9 test files using Jest + Supertest
- Integration-style tests — test HTTP behaviour, not internal functions
- All external dependencies mocked — no real DB or Redis required in CI
- `stock.concurrency.test.js` proves row-level locking prevents overselling
- `orders.idempotency.test.js` proves same key produces one order, not duplicates
- GitHub Actions CI runs on every push and pull request

---

## Concurrency Control

The core system design challenge: two customers buy the last unit simultaneously. Without protection, both succeed and stock goes negative.

### Approach

```
PATCH /stock/:productId  { adjustment: -2, reason: "sale" }

  BEGIN TRANSACTION
    SELECT quantity, low_stock_threshold
    FROM stock
    WHERE product_id = $1
    FOR UPDATE                    ← row-level lock acquired
                                  ← all concurrent requests block here

    if quantity + adjustment < 0:
      ROLLBACK
      return 409 INSUFFICIENT_STOCK

    UPDATE stock SET quantity = quantity + adjustment

    INSERT INTO stock_movements (before, after, reason, ...)

    if new_quantity <= threshold:
      INSERT INTO outbox_events   ← same transaction

  COMMIT
```

### Proof — Concurrency Test

```
Initial stock: 10
10 concurrent requests × -2 each (total requested: 20)

Result:
  5 requests succeed  →  stock deducted from 10 to 0
  5 requests fail     →  409 INSUFFICIENT_STOCK
  Final stock: 0      →  never negative
```

### Why SELECT FOR UPDATE

Pessimistic locking — correct for inventory where stock contention is expected. The first request acquires the lock. All others wait. This serialises updates without race conditions.

**Known trade-off:** Under extreme concurrency (flash sales), many requests queue behind the DB lock. Upgrade path: optimistic concurrency with a `version` column, or Redis pre-decrement strategy to reduce DB lock contention.

---

## Idempotency

Network failures cause clients to retry. Without idempotency, a retry creates a duplicate order or deducts stock twice.

### Approach

```
POST /orders
X-Idempotency-Key: "client-uuid-abc"

1. Check Redis: GET idempotency:orders:client-uuid-abc
   → if found: return cached response immediately

2. Check orders table: SELECT WHERE idempotency_key = "client-uuid-abc"
   → if found: return existing order (durable DB fallback)

3. Execute business logic

4. Cache response in Redis (24h TTL)
   Store idempotency_key on orders row (permanent)

5. Return response
```

### Behaviour

| Scenario                 | Result                                     |
| ------------------------ | ------------------------------------------ |
| First request            | Business logic executes. Response cached.  |
| Same key — retry         | Cached response returned. No side effects. |
| Same key — Redis expired | DB fallback returns existing order.        |
| Missing key              | 400 `IDEMPOTENCY_KEY_REQUIRED`             |
| Failed request (4xx)     | Not cached — retry executes again          |

---

## Outbox Pattern

### The Problem

```
Stock updated in DB  ✅
Service crashes      💥
Event never sent     ❌  ←  silent inconsistency
```

This is the dual-write problem. Direct HTTP after commit has a crash window.

### The Solution

```
BEGIN TRANSACTION
  UPDATE stock                    ← business operation
  INSERT INTO stock_movements     ← audit record
  INSERT INTO outbox_events       ← event record
COMMIT                            ← all three or none

BullMQ worker polls outbox_events WHERE status = PENDING
  → POST /events to Notification Service
  → On success: UPDATE status = DELIVERED
  → On failure: increment attempts, retry with backoff
  → After max attempts: status = FAILED (DLQ for inspection)
```

**Guarantee:** If the stock update committed, the event will be delivered. The crash window is eliminated.

### Event Schema

```json
{
  "type": "inventory.low_stock",
  "channels": ["email", "webhook"],
  "payload": {
    "productId": "uuid",
    "productName": "Widget A",
    "sku": "WGT-001",
    "quantity": 4,
    "threshold": 5
  }
}
```

---

## Order Lifecycle

```
POST /orders              →  PENDING
                             Stock validated (not deducted)
                             Price snapshot taken
                             Idempotency key stored

POST /orders/:id/confirm  →  CONFIRMED
                             Stock deducted atomically
                             stock_movements written
                             Outbox event written if low stock
                             Audit: ORDER_CONFIRMED

POST /orders/:id/cancel   →  CANCELLED
                             Allowed from PENDING or CONFIRMED
                             Audit: ORDER_CANCELLED

POST /orders/:id/fulfil   →  FULFILLED
                             Allowed from CONFIRMED only
                             Terminal state — no further transitions
                             Audit: ORDER_FULFILLED
```

### Status Transition Rules

| From      | To        | Allowed     |
| --------- | --------- | ----------- |
| PENDING   | CONFIRMED | ✅          |
| PENDING   | CANCELLED | ✅          |
| CONFIRMED | FULFILLED | ✅          |
| CONFIRMED | CANCELLED | ✅          |
| FULFILLED | any       | ❌ Terminal |
| CANCELLED | any       | ❌ Terminal |

### Known Limitation — Reservation Gap

Stock is validated at order creation but only deducted at confirmation. This creates a window:

```
Order A created  →  stock available (10 units)
Order B confirmed →  consumes 10 units
Order A confirm   →  fails (0 units left)
```

The system handles this gracefully — Order A gets a clear 409 `INSUFFICIENT_STOCK` on confirm. No overselling occurs. The documented upgrade path is a `reserved_quantity` column that holds stock at creation time.

---

## Authentication & Authorisation

This service integrates with the standalone Auth Service and enforces RBAC at the routing layer.

### Design

- Auth Service is **never called at runtime** — JWT verification is local
- Shared `JWT_SECRET` between Auth Service and Inventory Service
- Two middleware files — `authenticate.js` and `authorize.js` — ~30 lines total

### authenticate.js — What It Checks

```
1. Authorization: Bearer <token> header present
2. JWT signature valid (shared JWT_SECRET)
3. Token not expired  →  TOKEN_EXPIRED (401)
4. Claims validation:
   - userId is a valid UUID
   - role is one of: admin, manager, viewer
   - isActive === true
5. Redis blocklist check via jti
   →  TOKEN_REVOKED (401) if blocklisted
6. req.user = decoded payload
```

### Middleware Order

```
Idempotency → Authenticate → Authorize → Route Handler
```

Idempotency runs first — a cache hit returns the response before auth runs, which is correct and intentional.

### RBAC Matrix

| Action                         | admin | manager | viewer |
| ------------------------------ | ----- | ------- | ------ |
| View products / stock / orders | ✅    | ✅      | ✅     |
| Create / update products       | ✅    | ✅      | ❌     |
| Adjust stock                   | ✅    | ✅      | ❌     |
| Create orders                  | ✅    | ✅      | ✅     |
| Confirm / fulfil orders        | ✅    | ✅      | ❌     |
| Cancel own orders              | ✅    | ✅      | ✅     |
| Cancel any order               | ✅    | ✅      | ❌     |
| Manage categories              | ✅    | ❌      | ❌     |

### Token Revocation

Revoked tokens (from Auth Service logout) are blocklisted in Redis by JTI. Inventory Service checks this blocklist on every authenticated request — revocation is immediate.

---

## Observability

### Structured Logging (Pino)

Every log line includes:

| Field    | Description                                                                   |
| -------- | ----------------------------------------------------------------------------- |
| traceId  | Unique UUID per request. Same value across all log lines in one request.      |
| userId   | From JWT payload. Present on all authenticated requests.                      |
| action   | What happened — `STOCK_ADJUSTED`, `ORDER_CONFIRMED`, `OUTBOX_DELIVERED`, etc. |
| duration | Request duration in milliseconds.                                             |

### Prometheus Metrics

| Metric                          | Description                                          |
| ------------------------------- | ---------------------------------------------------- |
| `http_requests_total`           | Counter. Labels: method, route, status_code.         |
| `http_request_duration_seconds` | Histogram. Request latency per route.                |
| `orders_created_total`          | Orders successfully created.                         |
| `orders_confirmed_total`        | Orders successfully confirmed.                       |
| `stock_insufficient_total`      | Requests rejected due to insufficient stock.         |
| `idempotency_cache_hits_total`  | Requests served from Redis idempotency cache.        |
| `idempotency_db_fallback_total` | Requests served from DB fallback when cache expired. |
| `outbox_events_created_total`   | Low stock events written to outbox.                  |

### Health Check

```bash
GET /health
```

Actively verifies Postgres and Redis connectivity:

```json
{ "status": "ok", "postgres": "connected", "redis": "connected" }
```

Returns `503 Service Unavailable` if any dependency is down — load balancer compatible.

---

## Testing

Integration-style tests using Jest and Supertest. Tests validate system behaviour — not internal functions.

All external dependencies are mocked — no real Postgres, Redis, or Notification Service required.

```
src/__tests__/
├── setup.js                      # mocks: pg pool, Redis (in-memory Map), axios
├── products.test.js              # CRUD, soft delete, pagination, SKU uniqueness
├── stock.test.js                 # adjustments, movements, threshold logic
├── stock.concurrency.test.js     # concurrent updates — most important test
├── stock.idempotency.test.js     # cache hit, no side effects on retry
├── orders.test.js                # full order lifecycle
├── orders.idempotency.test.js    # same key = same orderId, one DB row
├── confirmOrder.test.js          # transaction safety, stock deduction
├── confirmOrder.outbox.test.js   # outbox event written inside transaction
└── order.status.test.js          # status transition rules
```

### The Concurrency Test — Most Important

```javascript
test("concurrent adjustments do not oversell", async () => {
  // Setup: product with quantity = 10
  // 10 concurrent requests, each deducting 2 (total requested: 20)

  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      request(app)
        .patch(`/stock/${productId}`)
        .set("X-Idempotency-Key", uuid())
        .send({ adjustment: -2, reason: "sale" }),
    ),
  );

  const successes = results.filter((r) => r.status === 200);
  const failures = results.filter((r) => r.status === 409);

  expect(successes).toHaveLength(5); // 5 × -2 = -10
  expect(failures).toHaveLength(5);
  expect(finalStock.quantity).toBe(0); // never negative
});
```

### Full Test Coverage

#### products.test.js

| Test Case                             | Expected                                    |
| ------------------------------------- | ------------------------------------------- |
| Create product — valid                | 201 + stock auto-created at quantity 0      |
| Create product — duplicate SKU        | 409 SKU_ALREADY_EXISTS                      |
| Create product — inactive category    | 404 CATEGORY_NOT_FOUND                      |
| Pagination envelope                   | meta.page, meta.total, meta.hasNext present |
| Soft-deleted product                  | Not returned in list endpoints              |
| GET /products/:id                     | Includes stock quantity                     |
| Delete category — has active products | 409 CATEGORY_HAS_ACTIVE_PRODUCTS            |

#### stock.test.js

| Test Case                 | Expected                                            |
| ------------------------- | --------------------------------------------------- |
| Valid positive adjustment | 200 + quantity increased                            |
| Valid negative adjustment | 200 + quantity decreased                            |
| Adjustment to exactly 0   | 200 + quantity = 0 (boundary)                       |
| Adjustment below 0        | 409 INSUFFICIENT_STOCK with available and requested |
| stock_movements written   | Correct before/after values                         |
| Unknown reason value      | 400                                                 |
| Zero adjustment           | 400                                                 |

#### stock.concurrency.test.js

| Test Case                            | Expected                                       |
| ------------------------------------ | ---------------------------------------------- |
| 10 concurrent -2 on stock of 10      | 5 succeed, 5 get 409. Final quantity = 0.      |
| Mixed concurrent adds and deductions | Final = initial + net. Never negative.         |
| Movement records match successes     | stock_movements count = successful adjustments |

#### orders.test.js

| Test Case                                | Expected                            |
| ---------------------------------------- | ----------------------------------- |
| Create valid order                       | 201 + PENDING + correct totalAmount |
| unit_price = product.price at order time | Price snapshot confirmed            |
| Insufficient stock                       | 409 INSUFFICIENT_STOCK              |
| Empty items array                        | 400                                 |
| Cancel PENDING order                     | 200 + CANCELLED                     |
| Cancel FULFILLED order                   | 409 INVALID_STATUS_TRANSITION       |
| Confirm PENDING order                    | 200 + CONFIRMED + stock deducted    |
| Confirm — stock insufficient             | 409 + no partial deductions         |
| Fulfil CONFIRMED order                   | 200 + FULFILLED                     |
| Fulfil PENDING order                     | 409 INVALID_STATUS_TRANSITION       |

#### orders.idempotency.test.js

| Test Case                      | Expected                                |
| ------------------------------ | --------------------------------------- |
| Same key — two POST /orders    | One order row. Same orderId both times. |
| Redis expired — same key in DB | DB fallback returns existing order.     |
| Missing idempotency key        | 400 IDEMPOTENCY_KEY_REQUIRED            |

#### confirmOrder.outbox.test.js

| Test Case                       | Expected                                  |
| ------------------------------- | ----------------------------------------- |
| Low stock after confirm         | outbox_events PENDING row written         |
| Outbox event inside transaction | writeEvent called with transaction client |
| Stock above threshold           | No outbox event written                   |

#### order.status.test.js

| Transition            | Expected                         |
| --------------------- | -------------------------------- |
| PENDING → CONFIRMED   | ✅ Allowed                       |
| PENDING → CANCELLED   | ✅ Allowed                       |
| CONFIRMED → FULFILLED | ✅ Allowed                       |
| CONFIRMED → CANCELLED | ✅ Allowed                       |
| FULFILLED → any       | ❌ 409 INVALID_STATUS_TRANSITION |
| CANCELLED → any       | ❌ 409 INVALID_STATUS_TRANSITION |

### Run Tests

```bash
npm test
```

**Outcome:** 9 test suites — full system lifecycle covered — CI-ready.

---

## CI Pipeline

GitHub Actions runs on every push to `main` and `develop`, and every pull request.

```
.github/workflows/ci.yml
```

**Steps:**

1. Checkout repository
2. Setup Node.js 20
3. Install dependencies (`npm ci`)
4. Run test suite (`npm test`)

**Test environment:**

- `NODE_ENV=test`
- PostgreSQL mocked via `jest.mock()`
- Redis mocked via in-memory `Map`
- Axios (Notification Service) mocked
- No external dependencies required

```
Developer Push → GitHub Actions → npm ci → npm test → Pass / Fail
```

---

## Advanced System Guarantees

### Idempotency — Redis + DB Fallback

Redis cache is fast but ephemeral. When the cache expires, the DB `idempotency_key` column is the durable fallback. A `UNIQUE` constraint on the column prevents duplicate orders even if both cache and fallback are bypassed simultaneously.

### Transaction Safety

All critical operations run inside PostgreSQL transactions. On any failure — application error, DB error, or unexpected crash — the transaction rolls back atomically. No partial writes reach the database.

### Outbox Reliability

The outbox worker retries failed deliveries with exponential backoff. After `OUTBOX_MAX_ATTEMPTS` (default: 5), the event is marked `FAILED` and available for manual inspection and replay. No event is silently dropped.

### Audit Trail

Every order status transition is recorded:

| Event             | Trigger                          |
| ----------------- | -------------------------------- |
| `ORDER_CREATED`   | POST /orders success             |
| `ORDER_CONFIRMED` | POST /orders/:id/confirm success |
| `ORDER_CANCELLED` | POST /orders/:id/cancel success  |
| `ORDER_FULFILLED` | POST /orders/:id/fulfil success  |

---

## Future Enhancements

The following are part of the system design blueprint but deliberately deferred to keep scope focused on core reliability guarantees:

**GET /stock/low** — list all products below their threshold.
Deferred: the system already triggers `low_stock` events automatically via the Outbox Pattern when stock drops below threshold. A manual polling endpoint is supplementary and lower priority.

**PATCH /stock/:productId/threshold** — update threshold per product at runtime.
Deferred: the default threshold is set at product creation time. Runtime threshold updates are a low-priority operational feature that adds endpoint surface without changing core system behaviour.

**DELETE /products/:id** — hard delete a product.
Deferred: products are soft-deleted via `is_active = false`. Hard delete introduces referential integrity complexity with existing orders and stock movements that reference the product. Soft delete is the safer production pattern.

**Stock reservation (reserved_quantity)** — hold stock at order creation, deduct at confirmation.
Deferred: the current validate-at-create model is simpler and sufficient for this scope. The reservation gap is documented and handled gracefully. Upgrade path: add `reserved_quantity` column to stock, increment on create, decrement on confirm or cancel.

**Product variants** — size, colour, SKU per variant.
Deferred: requires a `product_variants` table and stock-per-variant schema. Well-understood extension, wrong priority for current scope.

---

## Trade-offs

| Decision                                | Reason                                                                                  | Upgrade Path                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Pessimistic locking (SELECT FOR UPDATE) | Correct for expected stock contention. Simple to reason about.                          | Optimistic concurrency with version column, or Redis pre-decrement for flash-sale scale.  |
| Validate-at-create, deduct-at-confirm   | Simpler than full reservation. Gap is documented and handled.                           | Add reserved_quantity column. Background job releases stale reservations.                 |
| HS256 JWT (shared secret)               | Correct for internal ecosystem. Services are owned and operated together.               | RS256 with JWKS endpoint — only Auth Service holds private key.                           |
| PostgreSQL for outbox events            | Sufficient at this scale. Simple operational model.                                     | Stream to Kafka topic at high traffic scale. ELK or Grafana Loki for log aggregation.     |
| Limit+offset pagination                 | Simpler and more explainable than cursor-based.                                         | Cursor-based pagination for large datasets where offset performance degrades.             |
| Single warehouse                        | Keeps schema clean. All three design problems demonstrable without location complexity. | Add locations table. stock becomes stock_per_location. Transfer orders between locations. |
