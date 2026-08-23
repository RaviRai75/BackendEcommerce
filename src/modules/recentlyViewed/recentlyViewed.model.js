import mongoose from "mongoose";
import { createSchema, ref, registerModel } from "../../utils/schema.js";

export const RECENTLY_VIEWED_LIMIT = 20;
export const RECENTLY_VIEWED_RETENTION_DAYS = 30;

const recentlyViewedItemSchema = new mongoose.Schema(
  {
    product: ref("Product", { required: true }),
    viewedAt: {
      type: Date,
      required: true,
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const recentlyViewedSchema = createSchema(
  {
    user: {
      ...ref("User", { required: true }),
      immutable: true,
    },
    items: {
      type: [recentlyViewedItemSchema],
      default: [],
      validate: [
        {
          validator(items) {
            return items.length <= RECENTLY_VIEWED_LIMIT;
          },
          message: `Recently viewed may contain at most ${RECENTLY_VIEWED_LIMIT} products.`,
        },
        {
          validator(items) {
            const products = items.map((item) => item.product.toString());
            return products.length === new Set(products).size;
          },
          message: "Recently viewed products must be unique.",
        },
      ],
    },
    purgeAt: {
      type: Date,
      required: true,
    },
  },
  { collection: "recently_viewed" },
);

recentlyViewedSchema.index({ user: 1 }, { unique: true });
recentlyViewedSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const RecentlyViewed = registerModel(
  "RecentlyViewed",
  recentlyViewedSchema,
);
