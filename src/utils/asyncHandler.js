/**
 * Wraps an async route handler so a rejected promise is forwarded to Express's
 * error pipeline instead of becoming an unhandled rejection.
 *
 * Express 4 does not await handlers, so without this every `await` in a
 * controller needs its own try/catch. Controllers stay thin (architecture §4)
 * by relying on this wrapper plus the central error handler.
 *
 * @template {import('express').RequestHandler} T
 * @param {T} handler
 * @returns {import('express').RequestHandler}
 */
export function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
