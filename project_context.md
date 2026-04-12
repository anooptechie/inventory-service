# Inventory Management System — Project Context

---

## Purpose

This project is designed to demonstrate **application-layer backend engineering** — what happens after authentication is handled, after events are queued, after the infrastructure is in place. It is the service that makes the rest of the portfolio ecosystem meaningful.

Previous projects established:

- Distributed background job processing (BullMQ, retry logic, DLQ)
- Event-driven notification delivery (fan-out, multi-channel, consumer architecture)
- Production-grade authentication and authorisation (JWT, RBAC, token lifecycle)

What was missing: a real application that **consumes** all of that infrastructure. The Inventory Management System fills that gap.

---

## Background

The portfolio already demonstrated infrastructure-level thinking. The Inventory Service demonstrates **domain-level thinking** — how to model a real business problem, how to enforce correctness under real-world conditions, and how to make deliberate trade-offs while being honest about their consequences.

---

## Identified Gap

What was missing before this project:

- An application-layer service that integrates Auth, Notifications, and Background Jobs
- A system that solves real concurrency problems (not just queuing)
- A demonstration of relational database design under real constraints
- A project a non-technical interviewer immediately understands the value of

---

## Design Goal

> Build a system that shows what happens when multiple backend concerns — concurrency, idempotency, event reliability, and access control — must all be solved correctly at the same time, in the same service.

---

## Key Design Decisions

---

### 1. Application Layer — Not Infrastructure

All previous projects operated below the application layer. This project deliberately sits above it — it has a real business domain (products, stock, orders) that any interviewer immediately understands, while the implementation demonstrates the same systems thinking as the infrastructure projects.

**Reason:** A portfolio that shows only infrastructure work raises the question "but can you build something?" This project answers that question while still demonstrating depth.

---

### 2. Four Core Problems — Not One

Most systems projects demonstrate one interesting design problem. This project deliberately solves four simultaneously:

- **Concurrency** — preventing overselling under concurrent load
- **Idempotency** — safe retries without duplicate side effects
- **Event reliability** — guaranteed delivery without dual-write inconsistency
- **Database design** — normalised schema with audit trail and referential integrity

**Reason:** Real production systems face all four problems at once. Solving them in isolation is easy. Solving them together requires genuine systems thinking.

---

### 3. SELECT FOR UPDATE — Pessimistic Locking

The stock adjustment flow uses pessimistic locking — `SELECT FOR UPDATE` — rather than optimistic concurrency control.

**Why pessimistic over optimistic:**

- Stock contention is expected and frequent — optimistic locking would cause high retry rates
- Pessimistic locking is correct and simple to reason about under expected load
- The concurrency guarantee is absolute — no retry logic, no version mismatch handling

**Known limitation:** Under extreme concurrency (flash sales), many requests queue behind the DB lock, potentially exhausting the connection pool. Documented upgrade path: optimistic concurrency with a `version` column, or Redis pre-decrement strategy to validate stock before the DB transaction.

**Interview answer:** "I chose pessimistic locking because stock contention is expected in this domain. Optimistic locking would cause high retry rates. For flash-sale scale I would move to OCC with a version column or Redis pre-decrement."

---

### 4. Outbox Pattern — Not Direct HTTP

The original design called for `POST /events` directly after the DB commit. This creates a dual-write problem — the service can crash between commit and HTTP call, silently losing the event.

The Outbox Pattern eliminates this window: the event is written to an `outbox_events` table inside the same transaction as the stock update. Either both commit or neither does. A BullMQ worker delivers the event asynchronously.

**Why this matters beyond correctness:** This project already had a Background Job System and Notification Service in the portfolio. Not using them here would have been a missed opportunity to demonstrate ecosystem integration. The Outbox Pattern is the mechanism that connects them.

**Interview answer:** "With direct HTTP, a crash between the DB commit and the POST call loses the event permanently. With the Outbox Pattern, the event row is committed atomically with the business operation. The worker delivers it — if it fails, BullMQ retries. The crash window is eliminated."

---

### 5. Idempotency — Redis + DB Fallback

`X-Idempotency-Key` is required on all state-changing endpoints. The implementation has two layers:

- **Redis** — fast O(1) cache hit, 24-hour TTL
- **DB fallback** — `idempotency_key` column on orders table, permanent

**Why two layers:** Redis is fast but ephemeral. If the cache expires and a client retries, the DB fallback prevents duplicate order creation. The `UNIQUE` constraint on the column is the last line of defence against race conditions.

**Reason:** Idempotency was already demonstrated in the Notification Service. Applying it here — in a different domain, with a different failure mode — shows the pattern is understood, not just copied.

---

### 6. Price Snapshot on Order Items

`unit_price` is copied from the product at order creation time and stored on `order_items`. It is never referenced from the products table again.

**Why:** Product prices change. A price increase after an order is placed must not retroactively change what a customer was charged. This is how every real e-commerce system works — Shopify, Amazon, Stripe — all store the price at transaction time.

**Trade-off acknowledged:** If a price correction needs to be applied to a historical order, it requires a manual update to `order_items`. This is intentional — historical accuracy is more important than convenience.

---

### 7. Validate-at-Create, Deduct-at-Confirm

Stock is validated at order creation (PENDING) but only deducted at order confirmation (CONFIRMED).

