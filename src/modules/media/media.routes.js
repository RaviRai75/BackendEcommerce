import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import {
  exchangeLimiter,
  uploadLimiter,
} from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import {
  completeExchangeUpload,
  completeUpload,
  createExchangeUploadIntent,
  createUploadIntent,
  deleteMediaAsset,
} from "./media.controller.js";
import {
  completeUploadSchema,
  createExchangeUploadIntentSchema,
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
