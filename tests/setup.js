/**
 * Global test setup.
 *
 * Runs before the test module graph is imported, which matters: `src/config/env.js`
 * validates configuration at import time, so the environment has to be complete
 * before any source module loads.
 *
 * These values are test fixtures. They are not used by any real environment.
 */
process.env.NODE_ENV = "test";
process.env.PORT = "5001";
process.env.API_PREFIX = "/api";

process.env.MONGODB_URI = "mongodb://127.0.0.1:27017";
process.env.MONGODB_DB_NAME = "sanchandana_test";

process.env.JWT_ACCESS_SECRET = "test-access-secret-that-is-long-enough-000000";
process.env.JWT_REFRESH_SECRET =
  "test-refresh-secret-that-is-long-enough-11111";

process.env.CORS_ALLOWED_ORIGINS = "http://localhost:5173";
process.env.STOREFRONT_URL = "http://localhost:5173";

process.env.CLOUDINARY_CLOUD_NAME = "demo";
process.env.CLOUDINARY_API_KEY = "test-cloudinary-key";
process.env.CLOUDINARY_API_SECRET = "test-cloudinary-secret";
process.env.CLOUDINARY_IMAGE_UPLOAD_PRESET = "test-products-images";
process.env.CLOUDINARY_VIDEO_UPLOAD_PRESET = "test-products-videos";

process.env.GEMINI_API_KEY = "test-gemini-api-key";

process.env.PREPAID_PROVIDER = "MOCK_PREPAID";
process.env.MOCK_PREPAID_SECRET =
  "test-mock-prepaid-secret-that-is-long-enough";

// Keep the test output readable: only failures should print.
process.env.LOG_LEVEL = "silent";
process.env.LOG_PRETTY = "false";

// Generous global limit so ordinary integration tests never trip it; the
// dedicated rate-limit tests use the strict per-endpoint limiters instead.
process.env.RATE_LIMIT_WINDOW_MINUTES = "15";
process.env.RATE_LIMIT_MAX_REQUESTS = "5000";
