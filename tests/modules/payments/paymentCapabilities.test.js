import { describe, expect, it } from "vitest";
import { parseEnv } from "../../../src/config/env.js";
import { getPaymentCapabilities } from "../../../src/services/payment/index.js";

const environment = (overrides = {}) => ({
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://127.0.0.1:27017",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  CORS_ALLOWED_ORIGINS: "http://localhost:5173",
  ...overrides,
});

describe("Task 19 server-derived payment capabilities", () => {
  it("enables only configured nonproduction MockPrepaid and exposes no provider configuration", () => {
    expect(
      getPaymentCapabilities(
        { PREPAID_PROVIDER: "MOCK_PREPAID", MOCK_PREPAID_SECRET: "configured" },
        { production: false },
      ),
    ).toEqual({ prepaidReady: true });
    expect(
      getPaymentCapabilities(
        { PREPAID_PROVIDER: "MOCK_PREPAID", MOCK_PREPAID_SECRET: undefined },
        { production: false },
      ),
    ).toEqual({ prepaidReady: false });
    expect(
      getPaymentCapabilities(
        { PREPAID_PROVIDER: "MOCK_PREPAID", MOCK_PREPAID_SECRET: "configured" },
        { production: true },
      ),
    ).toEqual({ prepaidReady: false });
    expect(
      getPaymentCapabilities(
        { PREPAID_PROVIDER: "PHONEPE", MOCK_PREPAID_SECRET: "irrelevant" },
        { production: false },
      ),
    ).toEqual({ prepaidReady: false });
    expect(
      getPaymentCapabilities(
        { PREPAID_PROVIDER: "DISABLED", MOCK_PREPAID_SECRET: "irrelevant" },
        { production: false },
      ),
    ).toEqual({ prepaidReady: false });
    expect(
      Object.keys(getPaymentCapabilities({ PREPAID_PROVIDER: "DISABLED" })),
    ).toEqual(["prepaidReady"]);
  });

  it("preserves explicit configuration state through runtime environment parsing", () => {
    const unconfigured = parseEnv(environment());
    expect(unconfigured).toMatchObject({
      PREPAID_PROVIDER: "MOCK_PREPAID",
      MOCK_PREPAID_SECRET: undefined,
    });
    expect(getPaymentCapabilities(unconfigured, { production: false })).toEqual(
      {
        prepaidReady: false,
      },
    );

    const configured = parseEnv(
      environment({
        PREPAID_PROVIDER: "MOCK_PREPAID",
        MOCK_PREPAID_SECRET: "configured-mock-secret-that-is-long-enough",
      }),
    );
    expect(getPaymentCapabilities(configured, { production: false })).toEqual({
      prepaidReady: true,
    });
  });
});
