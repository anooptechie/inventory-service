jest.mock("../api/middlewares/authenticate", () =>
  require("../__mocks__/authMiddleware").authenticate
);

jest.mock("../api/middlewares/authorize", () =>
  require("../__mocks__/authMiddleware").authorize
);

describe("Test Setup", () => {
  it("should run test environment correctly", () => {
    expect(true).toBe(true);
  });
});