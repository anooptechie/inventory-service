# Inventory Management System (Backend)

A production-style backend service for managing products, stock, and orders in an e-commerce system.

This project focuses on solving real-world backend problems such as:

* Concurrency control (preventing overselling)
* Idempotency (safe retries)
* Reliable event delivery (Outbox Pattern)
* Strong data consistency with PostgreSQL transactions

---

## 🚀 Tech Stack

* Node.js + Express
* PostgreSQL (ACID transactions, row-level locking)
* Redis (idempotency + caching)
* Docker (local development)

---

## 📦 Current Status

**Phase 0 + Stock Concurrency (Milestone 3) Completed**

* Docker setup (Postgres + Redis)
* Database & Redis connections established
* Migration system implemented
* Health check endpoint (`/health`)

### ✅ Stock Management (Concurrency-Safe)

* Atomic stock updates using PostgreSQL transactions
* Row-level locking with `SELECT FOR UPDATE`
* Prevents overselling under concurrent requests
* Consistent audit trail via `stock_movements` table
* Validation layer for inputs (UUID, adjustment, reason)
* Standardized error responses

---

## 🧪 Running Locally

```bash
docker compose up -d
npm install
npm run dev
```

Health check:

```
GET http://localhost:5000/health
```

---

## 🧠 Project Focus

This is not a CRUD project.

The system is designed to handle:

* Concurrent stock updates safely
* Retry-safe operations using idempotency keys
* Guaranteed event delivery using the Outbox Pattern

---

## ⚙️ Stock Concurrency Design

The system ensures safe stock updates under concurrent requests using database-level guarantees.

### Approach

* Uses `SELECT FOR UPDATE` to acquire row-level locks
* All operations executed inside a single transaction
* Concurrent requests are serialized at the database level

### Guarantees

* No race conditions
* No lost updates
* Stock never goes negative
* All successful operations are recorded in `stock_movements`

### Example Scenario

Initial stock: `10`
10 concurrent requests each deducting `2`

Result:

* 5 requests succeed (total deduction = 10)
* 5 requests fail with `409 INSUFFICIENT_STOCK`
* Final stock = `0`

This ensures correctness even under high concurrency.

---

## 🔌 Sample API — Adjust Stock

**PATCH /stock/:productId**

```json
{
  "adjustment": -2,
  "reason": "sale"
}
```

### Success Response

```json
{
  "productId": "uuid",
  "quantity": 8,
  "threshold": 5
}
```

### Error Response

```json
{
  "error": "INSUFFICIENT_STOCK",
  "message": "Not enough stock",
  "available": 0,
  "requested": 2
}
```

---

## 🔁 Idempotency (Retry-Safe Operations)

The system ensures that repeated requests (due to retries, network failures, or duplicate submissions) do not cause unintended side effects.

### Approach

* Clients must send an `X-Idempotency-Key` header with each request
* Requests are cached in Redis using a scoped key (`idempotency:<resource>:<key>`)
* If the same key is received again:
  * The cached response is returned
  * The underlying business logic is NOT executed again

### Guarantees

* No duplicate stock deductions
* Safe retries for network failures
* Deterministic responses for repeated requests

### Behavior

| Scenario | Result |
|--------|--------|
| Same key + same request | Cached response returned |
| Different key | New execution |
| Missing key | `400 IDEMPOTENCY_KEY_REQUIRED` |
| Failed request (4xx/5xx) | Not cached (can be retried safely) |

### Example

#### Request

