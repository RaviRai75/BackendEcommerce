/**
 * Structured application logging.
 *
 * structure.md security §26 forbids secrets and personal data from reaching the
 * logs. Redaction is therefore configured centrally here rather than trusted to
 * each call site: any of the listed paths is replaced with `[redacted]` no
 * matter which module logs it.
 */
import pino from "pino";
import { env, isProduction } from "../config/env.js";

/**
 * Field names that must never appear in a log line, wherever they occur.
 *
 * Adding a name here is enough: the path list below is generated from it for
 * every nesting level we realistically log, so a new secret cannot be missed
 * because someone forgot one of the wildcard variants.
 */
const SENSITIVE_KEYS = [
  // Credentials
  "password",
  "passwordConfirm",
  "currentPassword",
  "newPassword",
  "passwordHash",
  // Tokens and session material
  "token",
  "accessToken",
  "refreshToken",
  "resetToken",
  "checkoutToken",
  "mockPrepaidSecret",
  "csrfToken",
  "totpSecret",
  "authorization",
  "cookie",
  // Provider credentials
  "apiKey",
  "apiSecret",
  "secret",
  "clientSecret",
  "webhookSecret",
  "signature",
  "saltKey",
  // Payment instrument data, which we never store but must never log either
  "cardNumber",
  "cvv",
  "upiPin",
  "pin",
];

/** How deep the generated wildcard paths reach. */
const WILDCARD_DEPTH = 3;

/**
 * Builds the redaction path list: the bare key, plus `*.key`, `*.*.key` …, plus
 * the specific header paths pino-http produces.
 *
 * @returns {string[]}
 */
function buildRedactionPaths() {
  const paths = new Set();

  for (const key of SENSITIVE_KEYS) {
    paths.add(key);
    for (let depth = 1; depth <= WILDCARD_DEPTH; depth += 1) {
      paths.add(`${"*.".repeat(depth)}${key}`);
    }
  }

  // Headers with characters that need bracket notation.
  paths.add('req.headers["x-csrf-token"]');
  paths.add('req.headers["x-webhook-signature"]');
  paths.add('req.headers["x-mock-signature"]');
  paths.add('res.headers["set-cookie"]');

  return Array.from(paths);
}

const REDACTED_PATHS = buildRedactionPaths();

const transport =
  env.LOG_PRETTY && !isProduction
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname",
          singleLine: false,
        },
      }
    : undefined;

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "sanchandana-api", env: env.NODE_ENV },
  redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
  formatters: {
    level: (label) => ({ level: label }),
  },
  transport,
});

/**
 * Creates a child logger bound to a module name, so log lines can be traced
 * back to the module that produced them.
 *
 * @param {string} moduleName
 * @returns {import('pino').Logger}
 */
export function createLogger(moduleName) {
  return logger.child({ module: moduleName });
}

export { REDACTED_PATHS, SENSITIVE_KEYS };
