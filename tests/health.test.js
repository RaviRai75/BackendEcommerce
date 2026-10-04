/**
 * Application shell: health endpoint, response envelope, error contract,
 * security headers, request sanitisation and CORS policy.
 */
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  createPrivateReadMatcher,
  createSecurityHeadersOptions,
} from "../src/app.js";
import { resetAllRateLimits } from "../src/middleware/rateLimiters.js";

afterEach(() => {
  resetAllRateLimits();
});

describe("GET /api/health", () => {
  it("returns 200 in the success envelope", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { status: "ok" },
    });
    expect(typeof response.body.data.uptimeSeconds).toBe("number");
    expect(response.body.data.timestamp).toBeTypeOf("string");
  });

  it("echoes a request id so a log line can be correlated", async () => {
    const response = await request(app).get("/api/health");

    expect(response.headers["x-request-id"]).toBeDefined();
  });

  it("does not reflect an implausible client-supplied request id", async () => {
    const response = await request(app)
      .get("/api/health")
      .set("X-Request-Id", "<script>alert(1)</script>");

    expect(response.headers["x-request-id"]).not.toContain("<script>");
  });
});

describe("Render and platform root probes", () => {
  it("answers GET / and HEAD / with 200 OK for platform health checks", async () => {
    const getRes = await request(app).get("/");
    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe("ok");

    const headRes = await request(app).head("/");
    expect(headRes.status).toBe(200);
  });

  it("answers top-level /health with 200 OK", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("handles Render health check when full URL is supplied in path", async () => {
    const res = await request(app).head(
      "/https://backendecommerce-njwg.onrender.com/",
    );
    expect(res.status).toBe(200);

    const getRes = await request(app).get(
      "/https://backendecommerce-njwg.onrender.com/",
    );
    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe("ok");
  });

  it("answers GET /favicon.ico with 204 No Content", async () => {
    const res = await request(app).get("/favicon.ico");
    expect(res.status).toBe(204);
  });
});

describe("GET /api/ready", () => {
  it("reports 503 while the database is not connected", async () => {
    // No database connection is opened by this suite, which is exactly the
    // state a platform should refuse to route traffic into.
    const response = await request(app).get("/api/ready");

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("error contract", () => {
  it("returns a sanitised 500 with no stack or internal detail", async () => {
    const response = await request(app).get("/api/_dev/boom/unexpected");
    const serialised = JSON.stringify(response.body);

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(response.body.error.message).toBe(
      "Something went wrong on our side. Please try again.",
    );
    expect(response.body.error.requestId).toBeDefined();

    expect(serialised).not.toContain("Simulated");
    expect(serialised).not.toContain("stack");
    expect(serialised).not.toContain(".js");
    expect(serialised).not.toContain("INCOME");
  });

  it("forwards a rejected promise from an async handler to the error handler", async () => {
    const response = await request(app).get("/api/_dev/boom/async");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
  });

  it("returns the intended message and status for a deliberate AppError", async () => {
    const response = await request(app).get("/api/_dev/boom/operational");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Demo product not found.",
        requestId: expect.any(String),
      },
    });
  });

  it("returns the failure envelope for an unknown route", async () => {
    const response = await request(app).get("/api/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.headers["content-type"]).toMatch(/application\/json/);
  });

  it("rejects malformed JSON with a readable code", async () => {
    const response = await request(app)
      .post("/api/does-not-exist")
      .set("Content-Type", "application/json")
      .send('{"unterminated":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("MALFORMED_JSON");
  });

  it("rejects a body larger than the configured limit", async () => {
    const oversized = JSON.stringify({ blob: "x".repeat(80 * 1024) });

    const response = await request(app)
      .post("/api/does-not-exist")
      .set("Content-Type", "application/json")
      .send(oversized);

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("security headers", () => {
  it("sets the expected hardening headers and hides the framework", async () => {
    const response = await request(app).get("/api/health");

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(response.headers["permissions-policy"]).toContain("camera=()");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("does not enable HSTS outside production", async () => {
    const response = await request(app).get("/api/health");

    expect(response.headers["strict-transport-security"]).toBeUndefined();
  });

  it("configures HSTS and insecure-request upgrades for production", () => {
    const options = createSecurityHeadersOptions(true);

    expect(options.hsts).toEqual({
      maxAge: 15552000,
      includeSubDomains: true,
      preload: false,
    });
    expect(
      options.contentSecurityPolicy.directives.upgradeInsecureRequests,
    ).toEqual([]);
  });
});

describe("CORS policy", () => {
  it("allows a configured origin with credentials", async () => {
    const response = await request(app)
      .get("/api/health")
      .set("Origin", "http://localhost:5173");

    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("never answers with a wildcard origin", async () => {
    const response = await request(app)
      .get("/api/health")
      .set("Origin", "http://localhost:5173");

    expect(response.headers["access-control-allow-origin"]).not.toBe("*");
  });

  it("refuses an origin that is not on the allow-list", async () => {
    const response = await request(app)
      .get("/api/health")
      .set("Origin", "https://attacker.test");

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers real allowlisted preflights and rejects attacker preflights", async () => {
    const allowed = await request(app)
      .options("/api/health")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "Authorization");
    const rejected = await request(app)
      .options("/api/health")
      .set("Origin", "https://attacker.test")
      .set("Access-Control-Request-Method", "GET");

    expect(allowed.status).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(rejected.status).toBe(403);
    expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("request sanitisation", () => {
  it("strips MongoDB operators from a query string", async () => {
    // The route 404s, but the sanitiser has already run — the assertion is that
    // no operator key survives to a handler.
    const response = await request(app).get(
      "/api/does-not-exist?email[$ne]=null",
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});

describe("private read cache policy", () => {
  it("prevents storage for customer state and every admin read before auth runs", async () => {
    const responses = await Promise.all([
      request(app).get("/api/cart"),
      request(app).get("/api/cart/"),
      request(app).get("/api/wishlist"),
      request(app).get("/api/wishlist/"),
      request(app).get("/api/referrals/me"),
      request(app).get("/api/referrals/me/"),
      request(app).get("/api/admin/settings"),
      request(app).get("/api/admin/products"),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
  });

  it("normalizes configured API prefixes for mixed-case GET and HEAD reads", () => {
    const isPrivateRead = createPrivateReadMatcher("/API/");

    expect(isPrivateRead("GET", "/API/cart")).toBe(true);
    expect(isPrivateRead("HEAD", "/api/wishlist/?source=test")).toBe(true);
    expect(isPrivateRead("GET", "/Api/referrals/me/")).toBe(true);
    expect(isPrivateRead("GET", "/API/admin/settings")).toBe(true);
    expect(isPrivateRead("POST", "/API/cart")).toBe(false);
    expect(isPrivateRead("GET", "/API/cart/resolve")).toBe(false);
    expect(isPrivateRead("GET", "/API/health")).toBe(false);
  });

  it("does not apply the private policy to public reads", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).not.toBe("private, no-store");
  });
});
