jest.mock("../api/middlewares/authenticate", () =>
  require("../__mocks__/authMiddleware").authenticate
);

jest.mock("../api/middlewares/authorize", () =>
  require("../__mocks__/authMiddleware").authorize
);

const request = require("supertest");
const app = require("../app");
const pool = require("../db/postgres");

jest.mock("../services/outboxService", () => ({
    writeEvent: jest.fn(),
}));

jest.mock("../db/postgres");

const { writeEvent } = require("../services/outboxService");

describe("Confirm Order - Outbox Event", () => {
    let mockQuery;

    beforeEach(() => {
        jest.clearAllMocks();

        mockQuery = jest.fn();

        pool.connect.mockResolvedValue({
            query: mockQuery,
            release: jest.fn(),
        });
    });

    test("should write outbox event when stock crosses threshold", async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [] }) // BEGIN
            .mockResolvedValueOnce({
                rows: [{ id: "order-1", status: "PENDING" }],
            })
            .mockResolvedValueOnce({
                rows: [{ product_id: "prod-1", quantity: 6 }],
            })
            .mockResolvedValueOnce({
                rows: [{ quantity: 10, low_stock_threshold: 5 }],
            })
            .mockResolvedValueOnce({ rows: [] }) // update stock
            .mockResolvedValueOnce({ rows: [] }) // stock movement
            .mockResolvedValueOnce({ rows: [] }) // update order
            .mockResolvedValueOnce({ rows: [] }); // commit

        const res = await request(app)
            .post("/orders/order-1/confirm")
            .send();

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe("CONFIRMED");

        // 🔥 REAL ASSERTION
        expect(writeEvent).toHaveBeenCalledTimes(1);
    });
});