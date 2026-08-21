import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  createCategory,
  getAdminCategory,
  getCategory,
  listAdminCategories,
  listCategories,
  setCategoryStatus,
  updateCategory,
} from "./category.controller.js";
import {
  adminCategoryListQuerySchema,
  categoryIdParamSchema,
  categorySlugParamSchema,
  categoryStatusSchema,
  createCategorySchema,
  updateCategorySchema,
} from "./category.validator.js";

export const categoryRoutes = Router();

// PUBLIC
categoryRoutes.get("/categories", listCategories);
categoryRoutes.get(
  "/categories/:slug",
  validate({ params: categorySlugParamSchema }),
  getCategory,
);

// ADMIN
categoryRoutes.get(
  "/admin/categories",
  requireAuth,
  requireAdmin,
  validate({ query: adminCategoryListQuerySchema }),
  listAdminCategories,
);
categoryRoutes.get(
  "/admin/categories/:id",
  requireAuth,
  requireAdmin,
  validate({ params: categoryIdParamSchema }),
  getAdminCategory,
);
categoryRoutes.post(
  "/admin/categories",
  requireAuth,
  requireAdmin,
  validate({ body: createCategorySchema }),
  createCategory,
);
categoryRoutes.patch(
  "/admin/categories/:id",
  requireAuth,
  requireAdmin,
  validate({ params: categoryIdParamSchema, body: updateCategorySchema }),
  updateCategory,
);
categoryRoutes.patch(
  "/admin/categories/:id/status",
  requireAuth,
  requireAdmin,
  validate({ params: categoryIdParamSchema, body: categoryStatusSchema }),
  setCategoryStatus,
);
