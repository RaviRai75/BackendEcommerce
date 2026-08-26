/**
 * Boot-time configuration validation.
 *
 * The point of these tests is that a misconfigured deployment must fail
 * immediately and loudly rather than start up in an insecure state.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { env, parseEnv } from "../../src/config/env.js";

/** A minimal environment that should validate cleanly. */
const validEnv = {
  NODE_ENV: "development",
  MONGODB_URI: "mongodb://127.0.0.1:27017",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
};

describe("test environment isolation", () => {
  it("uses the fixed local MongoDB URI in the singleton configuration", () => {
    expect(env.MONGODB_URI).toBe("mongodb://127.0.0.1:27017");
  });

  it("does not load a dotenv file when NODE_ENV is test", () => {
    const directory = mkdtempSync(join(tmpdir(), "sanchandana-env-test-"));

    try {
      writeFileSync(
        join(directory, ".env"),
        [
          "MONGODB_URI=mongodb://dotenv-sentinel.invalid:27017/sentinel",
          `JWT_ACCESS_SECRET=${"c".repeat(32)}`,
          `JWT_REFRESH_SECRET=${"d".repeat(32)}`,
        ].join("\n"),
      );

      const moduleUrl = new URL("../../src/config/env.js", import.meta.url)
        .href;
      const script = `
        try {
          await import(process.env.ENV_MODULE_URL);
          process.exitCode = 1;
        } catch (error) {
          if (!String(error?.message).includes("MONGODB_URI")) {
            process.exitCode = 1;
          }
        }
      `;
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "--eval", script],
        {
          cwd: directory,
          env: {
            NODE_ENV: "test",
            ENV_MODULE_URL: moduleUrl,
          },
          encoding: "utf8",
        },
      );

      expect(result.status, result.stderr).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("parseEnv", () => {
  it("accepts a minimal valid environment and applies defaults", () => {
    const parsed = parseEnv(validEnv);

    expect(parsed.PORT).toBe(5000);
    expect(parsed.API_PREFIX).toBe("/api");
    expect(parsed.ACCESS_TOKEN_TTL_MINUTES).toBe(15);
    expect(parsed.REFRESH_TOKEN_TTL_DAYS).toBe(7);
    expect(parsed.CORS_ALLOWED_ORIGINS).toEqual(["http://localhost:5173"]);
    expect(parsed.SHIPPING_ALLOWED_STATES).toEqual(["Karnataka"]);
    expect(Object.isFrozen(parsed.SHIPPING_ALLOWED_STATES)).toBe(true);
    expect(parsed.CLOUDINARY_CLOUD_NAME).toBe("demo");
  });

  it("validates and freezes configured shipping states", () => {
    const parsed = parseEnv({
      ...validEnv,
      SHIPPING_ALLOWED_STATES: " Karnataka, Tamil Nadu, Karnataka ",
    });

    expect(parsed.SHIPPING_ALLOWED_STATES).toEqual(["Karnataka", "Tamil Nadu"]);
    expect(() => parsed.SHIPPING_ALLOWED_STATES.push("Kerala")).toThrow();
    expect(() =>
      parseEnv({ ...validEnv, SHIPPING_ALLOWED_STATES: " , " }),
    ).toThrow(/at least one delivery state/);
  });

  it("refuses to boot when the database connection string is missing", () => {
    const { MONGODB_URI, ...withoutDatabase } = validEnv;

    expect(() => parseEnv(withoutDatabase)).toThrow(/MONGODB_URI/);
  });

  it("refuses to boot when a signing secret is missing", () => {
    const { JWT_ACCESS_SECRET, ...withoutSecret } = validEnv;

    expect(() => parseEnv(withoutSecret)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it("rejects a signing secret that is too short to be meaningful", () => {
    expect(() => parseEnv({ ...validEnv, JWT_ACCESS_SECRET: "short" })).toThrow(
      /at least 32 characters/,
    );
  });

  it("reports every invalid variable at once rather than one at a time", () => {
    let message = "";
    try {
      parseEnv({ NODE_ENV: "development" });
    } catch (error) {
      message = error.message;
    }

    expect(message).toContain("MONGODB_URI");
    expect(message).toContain("JWT_ACCESS_SECRET");
    expect(message).toContain("JWT_REFRESH_SECRET");
  });

  it("parses a comma-separated origin list into unique trimmed entries", () => {
    const parsed = parseEnv({
      ...validEnv,
      CORS_ALLOWED_ORIGINS: "http://a.test, http://b.test ,http://a.test",
    });

    expect(parsed.CORS_ALLOWED_ORIGINS).toEqual([
      "http://a.test",
      "http://b.test",
    ]);
  });

  describe("production invariants", () => {
    const productionEnv = {
      ...validEnv,
      NODE_ENV: "production",
      CORS_ALLOWED_ORIGINS: "https://sanchandana.test",
      // Production notification delivery requires SMTP and explicit encryption.
      EMAIL_PROVIDER: "smtp",
      EMAIL_FROM: "Sanchandana <no-reply@example.test>",
      SMTP_HOST: "smtp.example.test",
      SMTP_USER: "test-smtp-user",
      SMTP_APP_PASSWORD: "test-smtp-app-password",
      NOTIFICATION_ENCRYPTION_KEY: "e".repeat(64),
      NOTIFICATION_ENCRYPTION_KEY_ID: "notification-key-v1",
      CLOUDINARY_CLOUD_NAME: "sanchandana",
      CLOUDINARY_API_KEY: "production-cloudinary-key",
      CLOUDINARY_API_SECRET: "production-cloudinary-secret",
      CLOUDINARY_IMAGE_UPLOAD_PRESET: "production-product-images",
      CLOUDINARY_VIDEO_UPLOAD_PRESET: "production-product-videos",
    };

    it("accepts a correctly configured production environment", () => {
      expect(() => parseEnv(productionEnv)).not.toThrow();
    });

    it("requires both signed upload presets without exposing secret values", () => {
      const {
        CLOUDINARY_IMAGE_UPLOAD_PRESET,
        CLOUDINARY_VIDEO_UPLOAD_PRESET,
        ...withoutPresets
      } = productionEnv;
      let message = "";
      try {
        parseEnv(withoutPresets);
      } catch (error) {
        message = error.message;
      }
      expect(message).toContain("CLOUDINARY_IMAGE_UPLOAD_PRESET");
      expect(message).toContain("CLOUDINARY_VIDEO_UPLOAD_PRESET");
      expect(message).not.toContain(productionEnv.CLOUDINARY_API_SECRET);
    });

    it("refuses the console email adapter in production", () => {
      // It would put a working password reset link in the application log,
      // which security §1 and §26 both forbid.
      expect(() =>
        parseEnv({ ...productionEnv, EMAIL_PROVIDER: "console" }),
      ).toThrow(/SMTP email provider/i);
    });

    it("rejects a wildcard CORS origin in production", () => {
      expect(() =>
        parseEnv({ ...productionEnv, CORS_ALLOWED_ORIGINS: "*" }),
      ).toThrow(/wildcard origins are not permitted/);
    });

    it("rejects a non-HTTPS origin in production", () => {
      expect(() =>
        parseEnv({
          ...productionEnv,
          CORS_ALLOWED_ORIGINS: "http://sanchandana.test",
        }),
      ).toThrow(/must use HTTPS/);
    });

    it("rejects reusing one secret for both access and refresh tokens", () => {
      const shared = "c".repeat(32);
      expect(() =>
        parseEnv({
          ...productionEnv,
          JWT_ACCESS_SECRET: shared,
          JWT_REFRESH_SECRET: shared,
        }),
      ).toThrow(/must differ/);
    });
  });
});
