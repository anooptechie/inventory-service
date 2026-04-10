const request = require("supertest");
const app = require("../app");
const pool = require("../db/postgres");

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

      // COMMIT
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/orders/order-1/confirm")
      .send();

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("CONFIRMED");

    // 🔥 Ensure all steps executed
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

    // 🔥 CRITICAL ASSERTION:
    // Only queries until failure + rollback should run
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });
});