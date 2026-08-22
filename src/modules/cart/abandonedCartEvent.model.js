import mongoose from "mongoose";
import { createSchema, paise, ref, registerModel } from "../../utils/schema.js";
import { CART_MAX_LINES, CART_MAX_QUANTITY } from "./cart.model.js";

export const AbandonedCartEventState = Object.freeze({
  OPEN: "OPEN",
  CLEARED: "CLEARED",
  CONVERTED: "CONVERTED",
});

export const AbandonedCartValueStatus = Object.freeze({
  COMPLETE: "COMPLETE",
  UNAVAILABLE: "UNAVAILABLE",
});

const eventItemSchema = new mongoose.Schema(
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
    unitPricePaise: {
      ...paise(),
      default: null,
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const abandonedCartEventSchema = createSchema(
  {
    owner: {
      ...ref("User", { required: true }),
      immutable: true,
    },
    cartRevision: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "Cart revision must be a safe whole number.",
      },
    },
    state: {
      type: String,
      enum: Object.values(AbandonedCartEventState),
      required: true,
      default: AbandonedCartEventState.OPEN,
    },
    items: {
      type: [eventItemSchema],
      default: [],
      validate: [
        {
          validator(items) {
            return items.length <= CART_MAX_LINES;
          },
          message: `An abandoned-cart event may contain at most ${CART_MAX_LINES} variant lines.`,
        },
        {
          validator(items) {
            const variants = items.map((item) => item.variant.toString());
            return variants.length === new Set(variants).size;
          },
          message: "Abandoned-cart event variant lines must be unique.",
        },
      ],
    },
    valueStatus: {
      type: String,
      enum: Object.values(AbandonedCartValueStatus),
      required: true,
    },
    merchandiseValuePaise: {
      ...paise(),
      default: null,
    },
    lastActivityAt: {
      type: Date,
      required: true,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    convertedOrder: {
      ...ref("Order"),
      default: null,
    },
    purgeAt: {
      type: Date,
      required: true,
    },
  },
  { collection: "abandoned_cart_events" },
);

// This collection is the owner's current episode projection. A global owner
// uniqueness fence lets cartRevision serialize OPEN, CLEARED, and CONVERTED
// transitions without relying on millisecond timestamps.
abandonedCartEventSchema.index({ owner: 1 }, { unique: true });
abandonedCartEventSchema.index({ state: 1, lastActivityAt: 1 });
abandonedCartEventSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const AbandonedCartEvent = registerModel(
  "AbandonedCartEvent",
  abandonedCartEventSchema,
);
