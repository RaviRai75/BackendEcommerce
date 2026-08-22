import { Router } from "express";
import {
  optionalAuth,
  requireAdmin,
  requireAuth,
} from "../../middleware/auth.js";
import { couponLimiter } from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import {
  createCoupon,
  getAdminCoupon,
  listAdminCoupons,
  searchAdminCouponCustomerOptions,
  updateCoupon,
  validateCoupon,
} from "./coupon.controller.js";
import {
  adminCouponListQuerySchema,
  couponIdParamSchema,
  createCouponSchema,
  customerOptionSearchSchema,
  updateCouponSchema,
  validateCouponSchema,
} from "./coupon.validator.js";

export const couponRoutes = Router();

function preventPrivateCaching(_req, res, next) {
  res.set("Cache-Control", "private, no-store");
  next();
}

couponRoutes.post(
  "/coupons/validate",
  optionalAuth,
  couponLimiter,
  validate({ body: validateCouponSchema }),
  validateCoupon,
);

couponRoutes.use(
  "/admin/coupons",
  preventPrivateCaching,
  requireAuth,
  requireAdmin,
);

couponRoutes.get(
  "/admin/coupons",
  validate({ query: adminCouponListQuerySchema }),
  listAdminCoupons,
);
couponRoutes.post(
  "/admin/coupons/customer-options/search",
  validate({ body: customerOptionSearchSchema }),
  searchAdminCouponCustomerOptions,
);
couponRoutes.get(
  "/admin/coupons/:couponId",
  validate({ params: couponIdParamSchema }),
  getAdminCoupon,
);
couponRoutes.post(
  "/admin/coupons",
  validate({ body: createCouponSchema }),
  createCoupon,
);
couponRoutes.patch(
  "/admin/coupons/:couponId",
  validate({ params: couponIdParamSchema, body: updateCouponSchema }),
  updateCoupon,
);
