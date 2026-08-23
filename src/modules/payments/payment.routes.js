import { Router } from "express";
import { isProduction } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireIdempotencyKey as createIdempotencyKeyMiddleware } from "../../middleware/idempotencyKey.js";
import { paymentLimiter } from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import { paymentService } from "../../services/payment/index.js";
import { idempotencyKeySchema } from "../orders/order.validator.js";
import {
  handleMockPrepaidWebhook,
  initiatePayment,
  verifyPayment,
} from "./payment.controller.js";
import {
  initiatePaymentSchema,
  mockWebhookSchema,
  paymentOrderParamsSchema,
  verifyPaymentSchema,
} from "./payment.validator.js";

const requireIdempotencyKey =
  createIdempotencyKeyMiddleware(idempotencyKeySchema);

function authenticateMockWebhook(req, _res, next) {
  try {
    req.mockWebhookAuth = paymentService.authenticateMockWebhook(
      req.rawPaymentWebhookBody,
      req.get("x-mock-signature"),
      req.get("x-mock-timestamp"),
    );
    next();
  } catch (error) {
    next(error);
  }
}

export const paymentRoutes = Router();

paymentRoutes.post(
  "/orders/:orderId/payment/initiate",
  requireAuth,
  paymentLimiter,
  requireIdempotencyKey,
  validate({ params: paymentOrderParamsSchema, body: initiatePaymentSchema }),
  initiatePayment,
);

paymentRoutes.post(
  "/orders/:orderId/payment/verify",
  requireAuth,
  paymentLimiter,
  validate({ params: paymentOrderParamsSchema, body: verifyPaymentSchema }),
  verifyPayment,
);

if (!isProduction) {
  paymentRoutes.post(
    "/webhooks/payments/mock-prepaid",
    authenticateMockWebhook,
    validate({ body: mockWebhookSchema }),
    handleMockPrepaidWebhook,
  );
}
