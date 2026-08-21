/**
 * Boot-time configuration validation.
 *
 * The point of these tests is that a misconfigured deployment must fail
 * immediately and loudly rather than start up in an insecure state.
 */
import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env.js";

/** A minimal environment that should validate cleanly. */
const validEnv = {
  NODE_ENV: "development",
  MONGODB_URI: "mongodb://127.0.0.1:27017",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
};

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
      // The console email adapter writes message bodies — including a working
      // password reset link — to the log, so production needs a real provider.
      EMAIL_PROVIDER: "none",
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
      ).toThrow(/console email adapter/i);
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
