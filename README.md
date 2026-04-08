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

## 📌 Next Steps

* Outbox pattern implementation (guaranteed event delivery)
* Order lifecycle (create, confirm, cancel, fulfil)

---

## 📎 Note

This project is being built step-by-step with a focus on correctness, reliability, and real-world system design.
