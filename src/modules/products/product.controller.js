import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  sendCreated,
  sendPaginated,
  sendSuccess,
} from "../../utils/response.js";
import { productInventoryService } from "./productInventory.service.js";
import { productService } from "./product.service.js";
import { recommendationService } from "./recommendation.service.js";

export const listProductFacets = asyncHandler(async (_req, res) => {
  sendSuccess(res, await productService.listPublicFacets());
});

export const listProducts = asyncHandler(async (req, res) => {
  const result = await productService.listPublic(req.query);
  sendPaginated(res, result.products, result, {
    sort: req.query.sort,
    filters: result.appliedFilters,
    search: result.search,
  });
});

export const getProduct = asyncHandler(async (req, res) => {
  sendSuccess(res, await productService.getPublicBySlug(req.params.slug));
});

export const listRelatedProducts = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await recommendationService.listRelated(req.params.slug, req.query.limit),
  );
});

export const listAdminProducts = asyncHandler(async (req, res) => {
  const result = await productService.listAdmin(req.query);
  sendPaginated(res, result.products, result, {
    sort: req.query.sort,
    filters: {
      status: req.query.status ?? null,
      q: req.query.q ?? null,
      categoryId: req.query.categoryId ?? null,
      collectionId: req.query.collectionId ?? null,
    },
  });
});

export const getAdminProduct = asyncHandler(async (req, res) => {
  sendSuccess(res, await productService.getAdminById(req.params.id));
});

export const createProduct = asyncHandler(async (req, res) => {
  sendCreated(
    res,
    await productService.create(req.body, req.user, req.serviceContext),
  );
});

export const updateProduct = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await productService.update(
      req.params.id,
      req.body,
      req.user,
      req.serviceContext,
    ),
  );
});

export const setProductStatus = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await productService.setStatus(
      req.params.id,
      req.body,
      req.user,
      req.serviceContext,
    ),
  );
});

export const adjustProductStock = asyncHandler(async (req, res) => {
  const result = await productInventoryService.adjustStock(
    req.params.productId,
    req.params.variantId,
    req.body,
    req.idempotencyKey,
    req.user,
    req.serviceContext,
  );
  sendSuccess(res, result.transaction, {
    status: result.replayed ? 200 : 201,
  });
});
