import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/response.js";
import { cartService } from "./cart.service.js";

export const resolveCart = asyncHandler(async (req, res) => {
  sendSuccess(res, await cartService.resolve(req.body.items));
});

export const getCart = asyncHandler(async (req, res) => {
  sendSuccess(res, await cartService.get(req.user._id));
});

export const setCartItem = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await cartService.set(req.user._id, {
      ...req.body,
      variantId: req.params.variantId,
    }),
  );
});

export const deleteCartItem = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await cartService.remove(req.user._id, req.params.variantId),
  );
});

export const mergeCart = asyncHandler(async (req, res) => {
  sendSuccess(res, await cartService.merge(req.user._id, req.body.items));
});

export const moveFromWishlist = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await cartService.moveFromWishlist(req.user._id, req.body),
  );
});
