import mongoose from "mongoose";
import { createSchema, ref, registerModel } from "../../utils/schema.js";

export const CART_MAX_LINES = 100;
export const CART_MAX_QUANTITY = 99;

const cartLineSchema = new mongoose.Schema(
  {
    product: ref("Product", { required: true }),
    variant: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: CART_MAX_QUANTITY,
      validate: {
        validator: Number.isInteger,
        message: "Cart quantity must be a whole number.",
      },
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const cartSchema = createSchema(
  {
    user: {
      ...ref("User", { required: true }),
      immutable: true,
    },
    lines: {
      type: [cartLineSchema],
      default: [],
      validate: [
        {
          validator(lines) {
            return lines.length <= CART_MAX_LINES;
          },
          message: `A cart may contain at most ${CART_MAX_LINES} variant lines.`,
        },
        {
          validator(lines) {
            const variants = lines.map((line) => line.variant.toString());
            return variants.length === new Set(variants).size;
          },
          message: "Cart variant lines must be unique.",
        },
      ],
    },
  },
  { collection: "carts" },
);

// Exactly one account-owned cart document. The service treats a duplicate-key
// loser during concurrent first creation as a normal retry against the winner.
cartSchema.index({ user: 1 }, { unique: true });

export const Cart = registerModel("Cart", cartSchema);
