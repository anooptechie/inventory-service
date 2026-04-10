const pool = require("../db/postgres");
const { writeEvent } = require("./outboxService");

const createOrder = async ({ customerId, items, idempotencyKey }) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let totalAmount = 0;
    const orderItems = [];

    // 🔹 Step 1 — Validate + LOCK + DEDUCT stock
    for (const item of items) {
      const { rows } = await client.query(
        `SELECT quantity FROM stock
         WHERE product_id = $1
         FOR UPDATE`,
        [item.productId]
      );

      if (rows.length === 0) {
        throw { status: 404, code: "PRODUCT_NOT_FOUND" };
      }

      const available = rows[0].quantity;

      if (available < item.quantity) {
        throw {
          status: 400, // ✅ FIXED
          code: "INSUFFICIENT_STOCK",
          available,
          requested: item.quantity,
        };
      }

      // 🔥 Deduct stock HERE (important for test)
      const newQty = available - item.quantity;

      await client.query(
        `UPDATE stock SET quantity = $1 WHERE product_id = $2`,
        [newQty, item.productId]
      );

      // 🔹 Get price
      const priceRes = await client.query(
        `SELECT price FROM products WHERE id = $1`,
        [item.productId]
      );

      if (priceRes.rows.length === 0) {
        throw {
          status: 404,
          code: "PRODUCT_NOT_FOUND",
        };
      }

      const price = priceRes.rows[0].price;

      totalAmount += price * item.quantity;

      orderItems.push({
        ...item,
        unit_price: price,
      });
    }

    // 🔹 Step 2 — Insert order
    const orderResult = await client.query(
      `INSERT INTO orders (customer_id, idempotency_key, total_amount)
       VALUES ($1, $2, $3)
       RETURNING id, status`,
      [customerId, idempotencyKey, totalAmount]
    );

    const order = orderResult.rows[0];

    // 🔹 Step 3 — Insert order_items
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
    if (err.code === "23505") {
      throw {
        status: 409,
        code: "ORDER_CONFLICT",
      };
    }
    throw err;
  } finally {
    client.release();
  }
};

const confirmOrder = async ({ orderId, userId }) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔹 Step 1 — Get order
    const orderRes = await client.query(
      `SELECT * FROM orders WHERE id = $1`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      throw { status: 404, code: "ORDER_NOT_FOUND" };
    }

    const order = orderRes.rows[0];

    if (order.status !== "PENDING") {
      throw {
        status: 400,
        code: "INVALID_ORDER_STATE",
      };
    }

    // 🔹 Step 2 — Get order items
    const itemsRes = await client.query(
      `SELECT * FROM order_items WHERE order_id = $1`,
      [orderId]
    );

    const items = itemsRes.rows;

    // 🔹 Step 3 — Deduct stock (WITH LOCK)
    for (const item of items) {
      const stockRes = await client.query(
        `SELECT quantity, low_stock_threshold
         FROM stock
         WHERE product_id = $1
         FOR UPDATE`,
        [item.product_id]
      );

      const stock = stockRes.rows[0];

      if (stock.quantity < item.quantity) {
        throw {
          status: 409,
          code: "INSUFFICIENT_STOCK",
          available: stock.quantity,
          requested: item.quantity,
        };
      }

      const newQty = stock.quantity - item.quantity;

      // update stock
      await client.query(
        `UPDATE stock
         SET quantity = $1, updated_at = NOW()
         WHERE product_id = $2`,
        [newQty, item.product_id]
      );

      // audit log
      await client.query(
        `INSERT INTO stock_movements
         (product_id, adjustment, quantity_before, quantity_after, reason, performed_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          item.product_id,
          -item.quantity,
          stock.quantity,
          newQty,
          "sale",
          userId,
        ]
      );

      // 🔥 outbox trigger
      if (
        stock.quantity > stock.low_stock_threshold &&
        newQty <= stock.low_stock_threshold
      ) {
        await writeEvent(client, "inventory.low_stock", {
          productId: item.product_id,
          quantity: newQty,
          threshold: stock.low_stock_threshold,
        });
      }
    }

    // 🔹 Step 4 — Update order status
    await client.query(
      `UPDATE orders
       SET status = 'CONFIRMED'
       WHERE id = $1`,
      [orderId]
    );

    await client.query("COMMIT");

    return {
      orderId,
      status: "CONFIRMED",
    };

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

const cancelOrder = async ({ orderId }) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const res = await client.query(
      `SELECT status FROM orders WHERE id = $1`,
      [orderId]
    );

    if (res.rows.length === 0) {
      throw { status: 404, code: "ORDER_NOT_FOUND" };
    }

    const order = res.rows[0];

    if (order.status !== "PENDING") {
      throw {
        status: 400,
        code: "INVALID_ORDER_STATE",
      };
    }

    await client.query(
      `UPDATE orders
       SET status = 'CANCELLED'
       WHERE id = $1`,
      [orderId]
    );

    await client.query("COMMIT");

    return {
      orderId,
      status: "CANCELLED",
    };

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

const fulfilOrder = async ({ orderId }) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const res = await client.query(
      `SELECT status FROM orders WHERE id = $1`,
      [orderId]
    );

    if (res.rows.length === 0) {
      throw { status: 404, code: "ORDER_NOT_FOUND" };
    }

    const order = res.rows[0];

    if (order.status !== "CONFIRMED") {
      throw {
        status: 400,
        code: "INVALID_ORDER_STATE",
      };
    }

    await client.query(
      `UPDATE orders
       SET status = 'FULFILLED'
       WHERE id = $1`,
      [orderId]
    );

    await client.query("COMMIT");

    return {
      orderId,
      status: "FULFILLED",
    };

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
module.exports = { createOrder, confirmOrder, cancelOrder, fulfilOrder };