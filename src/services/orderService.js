const pool = require("../db/postgres");
const { writeEvent } = require("./outboxService");
const { writeAuditLog } = require("./auditService"); // 🔥 NEW
const {
  ordersCreated,
  ordersConfirmed,
  idempotencyDbFallback,
  stockInsufficient,
} = require("../utils/metrics");

const createOrder = async ({ customerId, items, idempotencyKey }) => {

  // 🔥 STEP 1 — DB FALLBACK IDEMPOTENCY CHECK
  if (idempotencyKey) {
    const existing = await pool.query(
      "SELECT id, status, total_amount FROM orders WHERE idempotency_key = $1",
      [idempotencyKey]
    );

    if (existing.rows.length > 0) {
      idempotencyDbFallback.inc(); // ✅ METRIC

      const order = existing.rows[0];

      return {
        orderId: order.id,
        status: order.status,
        totalAmount: order.total_amount,
        isIdempotent: true,
      };
    }
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let totalAmount = 0;
    const orderItems = [];

    // 🔹 Validate + LOCK + DEDUCT stock
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
        stockInsufficient.inc(); // ✅ METRIC

        throw {
          status: 400,
          code: "INSUFFICIENT_STOCK",
          available,
          requested: item.quantity,
        };
      }

      const newQty = available - item.quantity;

      await client.query(
        `UPDATE stock SET quantity = $1 WHERE product_id = $2`,
        [newQty, item.productId]
      );

      const priceRes = await client.query(
        `SELECT price FROM products WHERE id = $1`,
        [item.productId]
      );

      if (priceRes.rows.length === 0) {
        throw { status: 404, code: "PRODUCT_NOT_FOUND" };
      }

      const price = priceRes.rows[0].price;

      totalAmount += price * item.quantity;

      orderItems.push({
        ...item,
        unit_price: price,
      });
    }

    // 🔥 Insert order with race handling
    let order;

    try {
      const orderResult = await client.query(
        `INSERT INTO orders (customer_id, idempotency_key, total_amount)
         VALUES ($1, $2, $3)
         RETURNING id, status`,
        [customerId, idempotencyKey, totalAmount]
      );

      order = orderResult.rows[0];

    } catch (err) {
      if (err.code === "23505") {
        const existing = await pool.query(
          "SELECT id, status, total_amount FROM orders WHERE idempotency_key = $1",
          [idempotencyKey]
        );

        const existingOrder = existing.rows[0];

        await client.query("ROLLBACK");

        return {
          orderId: existingOrder.id,
          status: existingOrder.status,
          totalAmount: existingOrder.total_amount,
          isIdempotent: true,
        };
      }

      throw err;
    }

    // 🔹 Insert order_items
    for (const item of orderItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [order.id, item.productId, item.quantity, item.unit_price]
      );
    }

    // 🔥 AUDIT LOG (CREATE)
    await writeAuditLog(client, {
      entityType: "ORDER",
      entityId: order.id,
      action: "ORDER_CREATED",
    });

    // 🔥 METRIC: order created
    ordersCreated.inc();

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

const confirmOrder = async ({ orderId, userId }) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

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

    const itemsRes = await client.query(
      `SELECT * FROM order_items WHERE order_id = $1`,
      [orderId]
    );

    const items = itemsRes.rows;

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
        stockInsufficient.inc(); // ✅ METRIC (important)

        throw {
          status: 409,
          code: "INSUFFICIENT_STOCK",
          available: stock.quantity,
          requested: item.quantity,
        };
      }

      const newQty = stock.quantity - item.quantity;

      await client.query(
        `UPDATE stock
         SET quantity = $1, updated_at = NOW()
         WHERE product_id = $2`,
        [newQty, item.product_id]
      );

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

    await client.query(
      `UPDATE orders
       SET status = 'CONFIRMED'
       WHERE id = $1`,
      [orderId]
    );

    // 🔥 AUDIT LOG (CONFIRM)
    await writeAuditLog(client, {
      entityType: "ORDER",
      entityId: orderId,
      action: "ORDER_CONFIRMED",
      metadata: {
        itemsCount: items.length,
      },
    });

    // 🔥 METRIC: order confirmed
    ordersConfirmed.inc();

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

    // 🔥 AUDIT LOG (CANCEL)
    await writeAuditLog(client, {
      entityType: "ORDER",
      entityId: orderId,
      action: "ORDER_CANCELLED",
    });

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

    // 🔥 AUDIT LOG (FULFIL)
    await writeAuditLog(client, {
      entityType: "ORDER",
      entityId: orderId,
      action: "ORDER_FULFILLED",
    });

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