import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  sendCreated,
  sendPaginated,
  sendSuccess,
} from "../../utils/response.js";
import { sizeGuideService } from "./sizeGuide.service.js";

export const listPublicSizeGuides = asyncHandler(async (req, res) => {
  const result = await sizeGuideService.listPublic(req.query);
  sendPaginated(res, result.guides, result);
});

export const getPublicSizeGuide = asyncHandler(async (req, res) => {
  sendSuccess(res, await sizeGuideService.getPublicBySlug(req.params.slug));
});

export const listAdminSizeGuides = asyncHandler(async (req, res) => {
  const result = await sizeGuideService.listAdmin(req.query);
  sendPaginated(res, result.guides, result, {
    filters: {
      state: req.query.state ?? null,
      q: req.query.q ?? null,
    },
  });
});

export const getAdminSizeGuide = asyncHandler(async (req, res) => {
  sendSuccess(res, await sizeGuideService.getAdminById(req.params.id));
});

export const createSizeGuide = asyncHandler(async (req, res) => {
  sendCreated(res, await sizeGuideService.create(req.body, req.user, req));
});

export const saveSizeGuideDraft = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await sizeGuideService.saveDraft(req.params.id, req.body, req.user, req),
  );
});

export const publishSizeGuide = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await sizeGuideService.publish(req.params.id, req.body, req.user, req),
  );
});

export const unpublishSizeGuide = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await sizeGuideService.unpublish(req.params.id, req.body, req.user, req),
  );
});
