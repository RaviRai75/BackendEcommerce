/**
 * Auth controllers.
 *
 * Thin by design (architecture §4): read the validated input, call the service,
 * set or clear cookies, send the envelope. No business rules here.
 *
 * One rule these controllers do own, because it is an HTTP concern: the refresh
 * token is only ever written to an HttpOnly cookie, and the access token is only
 * ever written to the response body. Neither crosses over.
 */
import {
  CSRF_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  clearCsrfCookieOptions,
  clearRefreshCookieOptions,
  csrfCookieOptions,
  refreshCookieOptions,
} from "../../config/cookies.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendCreated, sendSuccess } from "../../utils/response.js";
import { authService } from "./auth.service.js";
import { UserRole } from "../users/user.model.js";
import { createCsrfToken } from "./token.service.js";

/**
 * Writes the session cookies and returns the body the client expects.
 *
 * The access token goes in the body because the client keeps it in memory only —
 * putting it in a readable cookie would be storing a credential where a script
 * could find it (see docs/DECISIONS.md D2).
 */
function completeAuthentication(
  res,
  { user, accessToken, expiresInSeconds, refreshToken },
) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  res.cookie(CSRF_COOKIE_NAME, createCsrfToken(), csrfCookieOptions());

  return {
    user: user.toPublicProfile(),
    accessToken,
    expiresInSeconds,
  };
}

/** POST /auth/register — PUBLIC */
export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, req.serviceContext);
  sendCreated(res, completeAuthentication(res, result));
});

/** POST /auth/login — PUBLIC CUSTOMER ENTRY */
export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, req.serviceContext, {
    requiredRole: UserRole.USER,
  });
  sendSuccess(res, completeAuthentication(res, result));
});

/** POST /auth/google — PUBLIC GOOGLE OAUTH CUSTOMER ENTRY */
export const googleLogin = asyncHandler(async (req, res) => {
  const result = await authService.googleLogin(req.body, req.serviceContext);
  sendSuccess(res, completeAuthentication(res, result));
});


/** POST /auth/admin/login — PUBLIC ADMINISTRATOR ENTRY */
export const adminLogin = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, req.serviceContext, {
    requiredRole: UserRole.ADMIN,
  });
  sendSuccess(res, completeAuthentication(res, result));
});

/**
 * POST /auth/refresh — PUBLIC (authenticated by the refresh cookie + CSRF token)
 *
 * The token is read from the cookie, never from the body: a body-supplied refresh
 * token would let a script that can read one use it, which is the whole thing the
 * HttpOnly cookie prevents.
 */
export const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(
    req.cookies?.[REFRESH_COOKIE_NAME],
    req.serviceContext,
  );
  sendSuccess(res, completeAuthentication(res, result));
});

/**
 * POST /auth/logout — PUBLIC (authenticated by the refresh cookie + CSRF token)
 *
 * Always succeeds. The cookies are cleared regardless of whether the token was
 * recognised, so a client can always get back to a clean signed-out state.
 */
export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.cookies?.[REFRESH_COOKIE_NAME]);

  res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions());
  res.clearCookie(CSRF_COOKIE_NAME, clearCsrfCookieOptions());

  sendSuccess(res, { signedOut: true });
});

/**
 * POST /auth/forgot-password — PUBLIC
 *
 * One fixed response, always. Whether the address has an account is exactly what
 * security §28 says must not be revealed, so the reply cannot depend on it — and
 * the reset token never appears in the response.
 */
export const forgotPassword = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  await authService.requestPasswordReset(req.body.email, req.serviceContext);

  // Equal bodies are not enough: returning immediately for an unknown address
  // creates an account-enumeration timing oracle. Keep both paths behind the
  // same conservative response floor; the endpoint is already rate-limited.
  const remainingDelay = 300 - (Date.now() - startedAt);
  if (remainingDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingDelay));
  }

  sendSuccess(res, {
    message:
      "If an account exists for that email address, we have sent password reset instructions.",
  });
});

/**
 * POST /auth/reset-password — PUBLIC
 *
 * On success every session is already revoked by the service, so the customer is
 * deliberately left signed out and has to sign in with the new password.
 */
export const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body, req.serviceContext);

  res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions());
  res.clearCookie(CSRF_COOKIE_NAME, clearCsrfCookieOptions());

  sendSuccess(res, {
    message:
      "Your password has been changed. Please sign in with your new password.",
  });
});

/** GET /auth/me — AUTHENTICATED USER */
export const currentUser = asyncHandler(async (req, res) => {
  sendSuccess(res, { user: req.user.toPublicProfile() });
});

/** PATCH /auth/preferences — AUTHENTICATED USER */
export const updatePreferences = asyncHandler(async (req, res) => {
  const user = await authService.updatePreferences({
    userId: req.user._id,
    marketingConsent: req.body.marketingConsent,
  });
  sendSuccess(res, { user: user.toPublicProfile() });
});

/** GET /auth/sessions — AUTHENTICATED USER */
export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await authService.listActiveSessions(req.user._id);
  sendSuccess(res, { sessions });
});

/** POST /auth/change-password — AUTHENTICATED USER */
export const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(
    {
      userId: req.user._id,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
    },
    req.serviceContext,
  );

  res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions());
  res.clearCookie(CSRF_COOKIE_NAME, clearCsrfCookieOptions());

  sendSuccess(res, {
    message: "Your password has been changed. Please sign in again.",
  });
});

/** POST /auth/logout-all — AUTHENTICATED USER */
export const logoutAll = asyncHandler(async (req, res) => {
  const result = await authService.revokeAllSessions(req.user._id, undefined, {
    actor: req.user,
    req: req.serviceContext,
  });

  res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions());
  res.clearCookie(CSRF_COOKIE_NAME, clearCsrfCookieOptions());

  sendSuccess(res, { signedOut: true, ...result });
});

/** POST /auth/send-verification — PUBLIC or AUTHENTICATED */
export const sendVerification = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  const email = req.body?.email || req.user?.email;
  const result = await authService.sendVerificationCode({ userId, email });
  sendSuccess(res, result);
});

/** POST /auth/verify-email — PUBLIC or AUTHENTICATED */
export const verifyEmail = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  const email = req.body?.email || req.user?.email;
  const code = req.body?.code;
  const result = await authService.verifyEmailCode({ userId, email, code });
  sendSuccess(res, result);
});

