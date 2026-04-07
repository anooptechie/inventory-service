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

**Phase 0 Completed**

* Docker setup (Postgres + Redis)
* Database connection established
* Redis connection established
* Migration system implemented
* Health check endpoint (`/health`)

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

## 📌 Next Steps

* Stock Management with concurrency control (`SELECT FOR UPDATE`)
* Idempotency middleware
* Outbox pattern implementation
* Order lifecycle

---

## 📎 Note

This project is being built step-by-step with a focus on correctness, reliability, and real-world system design.
