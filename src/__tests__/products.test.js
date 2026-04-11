jest.mock("../api/middlewares/authenticate", () =>
  require("../__mocks__/authMiddleware").authenticate
);

jest.mock("../api/middlewares/authorize", () =>
  require("../__mocks__/authMiddleware").authorize
);

const request = require("supertest");
const app = require("../app");
const pool = require("../db/postgres");

describe("Products API", () => {
    const CATEGORY_ID = "550e8400-e29b-41d4-a716-446655440000";

    beforeEach(() => {
        jest.clearAllMocks();

        const CATEGORY_ID = "550e8400-e29b-41d4-a716-446655440000";

        // 🔹 Transaction client
        const mockClient = {
            query: jest.fn((query) => {
                if (query.includes("INSERT INTO products")) {
                    return {
                        rows: [
                            {
                                id: "prod-123",
                                name: "iPhone",
                                sku: "IPHONE-001",
                                price: 1000,
                                category_id: CATEGORY_ID,
                            },
                        ],
                    };
                }

                if (query.includes("INSERT INTO stock")) {
                    return { rows: [] };
                }

                return { rows: [] };
            }),
            release: jest.fn(),
        };

        pool.connect.mockResolvedValue(mockClient);

        // 🔹 NON-transaction queries
        pool.query.mockImplementation((query) => {
            // 🔥 FIX: COUNT FIRST
            if (query.toLowerCase().includes("count")) {
                return {
                    rows: [{ count: "1" }],
                };
            }

            // CATEGORY
            if (query.includes("FROM categories")) {
                return {
                    rows: [{ id: CATEGORY_ID, is_active: true }],
                };
            }

            // PRODUCTS LIST
            if (query.includes("FROM products")) {
                return {
                    rows: [
                        {
                            id: "prod-123",
                            name: "iPhone",
                            sku: "IPHONE-001",
                            price: "1000.00",
                            quantity: 0,
                        },
                    ],
                };
            }

            return { rows: [] };
        });
    });

    // ✅ Create Product
    it("should create a product successfully", async () => {
        const res = await request(app)
            .post("/products")
            .send({
                name: "iPhone",
                sku: "IPHONE-001",
                price: 1000,
                categoryId: CATEGORY_ID,
            });

        expect(res.statusCode).toBe(201);
        expect(res.body.name).toBe("iPhone");
    });

    // ❌ Invalid category (valid UUID but not found)
    it("should fail if category does not exist", async () => {
        pool.query.mockImplementationOnce(() => ({
            rows: [], // category not found
        }));

        const res = await request(app)
            .post("/products")
            .send({
                name: "iPhone",
                sku: "IPHONE-002",
                price: 1000,
                categoryId: CATEGORY_ID,
            });

        expect(res.statusCode).toBe(404);
        expect(res.body.error).toBe("CATEGORY_NOT_FOUND");
    });

    // ❌ Duplicate SKU
    it("should fail on duplicate SKU", async () => {
        const CATEGORY_ID = "550e8400-e29b-41d4-a716-446655440000";

        const mockClient = {
            query: jest.fn((query) => {
                if (query.includes("INSERT INTO products")) {
                    const error = new Error("duplicate key");
                    error.code = "23505";
                    error.constraint = "products_sku_unique";
                    throw error;
                }

                return { rows: [] };
            }),
            release: jest.fn(),
        };

        pool.connect.mockResolvedValue(mockClient);

        pool.query.mockImplementation((query) => {
            if (query.includes("FROM categories")) {
                return {
                    rows: [{ id: CATEGORY_ID }],
                };
            }
            return { rows: [] };
        });

        const res = await request(app)
            .post("/products")
            .send({
                name: "iPhone",
                sku: "IPHONE-001",
                price: 1000,
                categoryId: CATEGORY_ID,
            });

        expect(res.statusCode).toBe(409);
        expect(res.body.error).toBe("SKU_ALREADY_EXISTS");
    });

    // ✅ Get products
    it("should fetch products with pagination", async () => {
        const res = await request(app).get("/products");

        expect(res.statusCode).toBe(200);
        expect(res.body.data.length).toBe(1);
        expect(res.body.meta.total).toBe(1);
    });
});