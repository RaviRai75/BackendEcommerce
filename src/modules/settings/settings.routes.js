import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  getAdminSettings,
  getSettings,
  updateSettings,
} from "./settings.controller.js";
import { updateSettingsSchema } from "./settings.validator.js";

export const settingsRoutes = Router();

// PUBLIC
settingsRoutes.get("/settings", getSettings);

// ADMIN
settingsRoutes.get(
  "/admin/settings",
  requireAuth,
  requireAdmin,
  getAdminSettings,
);
settingsRoutes.patch(
  "/admin/settings",
  requireAuth,
  requireAdmin,
  validate({ body: updateSettingsSchema }),
  updateSettings,
);
