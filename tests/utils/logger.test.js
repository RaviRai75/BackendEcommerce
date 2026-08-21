/**
 * Log redaction (structure.md security §26).
 *
 * The redaction list is configured once, on the root logger, precisely so that
 * no call site can leak a secret by accident. This test asserts the guarantee
 * holds for the shapes we actually log: flat fields, nested objects, and HTTP
 * request headers.
 */
import { describe, expect, it } from "vitest";
import pino from "pino";
import { REDACTED_PATHS, SENSITIVE_KEYS } from "../../src/utils/logger.js";

/**
 * Builds a logger with the production redaction configuration that writes to an
 * in-memory buffer, so we can inspect exactly what would have been written.
 */
function captureLogger() {
  const lines = [];
  const stream = {
    write(chunk) {
      lines.push(JSON.parse(chunk));
    },
  };
  const log = pino(
    { level: "info", redact: { paths: REDACTED_PATHS, censor: "[redacted]" } },
    stream,
  );
  return { log, lines };
}

describe("log redaction", () => {
  it("redacts credentials logged at the top level", () => {
    const { log, lines } = captureLogger();

    log.info(
      { password: "Correct-Horse-1", email: "shopper@example.test" },
      "login",
    );

    expect(lines[0].password).toBe("[redacted]");
    // Non-secret context is preserved — the logs still have to be useful.
    expect(lines[0].email).toBe("shopper@example.test");
  });

  it("redacts tokens and secrets one level deep", () => {
    const { log, lines } = captureLogger();

    log.info(
      {
        session: {
          refreshToken: "rt_should_never_appear",
          token: "at_should_never_appear",
        },
      },
      "session issued",
    );

    expect(lines[0].session.refreshToken).toBe("[redacted]");
    expect(lines[0].session.token).toBe("[redacted]");
  });

  it("redacts authorization and cookie request headers", () => {
    const { log, lines } = captureLogger();

    log.info(
      {
        req: {
          headers: {
            authorization: "Bearer secret-access-token",
            cookie: "sanchandana_refresh=secret-refresh-token",
            "user-agent": "Mozilla/5.0",
          },
        },
      },
      "request",
    );

    expect(lines[0].req.headers.authorization).toBe("[redacted]");
    expect(lines[0].req.headers.cookie).toBe("[redacted]");
    expect(lines[0].req.headers["user-agent"]).toBe("Mozilla/5.0");
  });

  it("never writes a secret value anywhere in the serialised line", () => {
    const { log, lines } = captureLogger();

    log.info(
      {
        body: { password: "plaintext-secret-value" },
        payment: { apiSecret: "plaintext-secret-value" },
        totpSecret: "plaintext-secret-value",
      },
      "sensitive payload",
    );

    expect(JSON.stringify(lines[0])).not.toContain("plaintext-secret-value");
  });

  it("redacts a secret nested several levels deep", () => {
    const { log, lines } = captureLogger();

    log.info(
      {
        order: { payment: { provider: { apiSecret: "nested-secret-value" } } },
      },
      "payment attempt",
    );

    expect(JSON.stringify(lines[0])).not.toContain("nested-secret-value");
  });

  it("generates a wildcard variant for every sensitive key", () => {
    // A regression guard: adding a name to SENSITIVE_KEYS must automatically
    // cover it at the top level and when nested.
    for (const key of SENSITIVE_KEYS) {
      expect(REDACTED_PATHS).toContain(key);
      expect(REDACTED_PATHS).toContain(`*.${key}`);
    }
  });
});
