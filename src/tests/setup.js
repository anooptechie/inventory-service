// src/__tests__/setup.js

// 🔹 Mock idempotency middleware — unit tests skip key requirement
jest.mock("../api/middlewares/idempotency", () => {
  return () => (req, res, next) => next();
});

// 🔹 Mock authenticate middleware — inject test user
jest.mock("../api/middlewares/authenticate", () => {
  return (req, res, next) => {
    req.user = {
      userId: "00000000-0000-0000-0000-000000000001",
      role: "admin",
      isActive: true,
    };
    next();
  };
});

// 🔹 Mock authorize middleware — always allow in unit tests
jest.mock("../api/middlewares/authorize", () => {
  return () => (req, res, next) => next();
});

// 🔹 Mock Postgres pool
jest.mock("../db/postgres", () => {
  return {
    query: jest.fn(),
    connect: jest.fn(() => ({
      query: jest.fn(),
      release: jest.fn(),
    })),
  };
});

// 🔹 Mock Redis
jest.mock("../db/redis", () => {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    ping: jest.fn(),
  };
});

// 🔹 Mock Axios
jest.mock("axios");

// 🔹 Mock UUID
jest.mock("uuid", () => ({
  v4: () => "test-trace-id",
}));

// 🔹 Clear mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
