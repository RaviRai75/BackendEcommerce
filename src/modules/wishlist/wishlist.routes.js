import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  addWishlistProduct,
  getWishlist,
  mergeWishlist,
  removeWishlistProduct,
  resolveWishlist,
} from "./wishlist.controller.js";
import {
  addWishlistProductSchema,
  mergeWishlistSchema,
  removeWishlistProductParamsSchema,
  resolveWishlistSchema,
} from "./wishlist.validator.js";

export const wishlistRoutes = Router();

// PUBLIC — resolves guest-held product identities without persisting them.
wishlistRoutes.post(
  "/wishlist/resolve",
  validate({ body: resolveWishlistSchema }),
  resolveWishlist,
);

// USER — ownership always comes from requireAuth's database-backed req.user.
wishlistRoutes.get("/wishlist", requireAuth, getWishlist);
wishlistRoutes.post(
  "/wishlist",
  requireAuth,
  validate({ body: addWishlistProductSchema }),
  addWishlistProduct,
);
wishlistRoutes.delete(
  "/wishlist/:productId",
  requireAuth,
  validate({ params: removeWishlistProductParamsSchema }),
  removeWishlistProduct,
);
wishlistRoutes.post(
  "/wishlist/merge",
  requireAuth,
  validate({ body: mergeWishlistSchema }),
  mergeWishlist,
);
