/**
 * Authentication and role authorisation middleware.
 *
 * The security boundary. structure.md security §7 and §40 are explicit that the
 * backend decides who a caller is and what they may do — hiding a button in React
 * or omitting a route from the client router is a usability choice, never a
 * control.
 *
 * `requireAuth` deliberately reads the account from the database on every
 * authenticated request rather than trusting the token alone. §2 requires the role
 * to come from trusted server-side state, and the same lookup gives immediate
 * effect to a suspension, a password change and a "sign out everywhere" — none of
 * which a self-contained token could reflect until it expired.
 */
import { isValidObjectId } from "mongoose";
import { AppError } from "../utils/AppError.js";
import { ErrorCode } from "../utils/errorCodes.js";
import { createLogger } from "../utils/logger.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User, UserRole } from "../modules/users/user.model.js";
import { Session } from "../modules/auth/session.model.js";
import { verifyAccessToken } from "../modules/auth/token.service.js";
import { auditService } from "../modules/system/audit.service.js";
import {
  AuditAction,
  AuditTargetType,
} from "../modules/system/auditLog.model.js";

const log = createLogger("auth-middleware");
const OPTIONAL_AUTH_FAILURES = new Set([
  ErrorCode.UNAUTHENTICATED,
  ErrorCode.SESSION_EXPIRED,
]);

/**
 * Extracts a bearer token from the Authorization header.
 *
 * Header only — never a query parameter or a cookie. A token in a URL ends up in
 * server logs, browser history and referrer headers (§26).
 *
 * @param {import('express').Request} req
 * @returns {string | null}
 */
function bearerToken(req) {
  const header = req.get("authorization");
  if (!header) return null;

  // Exactly one scheme and one credential. Accepting trailing words makes
  // malformed/proxy-corrupted credentials ambiguous.
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Verifies the token and loads the account it belongs to.
 *
 * @param {string} token
 * @returns {Promise<{ user: import('mongoose').Document, sessionId: string }>}
 * @throws {AppError}
 */
async function resolveAuthenticatedUser(token) {
  const claims = verifyAccessToken(token);

  const user = await User.findById(claims.userId).select(
    "email name phone role isActive tokenVersion emailVerifiedAt marketingConsent totpEnabledAt createdAt",
  );

  if (!user) {
    // The token is well formed but the account is gone. Treated as an expired
    // session rather than a server error.
    throw new AppError(ErrorCode.SESSION_EXPIRED, {
      meta: { reason: "account_missing", userId: claims.userId },
    });
  }

  if (!user.isActive) {
    throw new AppError(ErrorCode.SESSION_EXPIRED, {
      message: "This account is not available. Please contact support.",
      meta: { reason: "account_suspended", userId: claims.userId },
    });
  }

  /**
   * The token version check. Bumped by a password change, a password reset, a
   * "sign out everywhere" or refresh-token reuse detection, so every access token
   * issued before that moment stops working immediately (§29).
   */
  if (claims.tokenVersion !== user.tokenVersion) {
    throw new AppError(ErrorCode.SESSION_EXPIRED, {
      message: "Your session is no longer valid. Please sign in again.",
      meta: {
        reason: "token_version_mismatch",
        userId: claims.userId,
      },
    });
  }

  // Access tokens are short-lived, but logout must take effect immediately. The
  // `sid` claim ties the bearer token to its refresh-session row, so revoking
  // that row invalidates both credentials without changing every other device.
  const sessionIsActive =
    isValidObjectId(claims.sessionId) &&
    (await Session.exists({
      _id: claims.sessionId,
      user: user._id,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    }));

  if (!sessionIsActive) {
    throw new AppError(ErrorCode.SESSION_EXPIRED, {
      message: "Your session is no longer valid. Please sign in again.",
      meta: { reason: "session_revoked", userId: claims.userId },
    });
  }

  return { user, sessionId: claims.sessionId };
}

/**
 * Requires a valid access token.
 *
 * On success, attaches:
 *   `req.user`      the loaded account document (role read from the database)
 *   `req.sessionId` the refresh session this access token descends from
 *
 * @type {import('express').RequestHandler}
 */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = bearerToken(req);

  if (!token) {
    throw AppError.unauthenticated();
  }

  const { user, sessionId } = await resolveAuthenticatedUser(token);

  req.user = user;
  req.sessionId = sessionId;

  next();
});

/**
 * Attaches the account if a valid token is present, and carries on regardless.
 *
 * For endpoints that serve both guests and customers — a cart, a wishlist, a
 * product page that shows whether an item is already saved. An invalid token is
 * treated as absent rather than as an error, because a guest with a stale token
 * should still be able to shop.
 *
 * @type {import('express').RequestHandler}
 */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) return next();

  try {
    const { user, sessionId } = await resolveAuthenticatedUser(token);
    req.user = user;
    req.sessionId = sessionId;
  } catch (error) {
    if (
      !(error instanceof AppError) ||
      !OPTIONAL_AUTH_FAILURES.has(error.code)
    ) {
      throw error;
    }

    // Expected credential failures are treated as an absent guest session;
    // infrastructure and programming failures still reach the error handler.
    log.debug(
      { requestId: req.id, code: error.code },
      "optional auth ignored a bad token",
    );
  }

  return next();
});

/**
 * Requires one of the given roles.
 *
 * Must be used after `requireAuth`. The role is read from `req.user`, which came
 * from the database — never from the request body, a header or a query parameter
 * (§2).
 *
 * A refusal is audited. One customer stumbling into an admin URL is noise; a
 * pattern of them is a signal (§25).
 *
 * @param {...string} roles
 * @returns {import('express').RequestHandler}
 */
export function requireRole(...roles) {
  const allowed = new Set(roles);

  return asyncHandler(async (req, _res, next) => {
    if (!req.user) {
      // A programming error: the route is missing `requireAuth`. Fail closed.
      log.error(
        { requestId: req.id, path: req.path },
        "requireRole used without requireAuth — refusing the request",
      );
      throw AppError.unauthenticated();
    }

    if (!allowed.has(req.user.role)) {
      log.warn(
        {
          requestId: req.id,
          userId: req.user._id.toString(),
          role: req.user.role,
          required: [...allowed],
          path: req.path,
        },
        "role check failed",
      );

      await auditService.recordDenied({
        action: AuditAction.UNAUTHORISED_ACCESS_ATTEMPT,
        actor: req.user,
        targetType: AuditTargetType.SYSTEM,
        targetLabel: `${req.method} ${req.path}`,
        metadata: { requiredRoles: [...allowed], actualRole: req.user.role },
        req,
      });

      throw AppError.forbidden();
    }

    return next();
  });
}

/** Shorthand for the administrative endpoints. */
export const requireAdmin = requireRole(UserRole.ADMIN);
