import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/response.js";
import { recentlyViewedService } from "./recentlyViewed.service.js";

export const resolveRecentlyViewed = asyncHandler(async (req, res) => {
  sendSuccess(res, await recentlyViewedService.resolve(req.body.productIds));
});

export const getRecentlyViewed = asyncHandler(async (req, res) => {
  sendSuccess(res, await recentlyViewedService.get(req.user._id));
});

export const recordRecentlyViewed = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await recentlyViewedService.record(req.user._id, req.params.productId),
  );
});

export const mergeRecentlyViewed = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await recentlyViewedService.merge(req.user._id, req.body.productIds),
  );
});

export const clearRecentlyViewed = asyncHandler(async (req, res) => {
  sendSuccess(res, await recentlyViewedService.clear(req.user._id));
});
