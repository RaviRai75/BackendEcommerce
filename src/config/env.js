/**
 * Environment configuration.
 *
 * Every variable the application depends on is declared and validated here, at
 * boot, with Zod. If a required variable is missing or malformed the process
 * refuses to start rather than failing later at an unpredictable point.
 *
 * Security note (structure.md security §30, §32): this module is the ONLY place
 * that reads `process.env`. Nothing here is ever serialised into an API
 * response, and secret values are never logged.
 */
import { createHash } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

if (process.env.NODE_ENV !== "test") {
  loadDotenv();
}

/** Comma-separated list -> trimmed, de-duplicated array. */
const csvList = z.string().transform((value) =>
  Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ),
);

const booleanish = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const positiveInt = (fallback) =>
  z.coerce.number().int().positive().default(fallback);

const publicOrigin = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      (url.pathname === "/" || url.pathname === "") &&
      !url.search &&
      !url.hash
    );
  }, "must be an HTTP(S) origin without credentials, path, query, or fragment")
  .transform((value) => new URL(value).origin);

/**
 * A secret must be long enough to be meaningful. 32 characters is the minimum
 * we accept for anything used to sign or encrypt.
 */
const secret = z
  .string()
  .min(
    32,
    "must be at least 32 characters — generate one with `openssl rand -hex 32`",
  );

const notificationEncryptionKey = z
  .string()
  .regex(/^[a-fA-F0-9]{64}$/, "must be exactly 64 hexadecimal characters");

const notificationEncryptionKeyId = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/,
    "must use 1-80 letters, numbers, dots, underscores, or hyphens",
  );

const optionalNotificationEncryptionKey = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  notificationEncryptionKey.optional(),
);

