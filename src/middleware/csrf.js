/**
 * CSRF protection for the cookie-authenticated endpoints (security §13).
 *
 * Only two endpoints need this: refresh and logout. Everything else authenticates
 * with an `Authorization` header, which a cross-site form post cannot set, so
 * those are not CSRF-able in the first place. Being precise about that is the
 * point — blanket CSRF middleware on a header-authenticated API adds ceremony
 * without adding safety.
 *
 * Two independent checks, because neither is sufficient alone:
 *
 *   1. Double-submit token. The client reads the non-HttpOnly CSRF cookie and
 *      echoes it in a header. An attacker's page can cause the cookie to be *sent*
 *      but cannot *read* it, so it cannot produce the matching header.
 *   2. Origin check. The browser sets `Origin` on cross-site requests and it
 *      cannot be forged by page JavaScript, so an unexpected origin is refused
 *      outright.
 */
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../config/cookies.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { ErrorCode } from '../utils/errorCodes.js';
import { createLogger } from '../utils/logger.js';
import { safeCompare } from '../modules/auth/token.service.js';

const log = createLogger('csrf');

/**
 * Verifies the request carries a matching CSRF token and an acceptable origin.
 *
 * @type {import('express').RequestHandler}
 */
export function requireCsrfToken(req, _res, next) {
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.get(CSRF_HEADER_NAME);

  // --- Origin / Referer -----------------------------------------------------
  const origin = req.get('origin');
  const referer = req.get('referer');

  if (origin) {
    if (!env.CORS_ALLOWED_ORIGINS.includes(origin)) {
      log.warn({ requestId: req.id, origin }, 'CSRF check failed: unexpected origin');
      next(new AppError(ErrorCode.CSRF_FAILED, { meta: { reason: 'origin' } }));
      return;
    }
  } else if (referer) {
    // Some browsers omit Origin on same-origin requests but send Referer.
    const refererOrigin = (() => {
      try {
        return new URL(referer).origin;
      } catch {
        return null;
      }
    })();

    if (refererOrigin && !env.CORS_ALLOWED_ORIGINS.includes(refererOrigin)) {
      log.warn(
        { requestId: req.id, refererOrigin },
        'CSRF check failed: unexpected referer',
      );
      next(new AppError(ErrorCode.CSRF_FAILED, { meta: { reason: 'referer' } }));
      return;
    }
  }
  // Neither header present: a non-browser client (curl, a mobile app, a test).
  // Those cannot be victims of CSRF — there is no ambient session to ride — so
  // the double-submit check below is what protects the endpoint.

  // --- Double-submit token --------------------------------------------------
  if (cookieToken) {
    if (!headerToken || !safeCompare(cookieToken, headerToken)) {
      log.warn({ requestId: req.id }, 'CSRF check failed: token mismatch');
      next(new AppError(ErrorCode.CSRF_FAILED, { meta: { reason: 'mismatch' } }));
      return;
    }
  } else {
    const isAllowedOrigin = origin && env.CORS_ALLOWED_ORIGINS.includes(origin);
    if (!isAllowedOrigin || !headerToken) {
      log.warn(
        { requestId: req.id, hasCookie: Boolean(cookieToken), hasHeader: Boolean(headerToken) },
        'CSRF check failed: token missing',
      );
      next(new AppError(ErrorCode.CSRF_FAILED, { meta: { reason: 'missing' } }));
      return;
    }
  }

  next();
}
