/**
 * Auth and account routes.
 *
 * Public endpoints are protected by rate limits, CSRF for cookie-authenticated
 * actions, or single-use tokens. Account endpoints require a bearer access token
 * and derive the account id exclusively from `req.user`.
 */
import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
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
  logout,
  logoutAll,
  refresh,
  register,
  resetPassword,
} from "./auth.controller.js";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth.validator.js";

export const authRoutes = Router();

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

authRoutes.get("/auth/me", requireAuth, currentUser);
authRoutes.get("/auth/sessions", requireAuth, listSessions);
authRoutes.post(
  "/auth/change-password",
  authLimiter,
  requireAuth,
  validate({ body: changePasswordSchema }),
  changePassword,
);
authRoutes.post("/auth/logout-all", requireAuth, logoutAll);