const optionalNotificationEncryptionKeyId = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  notificationEncryptionKeyId.optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: positiveInt(5000),
    API_PREFIX: z.string().startsWith("/").default("/api"),

    // --- Database -----------------------------------------------------------
    MONGODB_URI: z.string().min(1, "MongoDB connection string is required"),
    MONGODB_DB_NAME: z.string().min(1).default("sanchandana"),

    // --- Authentication -----------------------------------------------------
    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: secret,
    ACCESS_TOKEN_TTL_MINUTES: positiveInt(15),
    ADMIN_ACCESS_TOKEN_TTL_MINUTES: positiveInt(10),
    REFRESH_TOKEN_TTL_DAYS: positiveInt(7),
    PASSWORD_RESET_TTL_MINUTES: positiveInt(30),

    // --- Client / CORS ------------------------------------------------------
    /** Exact origins allowed to call the API. Never `*` (security §10). */
    CORS_ALLOWED_ORIGINS: csvList.default("http://localhost:5173"),
    /** Public storefront origin used for canonical customer-facing links. */
    STOREFRONT_URL: publicOrigin.default("http://localhost:5173"),

    // --- Email and notification dispatch ------------------------------------
    EMAIL_PROVIDER: z.enum(["console", "none", "smtp"]).default("console"),
    EMAIL_FROM: z
      .string()
      .min(3)
      .default("Sanchandana <no-reply@sanchandana.local>"),
    SMTP_HOST: z.string().trim().min(1).optional(),
    SMTP_PORT: positiveInt(587),
    SMTP_SECURE: booleanish.default("false"),
    SMTP_USER: z.string().trim().min(1).optional(),
    SMTP_APP_PASSWORD: z.string().min(8).optional(),
    NOTIFICATION_ENCRYPTION_KEY: optionalNotificationEncryptionKey,
    NOTIFICATION_ENCRYPTION_KEY_ID: optionalNotificationEncryptionKeyId,
    NOTIFICATION_PREVIOUS_ENCRYPTION_KEY_ID_1:
      optionalNotificationEncryptionKeyId,
    NOTIFICATION_PREVIOUS_ENCRYPTION_KEY_1: optionalNotificationEncryptionKey,
    NOTIFICATION_PREVIOUS_ENCRYPTION_KEY_ID_2:
      optionalNotificationEncryptionKeyId,
    NOTIFICATION_PREVIOUS_ENCRYPTION_KEY_2: optionalNotificationEncryptionKey,
    NOTIFICATION_PREVIOUS_ENCRYPTION_KEY_ID_3:
      optionalNotificationEncryptionKeyId,
    NOTIFICATION_PREVIOUS_ENCRYPTION_KEY_3: optionalNotificationEncryptionKey,
    NOTIFICATION_PREVIOUS_ENCRYPTION_KEY_ID_4:
      optionalNotificationEncryptionKeyId,
    NOTIFICATION_PREVIOUS_ENCRYPTION_KEY_4: optionalNotificationEncryptionKey,
    NOTIFICATION_DISPATCH_BATCH_SIZE: positiveInt(100),
    NOTIFICATION_LEASE_SECONDS: positiveInt(120),

    // --- Payments -----------------------------------------------------------
    /**
     * MockPrepaid is selected by default only outside production. Production
     * defaults to DISABLED and explicitly refuses the mock adapter.
     */
    PREPAID_PROVIDER: z
      .enum(["DISABLED", "MOCK_PREPAID", "PHONEPE"])
      .optional(),
    MOCK_PREPAID_SECRET: secret.optional(),
    PAYMENT_ATTEMPT_TTL_MINUTES: positiveInt(30),
    PAYMENT_WEBHOOK_TOLERANCE_SECONDS: positiveInt(300),

    // --- Logging ------------------------------------------------------------
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    LOG_PRETTY: booleanish.default("false"),

    // --- Rate limiting ------------------------------------------------------
    RATE_LIMIT_WINDOW_MINUTES: positiveInt(15),
    RATE_LIMIT_MAX_REQUESTS: positiveInt(600),

    // --- Shipping -----------------------------------------------------------
    SHIPPING_ALLOWED_STATES: csvList
      .default("Karnataka")
      .refine((states) => states.length > 0, {
        message: "configure at least one delivery state",
      })
      .refine((states) => states.every((state) => state.length <= 80), {
        message: "state names must be 80 characters or fewer",
      })
      .transform((states) => Object.freeze([...states])),

    // --- Media --------------------------------------------------------------
    CLOUDINARY_CLOUD_NAME: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]+$/, "must be a valid Cloudinary cloud name")
      .default("demo"),
    CLOUDINARY_API_KEY: z.string().trim().min(1).optional(),
    CLOUDINARY_API_SECRET: z.string().trim().min(1).optional(),
    CLOUDINARY_IMAGE_UPLOAD_PRESET: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]+$/, "must be a valid Cloudinary preset name")
      .optional(),
    CLOUDINARY_VIDEO_UPLOAD_PRESET: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]+$/, "must be a valid Cloudinary preset name")
      .optional(),

    // --- Request limits -----------------------------------------------------
    JSON_BODY_LIMIT_KB: positiveInt(64),
    UPLOAD_MAX_SIZE_MB: positiveInt(5),
    UPLOAD_VIDEO_MAX_SIZE_MB: positiveInt(50),
  })
  /**
   * Production-only invariants. These are deliberately checked at boot so a
   * misconfigured deployment fails loudly instead of running insecurely.
   */
  .superRefine((value, ctx) => {
    if (value.EMAIL_PROVIDER === "smtp") {
      for (const [field, configured] of [
        ["SMTP_HOST", value.SMTP_HOST],
        ["SMTP_USER", value.SMTP_USER],
        ["SMTP_APP_PASSWORD", value.SMTP_APP_PASSWORD],
      ]) {
        if (!configured) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `configure ${field} when EMAIL_PROVIDER=smtp`,
          });
        }
      }
    }

    for (let index = 1; index <= 4; index += 1) {
      const idField = `NOTIFICATION_PREVIOUS_ENCRYPTION_KEY_ID_${index}`;
      const keyField = `NOTIFICATION_PREVIOUS_ENCRYPTION_KEY_${index}`;
      if (Boolean(value[idField]) !== Boolean(value[keyField])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [value[idField] ? keyField : idField],
          message: `configure ${idField} and ${keyField} together`,
        });
      }
    }

    if (value.NODE_ENV !== "production") return;

    if (value.CORS_ALLOWED_ORIGINS.some((origin) => origin === "*")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CORS_ALLOWED_ORIGINS"],
        message: "wildcard origins are not permitted in production",
      });
    }

    const insecureOrigin = value.CORS_ALLOWED_ORIGINS.find(
      (origin) => !origin.startsWith("https://"),
    );
    if (insecureOrigin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CORS_ALLOWED_ORIGINS"],
        message: `production origins must use HTTPS (received "${insecureOrigin}")`,
      });
    }

    if (!value.STOREFRONT_URL.startsWith("https://")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STOREFRONT_URL"],
        message: "production storefront origin must use HTTPS",
      });
    }

    if (value.CLOUDINARY_CLOUD_NAME === "demo") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CLOUDINARY_CLOUD_NAME"],
        message: "configure the production Cloudinary cloud name",
      });
    }

    if (!value.CLOUDINARY_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CLOUDINARY_API_KEY"],
        message: "configure the production Cloudinary API key",
      });
    }

    if (!value.CLOUDINARY_API_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CLOUDINARY_API_SECRET"],
        message: "configure the production Cloudinary API secret",
      });
    }

    if (!value.CLOUDINARY_IMAGE_UPLOAD_PRESET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CLOUDINARY_IMAGE_UPLOAD_PRESET"],
        message: "configure the signed product image upload preset",
      });
    }

    if (!value.CLOUDINARY_VIDEO_UPLOAD_PRESET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CLOUDINARY_VIDEO_UPLOAD_PRESET"],
        message: "configure the signed product video upload preset",
      });
    }

    if (value.EMAIL_PROVIDER !== "smtp") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EMAIL_PROVIDER"],
        message: "production requires the SMTP email provider",
      });
    }

    if (!value.NOTIFICATION_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NOTIFICATION_ENCRYPTION_KEY"],
        message:
          "production requires an explicit 32-byte notification encryption key",
      });
    }

    if (!value.NOTIFICATION_ENCRYPTION_KEY_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NOTIFICATION_ENCRYPTION_KEY_ID"],
        message: "production requires a notification encryption key ID",
      });
    }

    if (value.PREPAID_PROVIDER === "MOCK_PREPAID") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PREPAID_PROVIDER"],
        message: "the MockPrepaid adapter must not be used in production",
      });
    }

    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_REFRESH_SECRET"],
        message: "access and refresh secrets must differ",
      });
    }
  });

