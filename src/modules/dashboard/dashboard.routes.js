import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { getAdminDashboard } from "./dashboard.controller.js";
import { dashboardQuerySchema } from "./dashboard.validator.js";

function preventPrivateCaching(_req, res, next) {
  res.set("Cache-Control", "private, no-store");
  next();
}

export const dashboardRoutes = Router();

dashboardRoutes.get(
  "/admin/dashboard",
  preventPrivateCaching,
  requireAuth,
  requireAdmin,
  validate({ query: dashboardQuerySchema }),
  getAdminDashboard,
);
