import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import {
  customizationLimiter,
  exchangeLimiter,
  reviewLimiter,
  uploadLimiter,
} from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import {
  completeCustomRequestUpload,
  completeExchangeUpload,
  completeReviewUpload,
  completeUpload,
  createCustomRequestUploadIntent,
  createExchangeUploadIntent,
  createReviewUploadIntent,
  createUploadIntent,
  deleteMediaAsset,
} from "./media.controller.js";
import {
  completeUploadSchema,
  createCustomRequestUploadIntentSchema,
  createExchangeUploadIntentSchema,
  createReviewUploadIntentSchema,
  createUploadIntentSchema,
  mediaAssetIdParamSchema,
} from "./media.validator.js";

export const mediaRoutes = Router();

mediaRoutes.post(
  "/media/exchanges/upload-intents",
  requireAuth,
  exchangeLimiter,
  validate({ body: createExchangeUploadIntentSchema }),
  createExchangeUploadIntent,
);

mediaRoutes.post(
  "/media/exchanges/uploads/complete",
  requireAuth,
  exchangeLimiter,
  validate({ body: completeUploadSchema }),
  completeExchangeUpload,
);

mediaRoutes.post(
  "/media/reviews/upload-intents",
  requireAuth,
  reviewLimiter,
  validate({ body: createReviewUploadIntentSchema }),
  createReviewUploadIntent,
);

mediaRoutes.post(
  "/media/reviews/uploads/complete",
  requireAuth,
  reviewLimiter,
  validate({ body: completeUploadSchema }),
  completeReviewUpload,
);

mediaRoutes.post(
  "/media/custom-requests/upload-intents",
  requireAuth,
  customizationLimiter,
  validate({ body: createCustomRequestUploadIntentSchema }),
  createCustomRequestUploadIntent,
);

mediaRoutes.post(
  "/media/custom-requests/uploads/complete",
  requireAuth,
  customizationLimiter,
  validate({ body: completeUploadSchema }),
  completeCustomRequestUpload,
);

mediaRoutes.post(
  "/admin/media/upload-intents",
  requireAuth,
  requireAdmin,
  uploadLimiter,
  validate({ body: createUploadIntentSchema }),
  createUploadIntent,
);

mediaRoutes.post(
  "/admin/media/uploads/complete",
  requireAuth,
  requireAdmin,
  uploadLimiter,
  validate({ body: completeUploadSchema }),
  completeUpload,
);

mediaRoutes.delete(
  "/admin/media/:id",
  requireAuth,
  requireAdmin,
  uploadLimiter,
  validate({ params: mediaAssetIdParamSchema }),
  deleteMediaAsset,
);