**Why:** Simple, correct, and avoids premature stock reservation complexity. The system is honest about the trade-off — a race condition exists between create and confirm where another order can claim the stock. This is documented explicitly and handled gracefully with a 409 on confirm.

**Known gap:** Full resolution requires a `reserved_quantity` column — documented as future scope with a clear upgrade path. In an interview, this is presented as a deliberate scope decision, not an oversight.

---

### 8. Separate Stock Table

Stock is a separate table (`stock`) rather than a column on `products`.

**Why:** Stock changes on every order and adjustment. Product data changes rarely. If stock were a column on products, every stock update would touch the products row — creating unnecessary contention on a high-read table. Separating them isolates the write pattern.

**Interview answer:** "Stock and product are different concerns with different access patterns. Stock is write-heavy. Products are read-heavy. Separating them prevents row contention and makes each table independently optimisable."

---

### 9. Soft Delete Over Hard Delete

Both products and categories use soft delete (`is_active = false`) rather than hard delete.

**Why:** Products are referenced by `order_items` and `stock_movements`. Hard deleting a product would require cascading deletes or nullable foreign keys — both problematic for historical data integrity. Soft delete keeps the data, removes it from active queries, and preserves referential integrity.

---

### 10. Append-Only Stock Movements

`stock_movements` rows are never updated or deleted. Every stock change writes a new row.

**Why:** This is an audit trail. Modifying audit records defeats the purpose. The append-only pattern enables full reconstruction of stock history at any point in time — essential for warehouse reconciliation, fraud detection, and compliance.

---

### 11. Auth Service Integration — Consumer Pattern

The Inventory Service does not own authentication. It consumes the Auth Service via two middleware files — `authenticate.js` and `authorize.js` — totalling approximately 30 lines.

**Why standalone:** Auth logic should live in exactly one place. Every service that duplicates login or token management creates divergence risk. The consumer pattern — share JWT_SECRET, verify locally — is stateless and requires no runtime dependency on the Auth Service.

**Interview answer:** "Inventory Service never calls Auth Service at runtime. It verifies the JWT locally using a shared secret. The entire integration surface is two middleware files. If Auth Service is down, Inventory Service continues to function for existing sessions."

---

### 12. RBAC at the Routing Layer

Role checks are applied in the middleware chain — not inside controllers or service functions.

**Why:** Business logic should not make access control decisions. Access control should be declared, visible, and testable at the routing layer. Adding a new protected endpoint requires exactly one change — adding `authorize("admin")` to the route definition.

---

### 13. Pagination Envelope from Day One

All list endpoints return a consistent envelope:

```json
{
  "data": [...],
  "meta": { "page": 1, "limit": 20, "total": 245, "hasNext": true }
}
```

**Why:** Inconsistent pagination responses cause client-side complexity. Building the envelope into `paginate.js` as a shared utility from the start ensures every list endpoint is consistent without any discipline requirement.

---

### 14. Observability — Business Metrics, Not Just Infrastructure

Prometheus metrics go beyond default prom-client system metrics. Custom metrics track:

- `orders_created_total`
- `orders_confirmed_total`
- `stock_insufficient_total`
- `idempotency_cache_hits_total`
- `idempotency_db_fallback_total`
- `outbox_events_created_total`

**Why:** Infrastructure metrics (CPU, memory, event loop) answer "is the system running?" Business metrics answer "is the system doing what it should?" The latter is what on-call engineers actually need.

---

## Portfolio Ecosystem Connection

```
Auth Service           →  Identity Provider
  Issues JWTs. Manages roles.
        │
        │  JWT (shared secret)
        ▼
Inventory Service      →  Application Layer  ← THIS PROJECT
  Products, Stock, Orders.
  Concurrency, Idempotency, Outbox Pattern.
        │
        │  outbox_events → BullMQ worker → POST /events
        ▼
Notification Service   →  Event Consumer
  Fan-out delivery. Email + Webhook.
        │
        ▼
Background Job System  →  Async Infrastructure
  Powers outbox worker. Retry + DLQ.
```

This project is the application layer that makes the entire ecosystem coherent. Without it, the other three projects are infrastructure without a visible purpose. With it, the portfolio tells a complete story.

---

## What This Project Demonstrates

### System Design

- Concurrency control under concurrent load
- Event-driven architecture via Outbox Pattern
- Idempotency for safe client retries
- Relational schema design with audit trail
- Service integration via consumer pattern

### Backend Engineering

- PostgreSQL transactions and row-level locking
- Redis for fast idempotency and blocklist checks
- BullMQ for reliable async event delivery
- Layered architecture — Route → Service → Model → DB
- Append-only audit tables

### Engineering Judgment

- Deliberate scope decisions with documented consequences
- Honest trade-off acknowledgement with upgrade paths
- Separation of concerns — auth, business logic, events
- Correctness prioritised over feature completeness

---

## Key Insight

> This project is not about building an inventory system.
> It is about demonstrating that concurrency, idempotency, event reliability, and access control can be solved correctly and simultaneously in a single production-grade service.

---

## Final Positioning

This project represents the transition from infrastructure-centric backend development to **full-stack systems engineering** — where real business problems and distributed systems concerns are solved together, not in isolation.
