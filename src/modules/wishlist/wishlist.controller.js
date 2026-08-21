import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/response.js";
import { wishlistService } from "./wishlist.service.js";

export const resolveWishlist = asyncHandler(async (req, res) => {
  sendSuccess(res, await wishlistService.resolve(req.body.productIds));
});

export const getWishlist = asyncHandler(async (req, res) => {
  sendSuccess(res, await wishlistService.get(req.user._id));
});

export const addWishlistProduct = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await wishlistService.add(req.user._id, req.body.productId),
  );
});

export const removeWishlistProduct = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await wishlistService.remove(req.user._id, req.params.productId),
  );
});

export const mergeWishlist = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await wishlistService.merge(req.user._id, req.body.productIds),
  );
});
