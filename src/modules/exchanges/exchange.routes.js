import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { exchangeLimiter } from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import { AppError } from "../../utils/AppError.js";
import {
  createExchange,
  getExchange,
  getExchangeEligibility,
  listExchanges,
} from "./exchange.controller.js";
import {
  createExchangeSchema,
  exchangeEligibilityParamSchema,
  exchangeListQuerySchema,
  exchangeNumberParamSchema,
  idempotencyKeySchema,
} from "./exchange.validator.js";

function preventPrivateCaching(_req, res, next) {
  res.set("Cache-Control", "private, no-store");
  next();
}

function requireIdempotencyKey(req, _res, next) {
  const parsed = idempotencyKeySchema.safeParse(req.get("Idempotency-Key"));
  if (!parsed.success) {
    next(
      AppError.validation({
        idempotencyKey:
          "Provide a high-entropy Idempotency-Key of 32 to 200 printable characters.",
      }),
    );
    return;
  }
  req.idempotencyKey = parsed.data;
  next();
}

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
