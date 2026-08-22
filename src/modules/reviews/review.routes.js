import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { reviewLimiter } from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import { AppError } from "../../utils/AppError.js";
import {
  createReview,
  getReviewEligibility,
  listAdminReviews,
  listMyReviews,
  listPublicProductReviews,
  moderateReview,
} from "./review.controller.js";
import {
  adminReviewActionSchema,
  adminReviewListQuerySchema,
  createReviewSchema,
  idempotencyKeySchema,
  publicReviewListQuerySchema,
  reviewEligibilityParamSchema,
  reviewIdParamSchema,
  reviewListQuerySchema,
} from "./review.validator.js";
import { productSlugParamSchema } from "../products/product.validator.js";

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

export const reviewRoutes = Router();

reviewRoutes.get(
  "/orders/:orderNumber/review-eligibility",
  preventPrivateCaching,
  requireAuth,
  validate({ params: reviewEligibilityParamSchema }),
  getReviewEligibility,
);
reviewRoutes.post(
  "/reviews",
  requireAuth,
  reviewLimiter,
  requireIdempotencyKey,
  validate({ body: createReviewSchema }),
  createReview,
);
reviewRoutes.get(
  "/reviews",
  preventPrivateCaching,
  requireAuth,
  validate({ query: reviewListQuerySchema }),
  listMyReviews,
);
reviewRoutes.get(
  "/products/:slug/reviews",
  validate({
    params: productSlugParamSchema,
    query: publicReviewListQuerySchema,
  }),
  listPublicProductReviews,
);
reviewRoutes.get(
  "/admin/reviews",
  preventPrivateCaching,
  requireAuth,
  requireAdmin,
  validate({ query: adminReviewListQuerySchema }),
  listAdminReviews,
);
reviewRoutes.post(
  "/admin/reviews/:id/actions",
  preventPrivateCaching,
  requireAuth,
  requireAdmin,
  validate({ params: reviewIdParamSchema, body: adminReviewActionSchema }),
  moderateReview,
);
