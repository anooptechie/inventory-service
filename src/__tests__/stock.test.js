jest.mock("../api/middlewares/authenticate", () =>
  require("../__mocks__/authMiddleware").authenticate
);

jest.mock("../api/middlewares/authorize", () =>
  require("../__mocks__/authMiddleware").authorize
);

const request = require("supertest");
const app = require("../app");
const pool = require("../db/postgres");

describe("Stock API", () => {
    const PRODUCT_ID = "550e8400-e29b-41d4-a716-446655440000";

    beforeEach(() => {
        jest.clearAllMocks();

        pool.query.mockImplementation((query) => {
            if (query.includes("FROM stock")) {
                return {
                    rows: [
                        {
                            product_id: PRODUCT_ID,
                            quantity: 10,
                        },
                    ],
                };
            }

            return { rows: [] };
        });
    });

    it("should fetch stock for a product", async () => {
        const res = await request(app).get(`/stock/${PRODUCT_ID}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.productId).toBe(PRODUCT_ID);
        expect(res.body.quantity).toBe(10);
    });

    it("should return 404 if stock does not exist", async () => {
        pool.query.mockImplementationOnce(() => ({
            rows: [],
        }));

        const res = await request(app).get(`/stock/${PRODUCT_ID}`);

        expect(res.statusCode).toBe(404);
        expect(res.body.error).toBe("STOCK_NOT_FOUND");
    });

    it("should fail for invalid productId", async () => {
        const res = await request(app).get(`/stock/invalid-id`);

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe("INVALID_PRODUCT_ID");
    });
});