import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { searchLimiter } from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import {
  createProduct,
  getAdminProduct,
  getProduct,
  listAdminProducts,
  listProductFacets,
  listProducts,
  listRelatedProducts,
  setProductStatus,
  updateProduct,
} from "./product.controller.js";
import {
  adminProductListQuerySchema,
  createProductSchema,
  productIdParamSchema,
  productListQuerySchema,
  productSlugParamSchema,
  productStatusSchema,
  relatedProductsQuerySchema,
  updateProductSchema,
} from "./product.validator.js";

export const productRoutes = Router();

// PUBLIC
productRoutes.get(
  "/products",
  searchLimiter,
  validate({ query: productListQuerySchema }),
  listProducts,
);
productRoutes.get("/products/facets", searchLimiter, listProductFacets);
productRoutes.get(
  "/products/:slug/related",
  searchLimiter,
  validate({
    params: productSlugParamSchema,
    query: relatedProductsQuerySchema,
  }),
  listRelatedProducts,
);
productRoutes.get(
  "/products/:slug",
  validate({ params: productSlugParamSchema }),
  getProduct,
);

// ADMIN
productRoutes.get(
  "/admin/products",
  requireAuth,
  requireAdmin,
  validate({ query: adminProductListQuerySchema }),
  listAdminProducts,
);
productRoutes.get(
  "/admin/products/:id",
  requireAuth,
  requireAdmin,
  validate({ params: productIdParamSchema }),
  getAdminProduct,
);
productRoutes.post(
  "/admin/products",
  requireAuth,
  requireAdmin,
  validate({ body: createProductSchema }),
  createProduct,
);
productRoutes.patch(
  "/admin/products/:id",
  requireAuth,
  requireAdmin,
  validate({ params: productIdParamSchema, body: updateProductSchema }),
  updateProduct,
);
productRoutes.patch(
  "/admin/products/:id/status",
  requireAuth,
  requireAdmin,
  validate({ params: productIdParamSchema, body: productStatusSchema }),
  setProductStatus,
);