```http
PATCH /stock/:productId
X-Idempotency-Key: test-123
{
  "adjustment": -2,
  "reason": "sale"
}
First Call
{
  "productId": "uuid",
  "quantity": 8,
  "threshold": 5
}
Retry (same key)
{
  "productId": "uuid",
  "quantity": 8,
  "threshold": 5
}

👉 No additional stock deduction occurs.

---

## 📤 Outbox Pattern (Reliable Event Delivery)

The system ensures that events are reliably delivered even in the presence of failures, crashes, or network issues.

### Problem

Directly sending events after database updates can lead to inconsistencies:

* Stock updated in DB ✅  
* Event fails to send ❌  
* System becomes inconsistent

This is known as the **dual-write problem**.

---

### Approach

* Events are written to an `outbox_events` table **within the same database transaction**
* A background worker continuously polls pending events
* Events are delivered asynchronously and marked as `DELIVERED`

---

### Flow

1. Begin transaction  
2. Update stock  
3. Insert audit log (`stock_movements`)  
4. Insert event into `outbox_events`  
5. Commit transaction  

Worker:

1. Fetch `PENDING` events  
2. Deliver event (simulated / external service)  
3. Mark as `DELIVERED`  

---

### Guarantees

* No event loss after successful DB commit  
* Safe handling of service crashes  
* Events are retried until successfully delivered  
* Eliminates dual-write inconsistency  

---

### Example Scenario

Stock drops below threshold:

```text
Stock: 6 → 4 (threshold = 5)

Result:

Stock updated in DB
inventory.low_stock event inserted into outbox
Worker processes event asynchronously
Event marked as DELIVERED
Event Schema
{
  "type": "inventory.low_stock",
  "payload": {
    "productId": "uuid",
    "quantity": 4,
    "threshold": 5
  },
  "status": "PENDING"
}

---

## 🛒 Orders — Creation (PENDING State)

The system supports creating customer orders with strong guarantees around consistency, validation, and idempotency.

### Approach

* Orders are created with status `PENDING`
* Stock is **validated but NOT deducted** during creation
* Product prices are fetched and stored as a snapshot (`unit_price`)
* All operations are executed inside a single database transaction
* Idempotency is enforced using `X-Idempotency-Key`

---

### Flow

1. Idempotency middleware checks for duplicate request  
2. Begin transaction  
3. Lock stock rows using `SELECT FOR UPDATE`  
4. Validate stock availability for each item  
5. Fetch product prices  
6. Insert into `orders` table  
7. Insert into `order_items` table  
8. Commit transaction  

---

### Guarantees

* No partial orders (atomic transaction)  
* No duplicate orders (idempotency)  
* No overselling during validation  
* Price consistency via snapshot (historical accuracy)  

---

### Important Design Decision

Stock is **not deducted during order creation**.

