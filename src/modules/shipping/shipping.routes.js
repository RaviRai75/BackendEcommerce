import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { searchLimiter } from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import {
  addPincode,
  getServiceability,
  getShippingSettings,
  searchPincodes,
  updateShippingSettings,
} from "./shipping.controller.js";
import { serviceabilityQuerySchema } from "./shipping.validator.js";

export const shippingRoutes = Router();

// PUBLIC
shippingRoutes.get(
  "/shipping/serviceability",
  searchLimiter,
  validate({ query: serviceabilityQuerySchema }),
  getServiceability,
);

// ADMIN
shippingRoutes.get(
  "/admin/shipping/settings",
  requireAuth,
  requireAdmin,
  getShippingSettings,
);

shippingRoutes.patch(
  "/admin/shipping/settings",
  requireAuth,
  requireAdmin,
  updateShippingSettings,
);

shippingRoutes.post(
  "/admin/shipping/pincodes",
  requireAuth,
  requireAdmin,
  addPincode,
);

shippingRoutes.get(
  "/admin/shipping/pincodes",
  requireAuth,
  requireAdmin,
  searchPincodes,
);
