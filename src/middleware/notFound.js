/**
 * Terminal 404 handler for unmatched routes.
 *
 * Registered after every route but before the error handler, so an unknown path
 * produces the same failure envelope as any other error rather than Express's
 * default HTML page (which would leak the stack in development).
 */
import { AppError } from '../utils/AppError.js';
import { ErrorCode } from '../utils/errorCodes.js';

export function notFound(req, _res, next) {
  next(
    new AppError(ErrorCode.NOT_FOUND, {
      message: 'This endpoint does not exist.',
      meta: { method: req.method, path: req.originalUrl },
    }),
  );
}
