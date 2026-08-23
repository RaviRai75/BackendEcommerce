import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { privateNoStore as preventPrivateCaching } from "../../middleware/cachePolicy.js";
import { requireIdempotencyKey as createIdempotencyKeyMiddleware } from "../../middleware/idempotencyKey.js";
import { exchangeLimiter } from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import {
  createExchange,
  getAdminExchange,
  getExchange,
  getExchangeEligibility,
  listAdminExchanges,
  listExchanges,
  performAdminExchangeAction,
} from "./exchange.controller.js";
import {
  adminExchangeActionSchema,
  adminExchangeListQuerySchema,
  createExchangeSchema,
  exchangeEligibilityParamSchema,
  exchangeListQuerySchema,
  exchangeNumberParamSchema,
  idempotencyKeySchema,
} from "./exchange.validator.js";

const requireIdempotencyKey =
  createIdempotencyKeyMiddleware(idempotencyKeySchema);

export const exchangeRoutes = Router();

exchangeRoutes.get(
  "/orders/:orderNumber/exchange-eligibility",
  preventPrivateCaching,
  requireAuth,
  validate({ params: exchangeEligibilityParamSchema }),
  getExchangeEligibility,
);
exchangeRoutes.get(
  "/exchanges",
  preventPrivateCaching,
  requireAuth,
  validate({ query: exchangeListQuerySchema }),
  listExchanges,
);
exchangeRoutes.get(
  "/exchanges/:exchangeNumber",
  preventPrivateCaching,
  requireAuth,
  validate({ params: exchangeNumberParamSchema }),
  getExchange,
);
exchangeRoutes.post(
  "/exchanges",
  requireAuth,
  exchangeLimiter,
  requireIdempotencyKey,
  validate({ body: createExchangeSchema }),
  createExchange,
);

exchangeRoutes.get(
  "/admin/exchanges",
  preventPrivateCaching,
  requireAuth,
  requireAdmin,
  validate({ query: adminExchangeListQuerySchema }),
  listAdminExchanges,
);
exchangeRoutes.get(
  "/admin/exchanges/:exchangeNumber",
  preventPrivateCaching,
  requireAuth,
  requireAdmin,
  validate({ params: exchangeNumberParamSchema }),
  getAdminExchange,
);
exchangeRoutes.post(
  "/admin/exchanges/:exchangeNumber/actions",
  preventPrivateCaching,
  requireAuth,
  requireAdmin,
  validate({
    params: exchangeNumberParamSchema,
    body: adminExchangeActionSchema,
  }),
  performAdminExchangeAction,
);
