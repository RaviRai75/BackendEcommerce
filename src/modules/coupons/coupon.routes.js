import { Router } from "express";
import { optionalAuth, requireAdmin, requireAuth } from "../../middleware/auth.js";
import { couponLimiter } from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import {
  createCoupon,
  getAdminCoupon,
  listAdminCoupons,
  updateCoupon,
  validateCoupon,
} from "./coupon.controller.js";
import {
  adminCouponListQuerySchema,
  couponIdParamSchema,
  createCouponSchema,
  updateCouponSchema,
  validateCouponSchema,
} from "./coupon.validator.js";

export const couponRoutes = Router();

couponRoutes.post(
  "/coupons/validate",
  optionalAuth,
  couponLimiter,
  validate({ body: validateCouponSchema }),
  validateCoupon,
);

couponRoutes.get(
  "/admin/coupons",
  requireAuth,
  requireAdmin,
  validate({ query: adminCouponListQuerySchema }),
  listAdminCoupons,
);
couponRoutes.get(
  "/admin/coupons/:couponId",
  requireAuth,
  requireAdmin,
  validate({ params: couponIdParamSchema }),
  getAdminCoupon,
);
couponRoutes.post(
  "/admin/coupons",
  requireAuth,
  requireAdmin,
  validate({ body: createCouponSchema }),
  createCoupon,
);
couponRoutes.patch(
  "/admin/coupons/:couponId",
  requireAuth,
  requireAdmin,
  validate({ params: couponIdParamSchema, body: updateCouponSchema }),
  updateCoupon,
);
