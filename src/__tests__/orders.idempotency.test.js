// Override global setup mock — this test needs real idempotency middleware
jest.unmock("../api/middlewares/idempotency");

jest.mock(
  "../api/middlewares/authenticate",
  () => require("../__mocks__/authMiddleware").authenticate,
);

jest.mock(
  "../api/middlewares/authorize",
  () => require("../__mocks__/authMiddleware").authorize,
);

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

    pool.query = jest.fn();
  });

  test("same idempotency key should return cached response", async () => {
    const key = "same-key-123";

    // 🔥 Redis MISS
    redis.get.mockResolvedValueOnce(null);

    // 🔥 DB fallback → no existing order
    pool.query.mockResolvedValueOnce({ rows: [] });

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
      }),
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

    expect(mockQuery).toHaveBeenCalledTimes(8);
  });

  // 🔥 FIXED: moved INSIDE describe
  test("should fallback to DB when Redis cache is missed", async () => {
    const key = "db-fallback-key";

    redis.get.mockResolvedValue(null);

    // 🔥 DB fallback hit
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: "order-1",
          status: "PENDING",
          total_amount: 200,
        },
      ],
    });

    const res = await request(app)
      .post("/orders")
      .set("X-Idempotency-Key", key)
      .send({
        items: [
          {
            productId: "prod-1",
            quantity: 2,
          },
        ],
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.orderId).toBe("order-1");

    // 🔥 No transaction should start
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

