1. — Manual Testing (CONCURRENCY FULL WALKTHROUGH)
✅ Step 0 — Make sure server is running
npm run dev

👉 You should see:

Server running on port 5000
🗄️ Step 1 — Insert test stock into DB

You need one stock row to test against.

Option A — Using psql (recommended)
psql -U inv_user -d inv_db

docker exec -it <your-postgres-container-name> psql -U inv_user -d inv_db

👉 Then run:

INSERT INTO stock (product_id, quantity, low_stock_threshold)
VALUES ('11111111-1111-1111-1111-111111111111', 10, 5);

👉 Then:

SELECT * FROM stock;

You should see quantity = 10

⚠️ Important

Use this UUID everywhere:

11111111-1111-1111-1111-111111111111
🌐 Step 2 — Test API (Normal case)
🔹 Decrease stock
curl -X PATCH http://localhost:5000/stock/11111111-1111-1111-1111-111111111111 \
  -H "Content-Type: application/json" \
  -d '{"adjustment": -3, "reason": "sale"}'
✅ Expected response
{
  "productId": "11111111-1111-1111-1111-111111111111",
  "quantity": 7,
  "threshold": 5
}
📈 Step 3 — Increase stock
curl -X PATCH http://localhost:5000/stock/11111111-1111-1111-1111-111111111111 \
  -H "Content-Type: application/json" \
  -d '{"adjustment": 5, "reason": "restock"}'

👉 Expected:

quantity becomes 12

🚫 Step 4 — Test insufficient stock (IMPORTANT)

Try to deduct more than available:

curl -X PATCH http://localhost:5000/stock/11111111-1111-1111-1111-111111111111 \
  -H "Content-Type: application/json" \
  -d '{"adjustment": -50, "reason": "sale"}'
✅ Expected response
{
  "error": "INSUFFICIENT_STOCK",
  "details": {
    "available": 12,
    "requested": 50
  }
}

👉 And stock should NOT change.

🔍 Step 5 — Verify DB state

Back in psql:

SELECT quantity FROM stock WHERE product_id = '11111111-1111-1111-1111-111111111111';

👉 Should still be correct (no negative values)

⚡ Step 6 — Simulate Concurrency (simple version)

Open 2 terminals

Run this in both quickly:

curl -X PATCH http://localhost:5000/stock/11111111-1111-1111-1111-111111111111 \
  -H "Content-Type: application/json" \
  -d '{"adjustment": -5, "reason": "sale"}'

  OR

for i in {1..10}; do
  curl -X PATCH http://localhost:5000/stock/11111111-1111-1111-1111-111111111111 \
    -H "Content-Type: application/json" \
    -d '{"adjustment": -2, "reason": "sale"}' &
done
wait

✅ What should happen
One request succeeds
Other may fail (if stock insufficient)

👉 MOST IMPORTANT:

Stock NEVER goes negative
No weird numbers
🔥 Step 7 — Check audit table
SELECT * FROM stock_movements;

👉 You should see:

quantity_before
quantity_after
reason



2. MANUAL TESTING (IDEMPOTENCY)
🧪 Test Case 1 — Same Key (CORE TEST)
Step 1 — First request
curl -X PATCH http://localhost:5000/stock/11111111-1111-1111-1111-111111111111 \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: test-123" \
  -d '{"adjustment": -2, "reason": "sale"}'

👉 Example response:

{
  "productId": "11111111-1111-1111-1111-111111111111",
  "quantity": 8,
  "threshold": 5
}
Step 2 — SAME request again (same key)
curl -X PATCH http://localhost:5000/stock/11111111-1111-1111-1111-111111111111 \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: test-123" \
  -d '{"adjustment": -2, "reason": "sale"}'
✅ Expected
SAME response as before ✅
Stock should NOT decrease again ❌
Step 3 — Verify DB
SELECT quantity FROM stock
WHERE product_id = '11111111-1111-1111-1111-111111111111';

👉 Should remain unchanged after second request

🧪 Test Case 2 — Different Key
curl -X PATCH http://localhost:5000/stock/11111111-1111-1111-1111-111111111111 \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: test-456" \
  -d '{"adjustment": -2, "reason": "sale"}'

👉 Expected:

Stock decreases again ✅
🧪 Test Case 3 — Missing Key
curl -X PATCH http://localhost:5000/stock/11111111-1111-1111-1111-111111111111 \
  -H "Content-Type: application/json" \
  -d '{"adjustment": -2, "reason": "sale"}'
✅ Expected
{
  "error": "IDEMPOTENCY_KEY_REQUIRED"
}
🧪 Test Case 4 — Error should NOT be cached
Step 1 — Force failure
curl -X PATCH http://localhost:5000/stock/11111111-1111-1111-1111-111111111111 \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: test-error" \
  -d '{"adjustment": -999, "reason": "sale"}'

👉 Expected:

INSUFFICIENT_STOCK
Step 2 — Retry SAME request
(same command)
✅ Expected

👉 It should run again, not return cached response
👉 Because:

❌ errors are NOT cached

3. MANUAL TESTING (OUTBOX)

🔹 Step 1 — Reset stock
UPDATE stock
SET quantity = 6
WHERE product_id = '11111111-1111-1111-1111-111111111111';
🔹 Step 2 — Trigger low stock
curl -X PATCH http://localhost:5000/stock/11111111-1111-1111-1111-111111111111 \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: outbox-test" \
  -d '{"adjustment": -2, "reason": "sale"}'

👉 Now quantity = 4 (<= threshold 5)

🔹 Step 3 — Check DB
SELECT type, status FROM outbox_events;

👉 Expected:

