import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  sendCreated,
  sendPaginated,
  sendSuccess,
} from "../../utils/response.js";
import { categoryService } from "./category.service.js";

export const listCategories = asyncHandler(async (_req, res) => {
  sendSuccess(res, await categoryService.listPublic());
});

export const getCategory = asyncHandler(async (req, res) => {
  sendSuccess(res, await categoryService.getPublicBySlug(req.params.slug));
});

export const listAdminCategories = asyncHandler(async (req, res) => {
  const result = await categoryService.listAdmin(req.query);
  sendPaginated(res, result.categories, result, {
    filters: {
      status: req.query.status ?? null,
      q: req.query.q ?? null,
    },
  });
});

export const getAdminCategory = asyncHandler(async (req, res) => {
  sendSuccess(res, await categoryService.getAdminById(req.params.id));
});

export const createCategory = asyncHandler(async (req, res) => {
  sendCreated(res, await categoryService.create(req.body, req.user, req));
});

export const updateCategory = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await categoryService.update(req.params.id, req.body, req.user, req),
  );
});

export const setCategoryStatus = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await categoryService.setStatus(req.params.id, req.body, req.user, req),
  );
});