/**
 * Parses and validates the given source (defaults to `process.env`).
 * Exported separately so tests can assert boot-time validation without
 * mutating the real environment.
 *
 * @param {Record<string, string | undefined>} [source]
 * @returns {Readonly<object>} frozen, validated configuration
 * @throws {Error} with a human-readable list of every invalid variable
 */
export function parseEnv(source = process.env) {
  const normalizedSource = { ...source };
  if (source.NODE_ENV === "production" && !source.STOREFRONT_URL?.trim()) {
    const configuredOrigins = String(source.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (configuredOrigins.length === 1) {
      try {
        const candidate = new URL(configuredOrigins[0]);
        if (["http:", "https:"].includes(candidate.protocol)) {
          normalizedSource.STOREFRONT_URL = configuredOrigins[0];
        }
      } catch {
        // Leave invalid CORS input to its dedicated production invariant.
      }
    }
  }

  const result = envSchema.safeParse(normalizedSource);

  if (!result.success) {
    const details = result.error.issues
      .map(
        (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      )
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const provider =
    result.data.PREPAID_PROVIDER ??
    (result.data.NODE_ENV === "production" ? "DISABLED" : "MOCK_PREPAID");
  const mockSecret = result.data.MOCK_PREPAID_SECRET;
  const notificationEncryptionKey =
    result.data.NOTIFICATION_ENCRYPTION_KEY?.toLowerCase() ??
    createHash("sha256")
      .update(`${result.data.JWT_ACCESS_SECRET}:notification-envelope:v1`)
      .digest("hex");
  const notificationEncryptionKeyId =
    result.data.NOTIFICATION_ENCRYPTION_KEY_ID ?? "nonproduction-derived-v1";
  const previousNotificationEncryptionKeys = Object.create(null);
  const previousKeyMaterial = new Set();
  for (let index = 1; index <= 4; index += 1) {
    const id = result.data[`NOTIFICATION_PREVIOUS_ENCRYPTION_KEY_ID_${index}`];
    const configuredKey =
      result.data[`NOTIFICATION_PREVIOUS_ENCRYPTION_KEY_${index}`];
    if (!id || !configuredKey) continue;
    const key = configuredKey.toLowerCase();

    if (id === notificationEncryptionKeyId) {
      throw new Error(
        `Invalid environment configuration:\n  - NOTIFICATION_PREVIOUS_ENCRYPTION_KEY_ID_${index}: must not repeat the active notification key ID`,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(
        previousNotificationEncryptionKeys,
        id,
      )
    ) {
      throw new Error(
        `Invalid environment configuration:\n  - NOTIFICATION_PREVIOUS_ENCRYPTION_KEY_ID_${index}: previous notification key IDs must be distinct`,
      );
    }
    if (key === notificationEncryptionKey || previousKeyMaterial.has(key)) {
      throw new Error(
        `Invalid environment configuration:\n  - NOTIFICATION_PREVIOUS_ENCRYPTION_KEY_${index}: notification key material must be distinct`,
      );
    }

    previousNotificationEncryptionKeys[id] = key;
    previousKeyMaterial.add(key);
  }
  Object.freeze(previousNotificationEncryptionKeys);

  return Object.freeze({
    ...result.data,
    PREPAID_PROVIDER: provider,
    MOCK_PREPAID_SECRET: mockSecret,
    NOTIFICATION_ENCRYPTION_KEY: notificationEncryptionKey,
    NOTIFICATION_ENCRYPTION_KEY_ID: notificationEncryptionKeyId,
    NOTIFICATION_PREVIOUS_ENCRYPTION_KEYS: previousNotificationEncryptionKeys,
  });
}

export const env = parseEnv();

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
export const isDevelopment = env.NODE_ENV === "development";
