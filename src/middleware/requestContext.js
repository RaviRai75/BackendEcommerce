/**
 * Request correlation and HTTP access logging.
 *
 * Every request is tagged with an id that appears in the logs and, on failure,
 * in the error envelope. That lets the business quote a request id from a
 * customer-facing error and find the exact log line, without ever exposing
 * internals in the response (security §27).
 */
import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';
import { logger } from '../utils/logger.js';
import { isProduction } from '../config/env.js';

/** Attaches a request id to `req.id` and echoes it in `X-Request-Id`. */
export function requestId(req, res, next) {
  const incoming = req.get('X-Request-Id');
  // Only trust an inbound id if it looks like an id — never reflect arbitrary
  // client input into a response header.
  req.id = /^[\w-]{8,64}$/.test(incoming ?? '') ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

/**
 * HTTP access log. Health checks are logged at `debug` so uptime probes do not
 * drown the log; genuine errors are logged at `error`.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.id,
  autoLogging: {
    ignore: (req) => req.url === '/api/health' && isProduction,
  },
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  // Keep records small and free of headers we do not need. The logger's
  // redaction list still applies on top of this.
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
});
