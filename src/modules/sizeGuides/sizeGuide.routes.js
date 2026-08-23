import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { privateNoStore as preventPrivateCaching } from "../../middleware/cachePolicy.js";
import { validate } from "../../middleware/validate.js";
import {
  createSizeGuide,
  getAdminSizeGuide,
  getPublicSizeGuide,
  listAdminSizeGuides,
  listPublicSizeGuides,
  publishSizeGuide,
  saveSizeGuideDraft,
  unpublishSizeGuide,
} from "./sizeGuide.controller.js";
import {
  adminSizeGuideListQuerySchema,
  createSizeGuideSchema,
  publicSizeGuideListQuerySchema,
  publishSizeGuideSchema,
  saveSizeGuideDraftSchema,
  sizeGuideIdParamSchema,
  sizeGuideSlugParamSchema,
  unpublishSizeGuideSchema,
} from "./sizeGuide.validator.js";

export const sizeGuideRoutes = Router();

// PUBLIC — current published snapshots only.
sizeGuideRoutes.get(
  "/size-guides",
  validate({ query: publicSizeGuideListQuerySchema }),
  listPublicSizeGuides,
);
sizeGuideRoutes.get(
  "/size-guides/:slug",
  validate({ params: sizeGuideSlugParamSchema }),
  getPublicSizeGuide,
);

// ADMIN — draft and publication state are private.
sizeGuideRoutes.use(
  "/admin/size-guides",
  preventPrivateCaching,
  requireAuth,
  requireAdmin,
);
sizeGuideRoutes.get(
  "/admin/size-guides",
  validate({ query: adminSizeGuideListQuerySchema }),
  listAdminSizeGuides,
);
sizeGuideRoutes.get(
  "/admin/size-guides/:id",
  validate({ params: sizeGuideIdParamSchema }),
  getAdminSizeGuide,
);
sizeGuideRoutes.post(
  "/admin/size-guides",
  validate({ body: createSizeGuideSchema }),
  createSizeGuide,
);
sizeGuideRoutes.put(
  "/admin/size-guides/:id/draft",
  validate({ params: sizeGuideIdParamSchema, body: saveSizeGuideDraftSchema }),
  saveSizeGuideDraft,
);
sizeGuideRoutes.post(
  "/admin/size-guides/:id/publish",
  validate({ params: sizeGuideIdParamSchema, body: publishSizeGuideSchema }),
  publishSizeGuide,
);
sizeGuideRoutes.post(
  "/admin/size-guides/:id/unpublish",
  validate({ params: sizeGuideIdParamSchema, body: unpublishSizeGuideSchema }),
  unpublishSizeGuide,
);
