import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { privateNoStore as preventPrivateCaching } from "../../middleware/cachePolicy.js";
import { validate } from "../../middleware/validate.js";
import { getAdminDashboard } from "./dashboard.controller.js";
import { dashboardQuerySchema } from "./dashboard.validator.js";

export const dashboardRoutes = Router();

dashboardRoutes.get(
  "/admin/dashboard",
  preventPrivateCaching,
  requireAuth,
  requireAdmin,
  validate({ query: dashboardQuerySchema }),
  getAdminDashboard,
);
