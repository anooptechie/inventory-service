const request = require("supertest");
const app = require("../app");
const pool = require("../db/postgres");
const redis = require("../db/redis");

jest.mock("../db/postgres");
jest.mock("../db/redis", () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  ping: jest.fn(),
}));

describe("Orders Idempotency", () => {
  let mockQuery;

  beforeEach(() => {
    jest.clearAllMocks();

    mockQuery = jest.fn();

    pool.connect.mockResolvedValue({
      query: mockQuery,
      release: jest.fn(),
    });

    redis.set.mockResolvedValue("OK");
    redis.del.mockResolvedValue(1);
  });

  test("same idempotency key should return cached response", async () => {
    const key = "same-key-123";

    // 🔥 FIRST CALL → no cache
    redis.get.mockResolvedValueOnce(null);

    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ quantity: 10 }] }) // stock
      .mockResolvedValueOnce({ rows: [] }) // update stock
      .mockResolvedValueOnce({ rows: [{ price: 100 }] }) // price
      .mockResolvedValueOnce({
        rows: [{ id: "order-1", status: "created" }],
      }) // insert order
      .mockResolvedValueOnce({ rows: [] }) // order_items
      .mockResolvedValueOnce({ rows: [] }); // commit

    const first = await request(app)
      .post("/orders")
      .set("X-Idempotency-Key", key)
      .send({
        items: [
          {
            productId: "550e8400-e29b-41d4-a716-446655440000",
            quantity: 2,
          },
        ],
      });

    expect(first.statusCode).toBe(201);
    expect(first.body.orderId).toBe("order-1");

    // 🔥 SECOND CALL → cache hit
    redis.get.mockResolvedValueOnce(
      JSON.stringify({
        status: 201,
        body: first.body,
      })
    );

    const second = await request(app)
      .post("/orders")
      .set("X-Idempotency-Key", key)
      .send({
        items: [
          {
            productId: "550e8400-e29b-41d4-a716-446655440000",
            quantity: 2,
          },
        ],
      });

    expect(second.statusCode).toBe(201);
    expect(second.body.orderId).toBe("order-1");

    // 🔥 IMPORTANT: DB should NOT be called again
    expect(mockQuery).toHaveBeenCalledTimes(7);
  });
});