inventory.low_stock | PENDING
🔹 Step 4 — Run worker
node src/workers/outboxWorker.js

Wait ~5 seconds

🔹 Step 5 — Check again
SELECT type, status FROM outbox_events;

👉 Expected:

inventory.low_stock | DELIVERED

4. MANUAL TESTING (ORDER CREATED)

🧱 TEST 0 — Setup (VERY IMPORTANT)

Reset clean state:

-- reset stock
UPDATE stock
SET quantity = 10
WHERE product_id = '11111111-1111-1111-1111-111111111111';

-- clear orders
DELETE FROM order_items;
DELETE FROM orders;
🧪 TEST 1 — Happy Path (Order Creation)
Request
curl -X POST http://localhost:5000/orders \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: order-test-1" \
  -d '{
    "items": [
      {
        "productId": "11111111-1111-1111-1111-111111111111",
        "quantity": 2
      }
    ]
  }' | jq
✅ Expected
Status = PENDING
totalAmount = 200
🔍 Verify DB
SELECT * FROM orders;
SELECT * FROM order_items;

👉 Should show:

1 order
1 item
⚠️ IMPORTANT CHECK
SELECT quantity FROM stock;

👉 Should still be:

10

✔ No deduction yet

🧪 TEST 2 — Insufficient Stock
Request
curl -X POST http://localhost:5000/orders \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: order-test-2" \
  -d '{
    "items": [
      {
        "productId": "11111111-1111-1111-1111-111111111111",
        "quantity": 100
      }
    ]
  }' | jq
✅ Expected
{
  "error": "INSUFFICIENT_STOCK",
  "available": 10,
  "requested": 100
}
🔍 Verify DB
SELECT * FROM orders;

👉 Should still be:

Only 1 order (from previous test)

✔ No partial writes

🧪 TEST 3 — Idempotency (CRITICAL)
First request
-H "X-Idempotency-Key: order-test-3"
Second request (same key)

👉 Run SAME curl again

✅ Expected
SAME response
NO new order created
🔍 Verify DB
SELECT COUNT(*) FROM orders;

👉 Should increase by 1 only

🧪 TEST 4 — Different Key
-H "X-Idempotency-Key: order-test-4"
✅ Expected
New order created
🧪 TEST 5 — Multiple Items
curl -X POST http://localhost:5000/orders \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: order-test-5" \
  -d '{
    "items": [
      {
        "productId": "11111111-1111-1111-1111-111111111111",
        "quantity": 2
      },
      {
        "productId": "11111111-1111-1111-1111-111111111111",
        "quantity": 1
      }
    ]
  }' | jq
✅ Expected
totalAmount = 300
2 order_items rows
🧪 TEST 6 — Invalid Input
Empty items
-d '{ "items": [] }'

👉 Expect:

{
  "error": "INVALID_ITEMS"
}

5. MANUAL TESTING (ORDER CONFIRMED)

🧪 STEP-BY-STEP: TEST ORDER CONFIRM
🧱 STEP 0 — Make sure server is running
npm run dev

👉 You should see:

Server running on port 5000
🧱 STEP 1 — Reset DB state

Open psql:

docker exec -it <your-postgres-container> psql -U inv_user -d inv_db
Reset everything clean:
DELETE FROM order_items;
DELETE FROM orders;

UPDATE stock
SET quantity = 10
WHERE product_id = '11111111-1111-1111-1111-111111111111';
🧱 STEP 2 — Verify initial state
SELECT quantity FROM stock;

👉 Expected:

10
🧱 STEP 3 — Create order
curl -X POST http://localhost:5000/orders \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: confirm-test-1" \
  -d '{
    "items": [
      {
        "productId": "11111111-1111-1111-1111-111111111111",
        "quantity": 3
      }
    ]
  }' | jq
✅ Expected response
{
  "orderId": "SOME_UUID",
  "status": "PENDING",
  "totalAmount": 300
}

👉 COPY THIS orderId

🧱 STEP 4 — Verify order in DB
SELECT id, status FROM orders;

👉 Expected:

PENDING
🧱 STEP 5 — Confirm order

Replace <ORDER_ID>:

curl -X POST http://localhost:5000/orders/<ORDER_ID>/confirm | jq
✅ Expected response
{
  "orderId": "<ORDER_ID>",
  "status": "CONFIRMED"
}
🧱 STEP 6 — Verify stock deduction
SELECT quantity FROM stock;

👉 Expected:

7

(10 - 3 = 7)

🧱 STEP 7 — Verify audit log
SELECT product_id, adjustment, quantity_before, quantity_after
FROM stock_movements
ORDER BY created_at DESC
LIMIT 1;

👉 Expected:

adjustment: -3
before: 10
after: 7
🧱 STEP 8 — Verify order status
SELECT status FROM orders WHERE id = '<ORDER_ID>';

👉 Expected:

CONFIRMED
🧱 STEP 9 — Verify outbox (if threshold hit)

If stock ≤ threshold:

SELECT type, status FROM outbox_events;

👉 Expected:

inventory.low_stock | PENDING or DELIVERED

🔥 EXTRA TESTS (IMPORTANT)
❌ Test: Confirm again (should fail)
curl -X POST http://localhost:5000/orders/<ORDER_ID>/confirm | jq

👉 Expected:

{
  "error": "INVALID_ORDER_STATE"
}
❌ Test: Insufficient stock during confirm
Step 1 — Create big order
curl -X POST http://localhost:5000/orders \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: confirm-test-2" \
  -d '{
    "items": [
      {
        "productId": "11111111-1111-1111-1111-111111111111",
        "quantity": 20
      }
    ]
  }'

👉 Should fail at creation OR confirm