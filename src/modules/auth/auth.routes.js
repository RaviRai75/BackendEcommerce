/**
 * Auth and account routes.
 *
 * Public endpoints are protected by rate limits, CSRF for cookie-authenticated
 * actions, or single-use tokens. Account endpoints require a bearer access token
 * and derive the account id exclusively from `req.user`.
 */
import { Router } from "express";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { privateNoStore as preventPrivateCaching } from "../../middleware/cachePolicy.js";
import { requireCsrfToken } from "../../middleware/csrf.js";
import {
  authLimiter,
  passwordResetLimiter,
} from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import {
  changePassword,
  currentUser,
  forgotPassword,
  listSessions,
  login,
  googleLogin,
  adminLogin,
  logout,
  logoutAll,
  refresh,
  register,
  resetPassword,
  sendVerification,
  updatePreferences,
  verifyEmail,
} from "./auth.controller.js";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  googleLoginSchema,
  registerSchema,
  resetPasswordSchema,
  sendVerificationSchema,
  updatePreferencesSchema,
  verifyEmailSchema,
} from "./auth.validator.js";

export const authRoutes = Router();

// PUBLIC / HYBRID VERIFICATION

authRoutes.post(
  "/auth/send-verification",
  authLimiter,
  optionalAuth,
  validate({ body: sendVerificationSchema }),
  sendVerification,
);

authRoutes.post(
  "/auth/verify-email",
  authLimiter,
  optionalAuth,
  validate({ body: verifyEmailSchema }),
  verifyEmail,
);

// PUBLIC

authRoutes.post(
  "/auth/register",
  authLimiter,
  validate({ body: registerSchema }),
  register,
);

authRoutes.post(
  "/auth/login",
  authLimiter,
  validate({ body: loginSchema }),
  login,
);

authRoutes.post(
  "/auth/google",
  authLimiter,
  validate({ body: googleLoginSchema }),
  googleLogin,
);


// Uses the same generic credential contract and limiter, but the service issues
// a session only when the database-backed account role is ADMIN.
authRoutes.post(
  "/auth/admin/login",
  authLimiter,
  validate({ body: loginSchema }),
  adminLogin,
);

/**
 * Refresh is rate limited too. A client refreshes once every fifteen minutes at
 * most, so a burst means either a bug in a retry loop or someone probing stolen
 * tokens — both worth throttling.
 */
authRoutes.post("/auth/refresh", authLimiter, requireCsrfToken, refresh);
authRoutes.post("/auth/logout", requireCsrfToken, logout);

authRoutes.post(
  "/auth/forgot-password",
  passwordResetLimiter,
  validate({ body: forgotPasswordSchema }),
  forgotPassword,
);

authRoutes.post(
  "/auth/reset-password",
  passwordResetLimiter,
  validate({ body: resetPasswordSchema }),
  resetPassword,
);

// AUTHENTICATED USER — never accepts a user id from the client.

authRoutes.get("/auth/me", preventPrivateCaching, requireAuth, currentUser);
authRoutes.patch(
  "/auth/preferences",
  requireAuth,
  validate({ body: updatePreferencesSchema }),
  updatePreferences,
);
authRoutes.get(
  "/auth/sessions",
  preventPrivateCaching,
  requireAuth,
  listSessions,
);
authRoutes.post(
  "/auth/change-password",
  authLimiter,
  requireAuth,
  validate({ body: changePasswordSchema }),
  changePassword,
);
authRoutes.post("/auth/logout-all", requireAuth, logoutAll);
