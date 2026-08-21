import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  createCollection,
  getAdminCollection,
  getCollection,
  listAdminCollections,
  listCollections,
  setCollectionStatus,
  updateCollection,
} from "./collection.controller.js";
import {
  adminCollectionListQuerySchema,
  collectionIdParamSchema,
  collectionSlugParamSchema,
  collectionStatusSchema,
  createCollectionSchema,
  updateCollectionSchema,
} from "./collection.validator.js";

export const collectionRoutes = Router();

// PUBLIC
collectionRoutes.get("/collections", listCollections);
collectionRoutes.get(
  "/collections/:slug",
  validate({ params: collectionSlugParamSchema }),
  getCollection,
);

// ADMIN
collectionRoutes.get(
  "/admin/collections",
  requireAuth,
  requireAdmin,
  validate({ query: adminCollectionListQuerySchema }),
  listAdminCollections,
);
collectionRoutes.get(
  "/admin/collections/:id",
  requireAuth,
  requireAdmin,
  validate({ params: collectionIdParamSchema }),
  getAdminCollection,
);
collectionRoutes.post(
  "/admin/collections",
  requireAuth,
  requireAdmin,
  validate({ body: createCollectionSchema }),
  createCollection,
);
collectionRoutes.patch(
  "/admin/collections/:id",
  requireAuth,
  requireAdmin,
  validate({ params: collectionIdParamSchema, body: updateCollectionSchema }),
  updateCollection,
);
collectionRoutes.patch(
  "/admin/collections/:id/status",
  requireAuth,
  requireAdmin,
  validate({ params: collectionIdParamSchema, body: collectionStatusSchema }),
  setCollectionStatus,
);
