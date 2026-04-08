1. — Manual Testing (FULL WALKTHROUGH)
✅ Step 0 — Make sure server is running
npm run dev

👉 You should see:

Server running on port 5000
🗄️ Step 1 — Insert test stock into DB

You need one stock row to test against.

Option A — Using psql (recommended)
psql -U inv_user -d inv_db

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

2. MANUAL TESTING
clear