```text
POST /orders → validate only
POST /orders/:id/confirm → deduct stock

This avoids premature stock reservation and keeps the system simpler for the current scope.

Example
Request
POST /orders
X-Idempotency-Key: order-123
{
  "items": [
    {
      "productId": "uuid",
      "quantity": 2
    }
  ]
}
Response
{
  "orderId": "uuid",
  "status": "PENDING",
  "totalAmount": 200,
  "items": [
    {
      "productId": "uuid",
      "quantity": 2,
      "unit_price": 100
    }
  ]
}
---

## ✅ Orders — Confirmation (CONFIRMED)

Order confirmation is the **core business operation** where stock is actually deducted and the system transitions an order from `PENDING` → `CONFIRMED`.

---

### Approach

* Executed inside a single database transaction
* Locks stock rows using `SELECT FOR UPDATE`
* Deducts stock safely under concurrency
* Records audit logs in `stock_movements`
* Triggers outbox events when stock falls below threshold
* Updates order status → `CONFIRMED`

---

### Flow

1. Fetch order and validate state (`PENDING` only)
2. Fetch order items
3. Lock stock rows (`SELECT FOR UPDATE`)
4. Validate stock availability
5. Deduct stock
6. Insert audit log (`stock_movements`)
7. Insert outbox event (if low stock threshold reached)
8. Update order status to `CONFIRMED`
9. Commit transaction

---

### Guarantees

* No overselling during confirmation
* No partial updates (atomic transaction)
* Full audit trail for stock changes
* Reliable event delivery via Outbox Pattern
* Prevents invalid state transitions (only `PENDING` → `CONFIRMED`)

---

### Example

#### Request

```http
POST /orders/:id/confirm
```

---

#### Response

```json
{
  "orderId": "uuid",
  "status": "CONFIRMED"
}
```
---

I need README Info on implementation of ORDER Cancel and ORDER FULLFILLED!

Perfect — here are clean, professional README sections for both Cancel and Fulfil 👇
(Just paste them under your Orders section)

❌ Orders — Cancellation (CANCELLED)

Orders can be cancelled only before confirmation, ensuring no impact on stock or system consistency.

Approach
Cancellation is allowed only when order status is PENDING
Executed inside a database transaction
Updates order status → CANCELLED
No stock updates or audit logs required

Flow
Fetch order by ID
Validate existence
Check status is PENDING
Update order status → CANCELLED
Commit transaction

Guarantees
Prevents cancellation after stock deduction
No side effects on inventory
Ensures valid state transitions only
No partial updates (transactional safety)

Example
Request
POST /orders/:id/cancel

Response
{
  "orderId": "uuid",
  "status": "CANCELLED"
}

---

📦 Orders — Fulfilment (FULFILLED)

Order fulfilment represents the final stage of the order lifecycle after successful confirmation.

Approach
Fulfilment is allowed only when order status is CONFIRMED
Executed inside a database transaction
Updates order status → FULFILLED
No stock changes (already deducted during confirmation)

Flow
Fetch order by ID
Validate existence
Check status is CONFIRMED
Update order status → FULFILLED
Commit transaction

Guarantees
Prevents fulfilment of unconfirmed orders
Maintains correct order lifecycle transitions
No duplicate or invalid state changes
Transactional integrity

Example
Request
POST /orders/:id/fulfil

Response
{
  "orderId": "uuid",
  "status": "FULFILLED"
}

---

---

## 🛡️ Data Integrity & Performance Optimizations

The system incorporates database-level constraints and indexing to ensure consistency and scalability.

### Foreign Key Constraints

* Enforced relationships between tables:
  * `order_items.order_id → orders.id`
  * `order_items.product_id → products.id`
* Prevents invalid or orphaned records
* Ensures referential integrity at the database level

---

### Indexing Strategy

Indexes are added to optimize frequently accessed queries:

* `stock(product_id)` → fast stock lookup
* `orders(status)` → efficient filtering by lifecycle state
* `outbox_events(status)` → optimized worker polling
* `orders(idempotency_key)` → faster idempotency checks

---

### Idempotent Migrations

* All migrations are designed to be safe for repeated execution
* Uses conditional checks (`IF NOT EXISTS`) to avoid duplication errors
* Ensures compatibility with CI/CD pipelines and multiple environments

---

### Event Optimization (Threshold Crossing)

Low-stock events are triggered only when stock crosses the threshold:

```text
Before: Triggered repeatedly below threshold ❌
After: Triggered only on crossing (e.g., 8 → 4) ✅

This prevents event flooding and ensures meaningful notifications

# ✅ 2. UPDATE — Order Confirmation (Enhance it)

👉 Add THIS inside your **Order Confirm section → Guarantees**

