import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { privateNoStore as preventPrivateCaching } from "../../middleware/cachePolicy.js";
import { validate } from "../../middleware/validate.js";
import {
  clearRecentlyViewed,
  getRecentlyViewed,
  mergeRecentlyViewed,
  recordRecentlyViewed,
  resolveRecentlyViewed,
} from "./recentlyViewed.controller.js";
import {
  mergeRecentlyViewedSchema,
  recentlyViewedProductParamsSchema,
  recordRecentlyViewedSchema,
  resolveRecentlyViewedSchema,
} from "./recentlyViewed.validator.js";

export const recentlyViewedRoutes = Router();

// PUBLIC — resolves bounded guest-held identities without persisting them.
recentlyViewedRoutes.post(
  "/recently-viewed/resolve",
  preventPrivateCaching,
  validate({ body: resolveRecentlyViewedSchema }),
  resolveRecentlyViewed,
);

// USER — ownership always comes from the authenticated database user.
recentlyViewedRoutes.get(
  "/recently-viewed",
  requireAuth,
  preventPrivateCaching,
  getRecentlyViewed,
);
recentlyViewedRoutes.post(
  "/recently-viewed/merge",
  requireAuth,
  preventPrivateCaching,
  validate({ body: mergeRecentlyViewedSchema }),
  mergeRecentlyViewed,
);
recentlyViewedRoutes.post(
  "/recently-viewed/:productId",
  requireAuth,
  preventPrivateCaching,
  validate({
    params: recentlyViewedProductParamsSchema,
    body: recordRecentlyViewedSchema,
  }),
  recordRecentlyViewed,
);
recentlyViewedRoutes.delete(
  "/recently-viewed",
  requireAuth,
  preventPrivateCaching,
  clearRecentlyViewed,
);
