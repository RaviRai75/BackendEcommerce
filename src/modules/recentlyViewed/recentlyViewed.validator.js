import { z } from "zod";
import { objectIdSchema, strictObject } from "../../validators/common.js";
import { RECENTLY_VIEWED_LIMIT } from "./recentlyViewed.model.js";

const productIdsSchema = z
  .array(objectIdSchema)
  .max(
    RECENTLY_VIEWED_LIMIT,
    `Recently viewed may contain at most ${RECENTLY_VIEWED_LIMIT} products.`,
  )
  .transform((productIds) => [...new Set(productIds)]);

export const resolveRecentlyViewedSchema = strictObject({
  productIds: productIdsSchema,
});

export const mergeRecentlyViewedSchema = strictObject({
  productIds: productIdsSchema,
});

export const recentlyViewedProductParamsSchema = strictObject({
  productId: objectIdSchema,
});

export const recordRecentlyViewedSchema = strictObject({});