```md
* Prevents duplicate low-stock events via threshold crossing logic  
* Ensures referential integrity through foreign key constraints  
* Optimized query performance using database indexes 

---

## 📊 Error Handling & Observability

The API implements consistent error handling and logging for easier debugging and reliability.

### Standard Error Format

All endpoints return structured error responses:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable message"
}

---

## 📦 Categories & Products (Milestone 2)

The system provides a complete domain layer for managing categories and products, forming the foundation for stock and order operations.

---

### 🗂️ Categories — CRUD (Soft Delete)

Categories represent logical groupings of products.

#### Features

* Create categories with name and optional description  
* Fetch categories with pagination  
* Update category details  
* Soft delete using `is_active = false`  

#### Guarantees

* No hard deletes (data is preserved for integrity and auditability)  
* Only active categories are returned in queries  
* Consistent pagination response format  

---

### 📦 Products — Creation (Transactional)

Products are created with strong guarantees ensuring consistency with stock.

#### Approach

* Product creation is executed inside a database transaction  
* Each product is linked to a valid category  
* A corresponding stock row is automatically created  

#### Flow

1. Validate input (name, SKU, price, categoryId)  
2. Validate category existence  
3. Begin transaction  
4. Insert product into `products` table  
5. Insert stock row into `stock` table (quantity = 0, default threshold)  
6. Commit transaction  

#### Guarantees

* Product and stock are always created together (no partial state)  
* Referential integrity enforced via category validation  
* SKU uniqueness enforced at database level  
* Prevents orphaned products without stock  

---

### 🔍 Products — Read APIs

#### GET /products

Supports:

* Pagination (`page`, `limit`)  
* Search (`name ILIKE`)  
* Category filtering  

#### Response Format

```json
{
  "data": [...],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "hasNext": false
  }
}
GET /products/:id

Returns product details along with current stock quantity.

{
  "id": "uuid",
  "name": "Product",
  "sku": "SKU-001",
  "price": "100.00",
  "quantity": 0
}

---
🔗 Product ↔ Stock Relationship

Every product has a corresponding stock row:

Product created → Stock row auto-created (quantity = 0)

This ensures:

Stock operations always have a valid reference
No need for conditional stock creation logic
Simplifies downstream services (orders, stock updates)
❌ Validation & Error Handling

The system validates inputs before hitting the database.

Examples
Invalid UUID → 400 INVALID_CATEGORY_ID
Missing fields → 400 INVALID_INPUT
Duplicate SKU → 409 SKU_ALREADY_EXISTS
Standard Error Format
{
  "error": "ERROR_CODE",
  "message": "Human-readable message"
}
🧠 Design Decisions
Soft deletes used instead of hard deletes for data safety
Transactions used for product + stock creation to avoid inconsistency
Validation performed before DB queries for better performance
SKU uniqueness enforced at database level (source of truth)
---

## 📊 Observability (Milestone 9)

The system implements a structured observability layer to provide visibility into system behavior, performance, and failures.

---

### 🔍 Structured Logging (Pino + Trace ID)

Each request is assigned a unique `traceId` to enable end-to-end tracing.

#### Implementation

* Middleware generates a UUID-based `traceId` per request  
* `traceId` is attached to:
  * Request context (`req.log`)
  * Response headers (`X-Trace-Id`)  
* Pino is used for structured JSON logging  

#### Example Log

