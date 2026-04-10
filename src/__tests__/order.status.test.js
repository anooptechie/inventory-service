const request = require("supertest");
const app = require("../app");
const pool = require("../db/postgres");

jest.mock("../db/postgres");

describe("Order Status Transitions", () => {
    let mockQuery;

    beforeEach(() => {
        jest.clearAllMocks();

        mockQuery = jest.fn();

        pool.connect.mockResolvedValue({
            query: mockQuery,
            release: jest.fn(),
        });
    });

    test("should not confirm already CONFIRMED order", async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [] }) // BEGIN
            .mockResolvedValueOnce({
                rows: [{ id: "order-1", status: "CONFIRMED" }],
            })
            .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

        const res = await request(app)
            .post("/orders/order-1/confirm")
            .send();

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe("INVALID_ORDER_STATE");
    });

    test("should not fulfil PENDING order", async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [] }) // BEGIN
            .mockResolvedValueOnce({
                rows: [{ status: "PENDING" }],
            })
            .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

        const res = await request(app)
            .post("/orders/order-1/fulfil")
            .send();

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe("INVALID_ORDER_STATE");
    });

    test("should fulfil CONFIRMED order", async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [] }) // BEGIN
            .mockResolvedValueOnce({
                rows: [{ status: "CONFIRMED" }],
            })
            .mockResolvedValueOnce({ rows: [] }) // UPDATE
            .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const res = await request(app)
            .post("/orders/order-1/fulfil")
            .send();

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe("FULFILLED");
    });

    test("should not cancel non-PENDING order", async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [] }) // BEGIN
            .mockResolvedValueOnce({
                rows: [{ status: "CONFIRMED" }],
            })
            .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

        const res = await request(app)
            .post("/orders/order-1/cancel")
            .send();

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe("INVALID_ORDER_STATE");
    });
});