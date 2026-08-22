import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { orderLimiter, quoteLimiter } from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import { AppError } from "../../utils/AppError.js";
import {
  getAdminOrder,
  getOrder,
  listAdminOrders,
  listOrders,
  performAdminOrderAction,
  placeOrder,
  quoteOrder,
} from "./order.controller.js";
import {
  adminOrderActionSchema,
  adminOrderListQuerySchema,
  idempotencyKeySchema,
  orderListQuerySchema,
  orderNumberParamSchema,
  placeOrderSchema,
  quoteOrderSchema,
} from "./order.validator.js";

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

export const orderRoutes = Router();
orderRoutes.get(
  "/orders",
  preventPrivateCaching,
  requireAuth,
  validate({ query: orderListQuerySchema }),
  listOrders,
);
orderRoutes.get(
  "/orders/:orderNumber",
  preventPrivateCaching,
  requireAuth,
  validate({ params: orderNumberParamSchema }),
  getOrder,
);
orderRoutes.post(
  "/orders/quote",
  requireAuth,
  quoteLimiter,
  validate({ body: quoteOrderSchema }),
  quoteOrder,
);
orderRoutes.post(
  "/orders",
  requireAuth,
  orderLimiter,
  requireIdempotencyKey,
  validate({ body: placeOrderSchema }),
  placeOrder,
);

orderRoutes.get(
  "/admin/orders",
  preventPrivateCaching,
  requireAuth,
  requireAdmin,
  validate({ query: adminOrderListQuerySchema }),
  listAdminOrders,
);
orderRoutes.get(
  "/admin/orders/:orderNumber",
  preventPrivateCaching,
  requireAuth,
  requireAdmin,
  validate({ params: orderNumberParamSchema }),
  getAdminOrder,
);
orderRoutes.post(
  "/admin/orders/:orderNumber/actions",
  preventPrivateCaching,
  requireAuth,
  requireAdmin,
  validate({
    params: orderNumberParamSchema,
    body: adminOrderActionSchema,
  }),
  performAdminOrderAction,
);
