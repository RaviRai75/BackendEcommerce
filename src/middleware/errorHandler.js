/**
 * The single place errors become HTTP responses.
 *
 * Rules (structure.md §53, security §26–27):
 *   - Deliberate `AppError`s return their own customer-safe message.
 *   - Everything else returns a generic message; the real error, including the
 *     stack, goes to the logs only.
 *   - Stack traces, database errors, file paths and environment values are
 *     never sent to a client.
 */
import { ZodError } from "zod";
import { AppError, isOperationalError } from "../utils/AppError.js";
import { ErrorCode, ErrorMessage, ErrorStatus } from "../utils/errorCodes.js";
import { sendError } from "../utils/response.js";
import { logger } from "../utils/logger.js";
import { isDevelopment } from "../config/env.js";

/**
 * Flattens a ZodError into `{ field: message }`, which the frontend renders
 * inline against the offending input.
 *
 * @param {ZodError} error
 * @returns {Record<string, string>}
 */
export function formatZodIssues(error) {
  const fields = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_root";
    // Keep the first message per field: that is what the form will show.
    if (!fields[path]) fields[path] = issue.message;
  }
  return fields;
}

/**
 * Translates known third-party error shapes into an AppError. Anything not
 * recognised here is treated as an unexpected failure.
 *
 * @param {unknown} error
 * @returns {AppError | null}
 */
function normalise(error) {
  if (isOperationalError(error)) return error;

  if (error instanceof ZodError) {
    return AppError.validation(formatZodIssues(error));
  }

  // body-parser: malformed JSON and oversized payloads.
  if (error?.type === "entity.parse.failed") {
    return new AppError(ErrorCode.MALFORMED_JSON);
  }
  if (error?.type === "entity.too.large") {
    return new AppError(ErrorCode.PAYLOAD_TOO_LARGE);
  }

  // Mongoose validation and cast failures. A CastError means the client sent an
  // id (or other typed value) that cannot exist, so it is a 404/422, not a 500.
  if (error?.name === "ValidationError" && error.errors) {
    const fields = {};
    for (const [field, detail] of Object.entries(error.errors)) {
      fields[field] = detail.message;
    }
    return AppError.validation(fields);
  }
  if (error?.name === "CastError") {
    return new AppError(ErrorCode.NOT_FOUND, {
      meta: { path: error.path, kind: error.kind },
    });
  }
  // Duplicate key. The message deliberately does not name the value, so this
  // cannot be used to enumerate existing accounts (security §28).
  if (error?.code === 11000) {
    return new AppError(ErrorCode.VALIDATION_ERROR, {
      message: "That value is already in use.",
      status: 409,
      meta: { keyPattern: error.keyPattern },
    });
  }

  return null;
}

/** Express error-handling middleware. Must be registered last. */
export function errorHandler(error, req, res, _next) {
  const appError = normalise(error);
  const requestId = req.id;

  if (appError) {
    const level = appError.status >= 500 ? "error" : "warn";
    logger[level](
      {
        requestId,
        code: appError.code,
        status: appError.status,
        path: req.path,
        method: req.method,
        userId: req.user?.id,
        meta: appError.meta,
        details: appError.details,
        err: appError.cause ?? undefined,
      },
      appError.message,
    );

    return sendError(res, {
      status: appError.status,
      code: appError.code,
      message: appError.message,
      details: appError.details,
      requestId,
    });
  }

  // Unexpected: log everything, reveal nothing.
  logger.error(
    {
      requestId,
      path: req.path,
      method: req.method,
      userId: req.user?.id,
      err: error,
    },
    "unhandled error",
  );

  return sendError(res, {
    status: ErrorStatus[ErrorCode.INTERNAL_ERROR],
    code: ErrorCode.INTERNAL_ERROR,
    // Only a developer on their own machine sees the real message. Test and
    // production both get the generic copy, so the test suite proves what a
    // customer would actually receive.
    message: isDevelopment
      ? `${ErrorMessage[ErrorCode.INTERNAL_ERROR]} (dev detail: ${error?.message ?? "unknown"})`
      : ErrorMessage[ErrorCode.INTERNAL_ERROR],
    requestId,
  });
}
