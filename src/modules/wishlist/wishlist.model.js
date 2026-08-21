import mongoose from "mongoose";
import { createSchema, ref, registerModel } from "../../utils/schema.js";

export const WISHLIST_MAX_PRODUCTS = 100;

const wishlistSchema = createSchema(
  {
    user: {
      ...ref("User", { required: true }),
      immutable: true,
    },
    productIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
      ],
      default: [],
      validate: [
        {
          validator(productIds) {
            return productIds.length <= WISHLIST_MAX_PRODUCTS;
          },
          message: `A wishlist may contain at most ${WISHLIST_MAX_PRODUCTS} products.`,
        },
        {
          validator(productIds) {
            const values = productIds.map((productId) => productId.toString());
            return values.length === new Set(values).size;
          },
          message: "Wishlist products must be unique.",
        },
      ],
    },
  },
  { collection: "wishlists" },
);

// Exactly one wishlist belongs to an account. This also closes the concurrent
// first-write race; the service retries the losing upsert as a normal update.
wishlistSchema.index({ user: 1 }, { unique: true });

export const Wishlist = registerModel("Wishlist", wishlistSchema);
