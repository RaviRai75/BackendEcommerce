/**
 * CORS policy.
 *
 * structure.md security §10: never `Access-Control-Allow-Origin: *` for an
 * authenticated API. Only the origins listed in `CORS_ALLOWED_ORIGINS` are
 * accepted, and credentials are enabled so the refresh cookie can travel.
 */
import { env, isProduction } from './env.js';
import { AppError } from '../utils/AppError.js';
import { ErrorCode } from '../utils/errorCodes.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('cors');

/** Headers the browser is allowed to send. */
const ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-CSRF-Token',
  'X-Requested-With',
  'Idempotency-Key',
];

/** Headers the browser is allowed to read. */
const EXPOSED_HEADERS = ['X-Request-Id', 'Retry-After'];

export const corsOptions = {
  origin(origin, callback) {
    // Same-origin and non-browser callers (server-to-server, curl, health
    // probes, webhooks) send no Origin header. Those are not CORS requests, so
    // there is nothing to allow or deny here — authorization still applies.
    if (!origin) return callback(null, true);

    if (env.CORS_ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }

    log.warn({ origin }, 'blocked cross-origin request from unlisted origin');
    return callback(
      new AppError(ErrorCode.ORIGIN_NOT_ALLOWED, {
        meta: { origin },
      }),
    );
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ALLOWED_HEADERS,
  exposedHeaders: EXPOSED_HEADERS,
  maxAge: isProduction ? 86400 : 0,
  optionsSuccessStatus: 204,
};

export { ALLOWED_HEADERS, EXPOSED_HEADERS };
