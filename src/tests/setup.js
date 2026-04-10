// src/__tests__/setup.js

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

// 🔹 Mock Axios (for future use)
jest.mock("axios");

// 🔹 Mock UUID (fix ESM issue)
jest.mock("uuid", () => ({
  v4: () => "test-trace-id",
}));

// 🔹 Clear mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});