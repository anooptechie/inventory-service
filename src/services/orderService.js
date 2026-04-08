const pool = require("../db/postgres");

const createOrder = async ({ customerId, items, idempotencyKey }) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // 🔹 Step 1 — Validate stock (lock rows)
        for (const item of items) {
            const { rows } = await client.query(
                `SELECT quantity FROM stock
         WHERE product_id = $1
         FOR UPDATE`,
                [item.productId]
            );

            if (rows.length === 0) {
                throw {
                    status: 404,
                    code: "PRODUCT_NOT_FOUND",
                };
            }

            const available = rows[0].quantity;

            if (available < item.quantity) {
                throw {
                    status: 409,
                    code: "INSUFFICIENT_STOCK",
                    available,
                    requested: item.quantity,
                };
            }
        }

        // 🔹 Step 2 — Calculate total + get prices
        let totalAmount = 0;
        const orderItems = [];

        for (const item of items) {
            const { rows } = await client.query(
                `SELECT price FROM products WHERE id = $1`,
                [item.productId]
            );

            const price = rows[0].price;

            totalAmount += price * item.quantity;

            orderItems.push({
                ...item,
                unit_price: price,
            });
        }

        // 🔹 Step 3 — Insert order
        const orderResult = await client.query(
            `INSERT INTO orders (customer_id, idempotency_key, total_amount)
       VALUES ($1, $2, $3)
       RETURNING id, status`,
            [customerId, idempotencyKey, totalAmount]
        );

        const order = orderResult.rows[0];

        // 🔹 Step 4 — Insert order_items
        for (const item of orderItems) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)`,
                [order.id, item.productId, item.quantity, item.unit_price]
            );
        }

        await client.query("COMMIT");

        return {
            orderId: order.id,
            status: order.status,
            totalAmount,
            items: orderItems,
        };

    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
};

module.exports = { createOrder };