```json
{
  "traceId": "b1c2...",
  "method": "GET",
  "url": "/products",
  "status": 200,
  "duration": 5
}
Benefits
Enables request-level debugging
Allows correlation of logs across services
Provides structured, machine-readable logs

📈 Prometheus Metrics

The system exposes metrics for monitoring request volume and performance.

Endpoint
GET /metrics
Default Metrics

Provided by prom-client:

CPU usage
Memory usage
Event loop lag
Garbage collection stats
Custom Metrics
1. HTTP Request Counter
http_requests_total{method="GET",route="/products",status="200"} 5

Tracks total number of requests per route.

2. Request Duration Histogram
http_request_duration_seconds_bucket{...}

Tracks latency distribution of requests.

Guarantees
Every request is tracked
Latency is measured in seconds
Metrics follow Prometheus standards
🩺 Health Check (Dependency-aware)

The system provides a health endpoint that validates external dependencies.

Endpoint
GET /health
Response
{
  "status": "ok",
  "postgres": "connected",
  "redis": "connected"
}
Behavior
Returns 200 OK when all dependencies are healthy
Returns 503 Service Unavailable if any dependency fails

🧠 Design Decisions
Trace ID is propagated via headers instead of response body
Logging and metrics are implemented as middleware for consistency
Database errors are not exposed directly — mapped to domain errors
Metrics include both system-level and application-level insights

---

🧪 Testing Strategy

This project follows a production-grade integration testing approach, focusing on system behavior rather than isolated unit testing.

All tests are written using:

Jest
Supertest
📁 Test Coverage Overview
src/__tests__/
├── products.test.js
├── stock.test.js
├── stock.concurrency.test.js
├── stock.idempotency.test.js
├── orders.test.js
├── orders.idempotency.test.js
├── confirmOrder.test.js
├── confirmOrder.outbox.test.js
├── order.status.test.js
🔥 Core Testing Philosophy

Tests validate real system guarantees:

Transactions
Concurrency safety
Idempotency
Event consistency (Outbox Pattern)
Business rule enforcement

🧱 1. Product & Category Tests
Covered in: products.test.js
✅ Create product with valid category → 201
❌ Invalid category → 404 CATEGORY_NOT_FOUND
❌ Duplicate SKU → 409 SKU_ALREADY_EXISTS
✅ Pagination response structure verified

⚙️ 2. Stock Management Tests
Covered in: stock.test.js
✅ Increase / decrease stock
❌ Prevent negative stock (INSUFFICIENT_STOCK)
✅ Stock movement audit records created
✅ Threshold logic validated

⚡ 3. Concurrency Control (CRITICAL)
Covered in: stock.concurrency.test.js

Simulates concurrent stock deductions:

Initial stock: 10
10 concurrent requests × -2
Guarantees:
✅ Only 5 succeed
❌ 5 fail with 409
✅ Final stock = 0 (never negative)

👉 Uses row-level locking (SELECT FOR UPDATE)

🔁 4. Idempotency Tests
Covered in:
stock.idempotency.test.js
orders.idempotency.test.js
Guarantees:
Same X-Idempotency-Key:
✅ Returns identical response
❌ Does NOT execute business logic again
❌ Does NOT hit DB again
Verified By:
Redis cache simulation
Query count assertions

📦 5. Order Creation Tests
Covered in: orders.test.js
✅ Create order successfully
❌ Insufficient stock → 400
✅ Stock deducted during creation (current design)
✅ Transaction rollback on failure

🔁 6. Order Idempotency (HIGH VALUE)
Covered in: orders.idempotency.test.js
✅ Same request key → same orderId
❌ No duplicate orders created
❌ DB not queried on retry

🔒 7. Transaction Safety — Confirm Order
Covered in: confirmOrder.test.js
Success Case:
✅ Order → CONFIRMED
✅ Stock deducted
✅ Stock movement recorded
Failure Case:
❌ Insufficient stock → 409
✅ Transaction rollback
❌ No partial updates

📡 8. Outbox Pattern Validation
Covered in: confirmOrder.outbox.test.js
Guarantees:
✅ Low stock triggers event
✅ Event written inside transaction
❌ No event loss on failure
Verified By:
Mocking writeEvent
Ensuring it is called exactly once

🔄 9. Order Status Transition Rules
Covered in: order.status.test.js
Transition	Allowed
PENDING → CONFIRMED	✅
PENDING → CANCELLED	✅
CONFIRMED → FULFILLED	✅
CONFIRMED → CANCELLED	✅
FULFILLED → any	❌
CANCELLED → any	❌
Guarantees:
❌ Invalid transitions return 400
✅ Valid transitions succeed
🧠 Key Engineering Guarantees

This test suite ensures:

✅ Data Consistency
No negative stock
No partial writes
✅ Concurrency Safety
No overselling under parallel requests
✅ Idempotent APIs
Safe retries without duplication
✅ Transaction Integrity
Rollback on failure
✅ Event Reliability
Outbox ensures delivery consistency
⚙️ Test Execution

Run all tests:

npm test

---

⚙️ Continuous Integration (CI)

This project uses GitHub Actions to automatically run tests on every push and pull request.

🚀 What the CI Pipeline Does
✅ Runs full test suite using Jest
✅ Validates all critical backend flows:
Orders (create, confirm, cancel, fulfil)
Stock management & concurrency
Idempotency (Redis-backed)
Outbox pattern (event consistency)
✅ Prevents merging broken code into main
✅ Ensures consistent behavior across environments
🔄 When It Runs

The CI pipeline is triggered on:

Every push to:
main
develop
Every pull request targeting main
🧪 Test Environment

The CI pipeline runs in a fully isolated environment:

Database interactions are mocked (no real PostgreSQL required)
Redis interactions are mocked (no external dependency)
External services (e.g., notification service) are mocked

👉 This ensures:

⚡ Fast test execution
🔁 Deterministic results (no flaky tests)
🔒 No dependency on external systems
🧱 Pipeline Steps

The CI workflow performs the following steps:

Checkout repository
Setup Node.js environment
Install dependencies (npm ci)
Run test suite (npm test)
📌 Why This Matters

This CI setup ensures:

🚫 No regressions — failing tests block bad code
🔍 Continuous validation of system behavior
🏗️ Production-grade development workflow

---

🔒 Advanced Guarantees & System Reliability

This system goes beyond standard CRUD operations and implements production-grade guarantees to handle real-world edge cases and failure scenarios.

🔁 Idempotency (Redis + DB Fallback)
Prevents duplicate order creation during retries or network failures
Uses Redis for fast response caching
Falls back to PostgreSQL when cache expires

Guarantees:
Same idempotency key → same response
No duplicate database writes
Race-condition safe via UNIQUE constraint
⚡ Concurrency Control (Row-Level Locking)
Uses PostgreSQL SELECT ... FOR UPDATE
Prevents overselling under concurrent requests

Guarantees:
Stock never goes below zero
Only valid number of requests succeed
Safe under parallel load

🧾 Transaction Safety
All critical operations run inside database transactions
Guarantees:
No partial writes
Automatic rollback on failure
Strong consistency for stock and orders

📡 Outbox Pattern (Event Reliability)
Events are written inside the same transaction as business logic
Ensures no event loss during failures
Guarantees:
No dual-write problem
Reliable event delivery
Eventual consistency with downstream systems

🧠 Reservation Gap Handling

Stock is validated during order creation but deducted during confirmation.

Edge Case Covered:
Order A created (stock available)
Order B confirmed first → consumes stock
Order A confirm → fails
Guarantees:
No overselling across time
System remains consistent under delayed confirmations

🧾 Audit Logging (Full Traceability)

Every important action is recorded in an audit log:

ORDER_CREATED
ORDER_CONFIRMED
ORDER_CANCELLED
ORDER_FULFILLED
Guarantees:
Complete lifecycle tracking
Debugging and observability
Production-grade traceability

🧪 Testing Coverage (Enhanced)

The test suite validates real system guarantees, not just functionality.

Key Test Areas
✅ Order lifecycle (create, confirm, cancel, fulfil)
✅ Idempotency (Redis + DB fallback)
✅ Concurrency (parallel stock updates)
✅ Transaction rollback scenarios
✅ Outbox event triggering
✅ Status transition validation
✅ Reservation gap scenario (real-world edge case)
✅ Audit log invocation

Testing Approach
Uses Jest + Supertest
Mocks external systems (Redis, DB pool, services)
Focuses on integration-level behavior

---

📊 Observability & Metrics

This system includes domain-level metrics to monitor real-world behavior, not just infrastructure health.

Metrics are exposed via a /metrics endpoint using Prometheus-compatible format.

🎯 Why Metrics Matter

Beyond logs and tests, metrics help answer:

Are users retrying requests?
Is Redis cache effective?
Are orders failing due to stock issues?
Are events being generated reliably?

📈 Implemented Metrics
🛒 Orders
orders_created_total
→ Total number of orders created
orders_confirmed_total
→ Total number of successfully confirmed orders

🔁 Idempotency
idempotency_cache_hits_total
→ Number of times a request was served from Redis cache
idempotency_db_fallback_total
→ Number of times DB fallback was used when cache was missed

⚠️ Failures
stock_insufficient_total
→ Number of times an order failed due to insufficient stock

📡 Events
outbox_events_created_total
→ Number of events written to the outbox

🧠 Design Principles
Metrics are recorded only on actual events (no double counting)
Placed at critical decision points:
After successful operations
Before throwing domain errors
Designed to reflect business behavior, not just technical events

🔍 Example Output
orders_created_total 15
orders_confirmed_total 12
idempotency_cache_hits_total 6
idempotency_db_fallback_total 2
stock_insufficient_total 3
outbox_events_created_total 10

🚀 What This Enables

With these metrics, the system can:

Detect retry patterns (client/network issues)
Monitor cache effectiveness
Identify stock bottlenecks
Track order success rate
Verify event generation reliability

---

🔐 Authentication & Authorization (RBAC)

This service integrates with a standalone authentication system and enforces role-based access control (RBAC) at the API layer.

🧠 Design Approach

Authentication is handled using JWT-based verification, while authorization is enforced using role-based middleware.

The service does not call the Auth Service at runtime.
Instead, it verifies tokens locally using a shared secret.

🔑 Authentication (JWT Validation)

Every protected request must include:

Authorization: Bearer <JWT>
Validation includes:
JWT signature verification
Claim validation:
userId must be a valid UUID
role must be one of: admin, manager, viewer
isActive must be true
Token revocation check using Redis blocklist (jti)

On success:

req.user = {
  userId,
  role,
  isActive
};
🛡️ Authorization (RBAC)

Authorization is enforced using a middleware:

authorize("admin", "manager")

Access is granted only if:

req.user.role ∈ allowedRoles
⚙️ Middleware Order (Critical)

Middleware execution order is carefully designed:

Idempotency → Authenticate → Authorize → Route Handler
Why this matters:
Idempotency must run first to prevent duplicate processing
Authentication ensures request identity
Authorization enforces access control

📌 Route-Level RBAC Rules
🛒 Orders
Endpoint	Access
POST /orders	Any authenticated user
POST /orders/:id/confirm	admin, manager
POST /orders/:id/cancel	Any authenticated user
POST /orders/:id/fulfil	admin, manager

### 🗂️ Categories

| Endpoint | Access |
|--------|--------|
| GET /categories | Any authenticated user |
| POST /categories | admin only |
| PATCH /categories/:id | admin only |
| DELETE /categories/:id | admin only |

📦 Products
Endpoint	Access
POST /products	admin, manager
GET /products	Any authenticated user
GET /products/:id	Any authenticated user

📊 Stock
Endpoint	Access
PATCH /stock/:productId	admin, manager
GET /stock/:productId	admin, manager

🚫 Token Revocation (Security)

The system supports immediate token invalidation using a Redis-based blocklist:

Each token contains a unique jti
Revoked tokens are stored in Redis with TTL
Every request checks if the token is blocked
🧪 Testing Strategy

Authentication is mocked in tests to isolate business logic:

authenticate middleware is mocked to inject a test user
authorize middleware is bypassed
No real JWT generation required

This ensures:

Fast and deterministic tests
Focus on core system behavior
Clean separation of concerns
🧠 Why This Matters

This design demonstrates:

Secure service-to-service authentication
Stateless authorization using JWT
Immediate revocation capability
Clean separation between authentication and business logic
Production-grade RBAC enforcement

## 🚧 Future Enhancements

- GET /stock/low — list products below threshold.
  Deferred: system already triggers low_stock events 
  automatically via the Outbox Pattern when stock drops 
  below threshold. Manual polling endpoint is supplementary.

- PATCH /stock/:productId/threshold — update threshold per product.
  Deferred: default threshold is set at product creation.
  Runtime updates are a low-priority operational feature.

- DELETE /products/:id — soft delete product.
  Deferred: products can be deactivated via is_active flag.
  Hard delete introduces referential integrity complexity
  with existing orders.

## 📎 Note

This project is being built step-by-step with a focus on correctness, reliability, and real-world system design.
