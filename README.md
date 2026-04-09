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

## 📎 Note

This project is being built step-by-step with a focus on correctness, reliability, and real-world system design.
