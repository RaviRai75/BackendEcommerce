import { Router } from "express";
import { isProduction } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { paymentLimiter } from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import { AppError } from "../../utils/AppError.js";
import { idempotencyKeySchema } from "../orders/order.validator.js";
import { mockPrepaidAdapter } from "../../services/payment/adapters/mockPrepaid.adapter.js";
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

function authenticateMockWebhook(req, _res, next) {
  try {
    req.mockWebhookAuth = mockPrepaidAdapter.verifyWebhookSignature(
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
