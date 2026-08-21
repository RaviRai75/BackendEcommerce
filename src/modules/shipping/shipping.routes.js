import { Router } from "express";
import { searchLimiter } from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import { getServiceability } from "./shipping.controller.js";
import { serviceabilityQuerySchema } from "./shipping.validator.js";

export const shippingRoutes = Router();

// PUBLIC
shippingRoutes.get(
  "/shipping/serviceability",
  searchLimiter,
  validate({ query: serviceabilityQuerySchema }),
  getServiceability,
);
