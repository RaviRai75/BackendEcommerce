import { z } from "zod";
import { objectIdSchema, strictObject } from "../../validators/common.js";
import { CART_MAX_LINES, CART_MAX_QUANTITY } from "./cart.model.js";

const quantitySchema = z
  .number({ invalid_type_error: "Quantity must be a whole number." })
  .int("Quantity must be a whole number.")
  .min(1, "Quantity must be at least 1.")
  .max(CART_MAX_QUANTITY, `Quantity must be at most ${CART_MAX_QUANTITY}.`);

const cartItemSchema = strictObject({
  productId: objectIdSchema,
  variantId: objectIdSchema,
  quantity: quantitySchema,
});

export const cartItemsSchema = z
  .array(cartItemSchema)
  // Deliberately checked before duplicate canonicalization: hostile or broken
  // clients cannot bypass the raw request cap with repeated variant ids.
  .max(CART_MAX_LINES, `A cart may contain at most ${CART_MAX_LINES} lines.`)
  .transform((items) => {
    const positionByVariant = new Map();
    const canonical = [];
    for (const item of items) {
      const position = positionByVariant.get(item.variantId);
      if (position === undefined) {
        positionByVariant.set(item.variantId, canonical.length);
        canonical.push(item);
      } else {
        // First occurrence owns ordering; the last snapshot owns identity and
        // absolute quantity. This rule is deterministic and replay-idempotent.
        canonical[position] = item;
      }
    }
    return canonical;
  });

export const resolveCartSchema = strictObject({ items: cartItemsSchema });
export const mergeCartSchema = strictObject({ items: cartItemsSchema });

export const setCartItemParamsSchema = strictObject({
  variantId: objectIdSchema,
});
export const setCartItemSchema = strictObject({
  productId: objectIdSchema,
  quantity: quantitySchema,
});

export const deleteCartItemParamsSchema = setCartItemParamsSchema;
export const moveFromWishlistSchema = cartItemSchema;
