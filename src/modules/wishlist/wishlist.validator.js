import { z } from "zod";
import { objectIdSchema, strictObject } from "../../validators/common.js";
import { WISHLIST_MAX_PRODUCTS } from "./wishlist.model.js";

const productIdsSchema = z
  .array(objectIdSchema)
  .max(
    WISHLIST_MAX_PRODUCTS,
    `A wishlist may contain at most ${WISHLIST_MAX_PRODUCTS} products.`,
  )
  .transform((productIds) => [...new Set(productIds)]);

export const resolveWishlistSchema = strictObject({
  productIds: productIdsSchema,
});

export const addWishlistProductSchema = strictObject({
  productId: objectIdSchema,
});

export const removeWishlistProductParamsSchema = strictObject({
  productId: objectIdSchema,
});

export const mergeWishlistSchema = strictObject({
  productIds: productIdsSchema,
});
