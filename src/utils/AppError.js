/**
 * The single error type the application throws deliberately.
 *
 * Anything thrown as an `AppError` is considered *expected* — a business rule
 * was violated, or the client sent something we refuse. Its message is safe to
 * show a customer. Everything else that reaches the error handler is treated as
 * an unexpected failure and reported to the customer as a generic message
 * (security §27), with the real detail written only to the logs.
 */
import { ErrorCode, ErrorMessage, ErrorStatus } from './errorCodes.js';

export class AppError extends Error {
  /**
   * @param {string} code one of {@link ErrorCode}
   * @param {object} [options]
   * @param {string} [options.message] override the default customer-safe copy
   * @param {number} [options.status] override the default HTTP status
   * @param {object} [options.details] field-level detail, safe to expose
   * @param {object} [options.meta] internal context — logged, never sent
   * @param {Error}  [options.cause] the underlying error, logged only
   */
  constructor(code, options = {}) {
    const message = options.message ?? ErrorMessage[code] ?? ErrorMessage[ErrorCode.INTERNAL_ERROR];
    super(message);

    this.name = 'AppError';
    this.code = ErrorCode[code] ? code : ErrorCode.INTERNAL_ERROR;
    this.status = options.status ?? ErrorStatus[this.code] ?? 500;
    /** Marks the error as safe to surface to the client. */
    this.isOperational = true;
    if (options.details) this.details = options.details;
    if (options.meta) this.meta = options.meta;
    if (options.cause) this.cause = options.cause;

    Error.captureStackTrace?.(this, AppError);
  }

  // --- Convenience constructors for the most common cases ------------------

  static notFound(what = 'Resource', options = {}) {
    return new AppError(ErrorCode.NOT_FOUND, {
      message: `${what} not found.`,
      ...options,
    });
  }

  static validation(details, options = {}) {
    return new AppError(ErrorCode.VALIDATION_ERROR, { details, ...options });
  }

  static unauthenticated(options = {}) {
    return new AppError(ErrorCode.UNAUTHENTICATED, options);
  }

  static forbidden(options = {}) {
    return new AppError(ErrorCode.FORBIDDEN, options);
  }

  static internal(options = {}) {
    return new AppError(ErrorCode.INTERNAL_ERROR, options);
  }
}

/**
 * True when the error was raised deliberately by application code and its
 * message is safe to return to the client.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isOperationalError(error) {
  return Boolean(error && typeof error === 'object' && error.isOperational === true);
}
