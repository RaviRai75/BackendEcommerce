import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  getAdminBusinessProfile,
  getAdminContentPage,
  getDeliveryPolicy,
  getExchangePolicy,
  getPublicBusinessProfile,
  getPublicContentPage,
  listAdminContentPages,
  publishAdminBusinessProfile,
  publishAdminContentPage,
  saveAdminBusinessProfileDraft,
  saveAdminContentPageDraft,
  unpublishAdminBusinessProfile,
  unpublishAdminContentPage,
} from "./content.controller.js";
import {
  contentPageKeyParamsSchema,
  contentPageSlugParamsSchema,
  publishContentSchema,
  saveBusinessProfileDraftSchema,
  saveEditorialDraftSchema,
  unpublishContentSchema,
} from "./content.validator.js";

function preventPrivateCaching(_req, res, next) {
  res.set("Cache-Control", "private, no-store");
  next();
}

export const contentRoutes = Router();

// PUBLIC — published snapshots and current operational projections only.
contentRoutes.get(
  "/content/pages/:slug",
  validate({ params: contentPageSlugParamsSchema }),
  getPublicContentPage,
);
contentRoutes.get("/content/business-profile", getPublicBusinessProfile);
contentRoutes.get(
  "/content/operational-policies/delivery",
  getDeliveryPolicy,
);
contentRoutes.get(
  "/content/operational-policies/exchange",
  getExchangePolicy,
);

// ADMIN — all responses, including authentication and validation failures, are private.
contentRoutes.use(
  "/admin/content",
  preventPrivateCaching,
  requireAuth,
  requireAdmin,
);
contentRoutes.get("/admin/content/pages", listAdminContentPages);
contentRoutes.get(
  "/admin/content/pages/:key",
  validate({ params: contentPageKeyParamsSchema }),
  getAdminContentPage,
);
contentRoutes.put(
  "/admin/content/pages/:key/draft",
  validate({
    params: contentPageKeyParamsSchema,
    body: saveEditorialDraftSchema,
  }),
  saveAdminContentPageDraft,
);
contentRoutes.post(
  "/admin/content/pages/:key/publish",
  validate({ params: contentPageKeyParamsSchema, body: publishContentSchema }),
  publishAdminContentPage,
);
contentRoutes.post(
  "/admin/content/pages/:key/unpublish",
  validate({ params: contentPageKeyParamsSchema, body: unpublishContentSchema }),
  unpublishAdminContentPage,
);

contentRoutes.get(
  "/admin/content/business-profile",
  getAdminBusinessProfile,
);
contentRoutes.put(
  "/admin/content/business-profile/draft",
  validate({ body: saveBusinessProfileDraftSchema }),
  saveAdminBusinessProfileDraft,
);
contentRoutes.post(
  "/admin/content/business-profile/publish",
  validate({ body: publishContentSchema }),
  publishAdminBusinessProfile,
);
contentRoutes.post(
  "/admin/content/business-profile/unpublish",
  validate({ body: unpublishContentSchema }),
  unpublishAdminBusinessProfile,
);
