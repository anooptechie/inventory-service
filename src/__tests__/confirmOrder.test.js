const request = require("supertest");
const app = require("../app");
const pool = require("../db/postgres");

// 🔥 NEW: mock audit service
jest.mock("../services/auditService", () => ({
  writeAuditLog: jest.fn(),
}));

const { writeAuditLog } = require("../services/auditService");

jest.mock("../db/postgres");

describe("Confirm Order API", () => {
  let mockQuery;

  beforeEach(() => {
    jest.clearAllMocks();

    mockQuery = jest.fn();

    pool.connect.mockResolvedValue({
      query: mockQuery,
      release: jest.fn(),
    });
  });

  test("should confirm order and deduct stock", async () => {
    mockQuery
      // BEGIN
      .mockResolvedValueOnce({ rows: [] })

      // 🔹 Get order
      .mockResolvedValueOnce({
        rows: [{ id: "order-1", status: "PENDING" }],
      })

      // 🔹 Get order_items
      .mockResolvedValueOnce({
        rows: [
          {
            product_id: "prod-1",
            quantity: 2,
          },
        ],
      })

      // 🔹 SELECT stock FOR UPDATE
      .mockResolvedValueOnce({
        rows: [{ quantity: 10, low_stock_threshold: 5 }],
      })

      // 🔹 UPDATE stock
      .mockResolvedValueOnce({ rows: [] })

      // 🔹 INSERT stock_movement
      .mockResolvedValueOnce({ rows: [] })

      // 🔹 UPDATE order status
      .mockResolvedValueOnce({ rows: [] })

      // 🔥 AUDIT LOG (new query)
      .mockResolvedValueOnce({ rows: [] })

      // COMMIT
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/orders/order-1/confirm")
      .send();

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("CONFIRMED");

    // 🔥 Updated count (includes audit log)
    expect(mockQuery).toHaveBeenCalledTimes(8);
  });

  test("should rollback if insufficient stock", async () => {
    mockQuery
      // BEGIN
      .mockResolvedValueOnce({ rows: [] })

      // 🔹 Get order
      .mockResolvedValueOnce({
        rows: [{ id: "order-1", status: "PENDING" }],
      })

      // 🔹 Get order_items
      .mockResolvedValueOnce({
        rows: [
          {
            product_id: "prod-1",
            quantity: 5,
          },
        ],
      })

      // 🔹 SELECT stock FOR UPDATE (insufficient)
      .mockResolvedValueOnce({
        rows: [{ quantity: 2, low_stock_threshold: 5 }],
      })

      // 🔥 ROLLBACK
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/orders/order-1/confirm")
      .send();

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("INSUFFICIENT_STOCK");

    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  // 🔥 NEW TEST (audit verification)
  test("should write audit log on confirm order", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: "order-1", status: "PENDING" }],
      })
      .mockResolvedValueOnce({
        rows: [{ product_id: "prod-1", quantity: 2 }],
      })
      .mockResolvedValueOnce({
        rows: [{ quantity: 10, low_stock_threshold: 5 }],
      })
      .mockResolvedValueOnce({ rows: [] }) // update stock
      .mockResolvedValueOnce({ rows: [] }) // stock movement
      .mockResolvedValueOnce({ rows: [] }) // update order
      .mockResolvedValueOnce({ rows: [] }) // audit log
      .mockResolvedValueOnce({ rows: [] }); // commit

    const res = await request(app)
      .post("/orders/order-1/confirm")
      .send();

    expect(res.statusCode).toBe(200);

    // 🔥 Core assertion
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "ORDER_CONFIRMED",
      })
    );
  });

  test("should fail confirm if stock was consumed after order creation (reservation gap)", async () => {
    mockQuery
      // BEGIN
      .mockResolvedValueOnce({ rows: [] })

      // 🔹 Order exists (was created earlier)
      .mockResolvedValueOnce({
        rows: [{ id: "order-1", status: "PENDING" }],
      })

      // 🔹 Order items
      .mockResolvedValueOnce({
        rows: [
          {
            product_id: "prod-1",
            quantity: 5,
          },
        ],
      })

      // 🔥 Stock is now lower (consumed by another order)
      .mockResolvedValueOnce({
        rows: [{ quantity: 2, low_stock_threshold: 5 }],
      })

      // 🔹 ROLLBACK
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/orders/order-1/confirm")
      .send();

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("INSUFFICIENT_STOCK");

    // 🔥 Ensure rollback path executed
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });
});