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

describe("Orders API", () => {
    let mockQuery;

    beforeEach(() => {
        jest.clearAllMocks();

        mockQuery = jest.fn();

        pool.connect.mockResolvedValue({
            query: mockQuery,
            release: jest.fn(),
        });

        // ✅ Redis mocks
        redis.get.mockResolvedValue(null);
        redis.set.mockResolvedValue("OK");
        redis.del.mockResolvedValue(1);
    });

    test("should create order successfully", async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [] }) // BEGIN
            .mockResolvedValueOnce({ rows: [{ quantity: 10 }] }) // SELECT stock
            .mockResolvedValueOnce({ rows: [] }) // UPDATE stock
            .mockResolvedValueOnce({ rows: [{ price: 100 }] }) // SELECT price
            .mockResolvedValueOnce({
                rows: [{ id: "order-1", status: "created" }],
            }) // INSERT order
            .mockResolvedValueOnce({ rows: [] }) // INSERT order_items
            .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const res = await request(app)
            .post("/orders")
            .set("X-Idempotency-Key", `order-${Date.now()}`)
            .send({
                items: [
                    {
                        productId: "550e8400-e29b-41d4-a716-446655440000",
                        quantity: 2,
                    },
                ],
            });

        expect(res.statusCode).toBe(201);
        expect(res.body.orderId).toBeDefined();
    });

    test("should fail if insufficient stock", async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [] }) // BEGIN
            .mockResolvedValueOnce({ rows: [{ quantity: 1 }] }) // SELECT
            .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

        const res = await request(app)
            .post("/orders")
            .set("X-Idempotency-Key", "order-2")
            .send({
                items: [
                    {
                        productId: "550e8400-e29b-41d4-a716-446655440000",
                        quantity: 5,
                    },
                ],
            });

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe("INSUFFICIENT_STOCK");
    });
});