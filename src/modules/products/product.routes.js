import express, { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { requireIdempotencyKey as createIdempotencyKeyMiddleware } from "../../middleware/idempotencyKey.js";
import { searchLimiter, uploadLimiter } from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import {
  adjustProductStock,
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
  confirmProductImport,
  exportProductsCsv,
  getProductImport,
  previewProductImport,
} from "./productImport.controller.js";
import {
  PRODUCT_CSV_MAX_BYTES,
  productImportIdempotencyKeySchema,
  productImportIdParamSchema,
} from "./productCsv.validator.js";
import {
  adminProductListQuerySchema,
  createProductSchema,
  productIdParamSchema,
  productListQuerySchema,
  productSlugParamSchema,
  productStatusSchema,
  relatedProductsQuerySchema,
  stockAdjustmentIdempotencyKeySchema,
  stockAdjustmentParamsSchema,
  stockAdjustmentSchema,
  updateProductSchema,
} from "./product.validator.js";

function requireUtf8Csv(req, _res, next) {
  const contentType = req.get("content-type") ?? "";
  const [mediaType, ...parameters] = contentType.split(";");
  const charset = parameters
    .map((entry) => entry.trim().split("="))
    .find(([name]) => name?.toLowerCase() === "charset")?.[1]
    ?.replace(/^"|"$/g, "")
    .toLowerCase();
  const contentEncoding = (
    req.get("content-encoding") ?? "identity"
  ).toLowerCase();
  if (
    mediaType.trim().toLowerCase() !== "text/csv" ||
    (charset && charset !== "utf-8" && charset !== "utf8") ||
    contentEncoding !== "identity"
  ) {
    next(new AppError(ErrorCode.UNSUPPORTED_MEDIA_TYPE));
    return;
  }
  next();
}

const productCsvBody = express.raw({
  type: () => true,
  limit: PRODUCT_CSV_MAX_BYTES,
  inflate: false,
});

const requireImportIdempotencyKey = createIdempotencyKeyMiddleware(
  productImportIdempotencyKeySchema,
);

const requireStockAdjustmentIdempotencyKey = createIdempotencyKeyMiddleware(
  stockAdjustmentIdempotencyKeySchema,
);

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
productRoutes.post(
  "/admin/products/imports/preview",
  requireAuth,
  requireAdmin,
  requireUtf8Csv,
  uploadLimiter,
  productCsvBody,
  previewProductImport,
);
productRoutes.get(
  "/admin/products/export.csv",
  requireAuth,
  requireAdmin,
  exportProductsCsv,
);
productRoutes.get(
  "/admin/products/imports/:id",
  requireAuth,
  requireAdmin,
  validate({ params: productImportIdParamSchema }),
  getProductImport,
);
productRoutes.post(
  "/admin/products/imports/:id/confirm",
  requireAuth,
  requireAdmin,
  uploadLimiter,
  requireImportIdempotencyKey,
  validate({ params: productImportIdParamSchema }),
  confirmProductImport,
);
productRoutes.post(
  "/admin/products/:productId/variants/:variantId/stock-adjustments",
  requireAuth,
  requireAdmin,
  requireStockAdjustmentIdempotencyKey,
  validate({
    params: stockAdjustmentParamsSchema,
    body: stockAdjustmentSchema,
  }),
  adjustProductStock,
);
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
