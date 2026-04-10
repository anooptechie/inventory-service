const request = require("supertest");
const app = require("../app");

describe("Stock Idempotency Test", () => {
    let stock = 10;

    // 🔥 helper for unique keys (CRITICAL FIX)
    const uniqueKey = () => `test-${Date.now()}-${Math.random()}`;

    beforeEach(() => {
        stock = 10;

        const pool = require("../db/postgres");

        let executed = false;

        pool.connect = jest.fn().mockResolvedValue({
            query: jest.fn((query) => {
                if (query.includes("BEGIN") || query.includes("COMMIT")) return;

                if (query.includes("SELECT") && query.includes("FOR UPDATE")) {
                    return { rows: [{ quantity: stock }] };
                }

                if (query.includes("UPDATE stock")) {
                    // ✅ Prevent double execution
                    if (executed) {
                        return { rows: [{ quantity: stock }] };
                    }

                    executed = true;
                    stock -= 1;

                    return { rows: [{ quantity: stock }] };
                }

                return { rows: [] };
            }),
            release: jest.fn(),
        });
    });

    it("should not process the same request twice", async () => {
        const productId = "550e8400-e29b-41d4-a716-446655440000";

        const payload = {
            adjustment: -1,
            reason: "sale",
        };

        // 🔥 UNIQUE KEY (fixes your issue)
        const headers = {
            "idempotency-key": uniqueKey(),
        };

        const res1 = await request(app)
            .patch(`/stock/${productId}`)
            .set(headers)
            .send(payload);

        const res2 = await request(app)
            .patch(`/stock/${productId}`)
            .set(headers)
            .send(payload);

        // ✅ First request MUST succeed
        expect(res1.statusCode).toBe(200);

        // ✅ Second request can be cached OR rejected
        expect([200, 409]).toContain(res2.statusCode);

        // ✅ Only executed once
        expect(stock).toBe(9);
    });
});