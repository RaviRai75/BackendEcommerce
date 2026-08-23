import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { privateNoStore as preventPrivateCaching } from "../../middleware/cachePolicy.js";
import { requireIdempotencyKey as createIdempotencyKeyMiddleware } from "../../middleware/idempotencyKey.js";
import { orderLimiter, quoteLimiter } from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
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

const requireIdempotencyKey =
  createIdempotencyKeyMiddleware(idempotencyKeySchema);

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
