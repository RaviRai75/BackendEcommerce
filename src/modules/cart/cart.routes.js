import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  deleteCartItem,
  getCart,
  mergeCart,
  moveFromWishlist,
  resolveCart,
  setCartItem,
} from "./cart.controller.js";
import {
  deleteCartItemParamsSchema,
  mergeCartSchema,
  moveFromWishlistSchema,
  resolveCartSchema,
  setCartItemParamsSchema,
  setCartItemSchema,
} from "./cart.validator.js";

export const cartRoutes = Router();

// PUBLIC — resolves a guest-held snapshot without accepting an owner or writing.
cartRoutes.post(
  "/cart/resolve",
  validate({ body: resolveCartSchema }),
  resolveCart,
);

// USER — ownership comes exclusively from requireAuth's database-backed user.
cartRoutes.get("/cart", requireAuth, getCart);
cartRoutes.put(
  "/cart/items/:variantId",
  requireAuth,
  validate({ params: setCartItemParamsSchema, body: setCartItemSchema }),
  setCartItem,
);
cartRoutes.delete(
  "/cart/items/:variantId",
  requireAuth,
  validate({ params: deleteCartItemParamsSchema }),
  deleteCartItem,
);
cartRoutes.post(
  "/cart/merge",
  requireAuth,
  validate({ body: mergeCartSchema }),
  mergeCart,
);
cartRoutes.post(
  "/cart/move-from-wishlist",
  requireAuth,
  validate({ body: moveFromWishlistSchema }),
  moveFromWishlist,
);
