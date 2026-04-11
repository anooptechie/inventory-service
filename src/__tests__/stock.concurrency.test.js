jest.mock("../api/middlewares/authenticate", () =>
  require("../__mocks__/authMiddleware").authenticate
);

jest.mock("../api/middlewares/authorize", () =>
  require("../__mocks__/authMiddleware").authorize
);

const request = require("supertest");
const app = require("../app");
const pool = require("../db/postgres");

// 🔥 Skip when idempotency mode is ON
const describeIf =
    process.env.TEST_MODE === "idempotency" ? describe.skip : describe;

describeIf("Stock Concurrency Test", () => {
    const PRODUCT_ID = "550e8400-e29b-41d4-a716-446655440000";

    it("should not oversell stock under concurrent requests", async () => {
        let stock = 5;

        const mockClient = {
            query: jest.fn((query) => {
                if (query.includes("BEGIN") || query.includes("COMMIT")) return;

                if (query.includes("SELECT") && query.includes("FOR UPDATE")) {
                    return { rows: [{ quantity: stock }] };
                }

                if (query.includes("UPDATE stock")) {
                    if (stock <= 0) {
                        throw {
                            status: 409,
                            code: "INSUFFICIENT_STOCK",
                            available: stock,
                        };
                    }

                    stock -= 1;
                    return { rows: [{ quantity: stock }] };
                }

                return { rows: [] };
            }),
            release: jest.fn(),
        };

        pool.connect.mockResolvedValue(mockClient);

        const requests = Array.from({ length: 10 }).map(() =>
            request(app)
                .patch(`/stock/${PRODUCT_ID}`)
                .send({ adjustment: -1, reason: "sale" })
        );

        const responses = await Promise.all(requests);

        const success = responses.filter(r => r.statusCode === 200).length;
        const failed = responses.filter(r => r.statusCode === 409).length;

        expect(success).toBe(5);
        expect(failed).toBe(5);
        expect(stock).toBe(0);
    });
});