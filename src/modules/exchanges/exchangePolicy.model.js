import mongoose from "mongoose";
import { createSchema, registerModel, shortText } from "../../utils/schema.js";

export const EXCHANGE_POLICY_KEY = "CUSTOMER_EXCHANGE";

export const ExchangeReason = Object.freeze({
  SIZE_ISSUE: "SIZE_ISSUE",
  WRONG_PRODUCT_RECEIVED: "WRONG_PRODUCT_RECEIVED",
  DAMAGED_PRODUCT: "DAMAGED_PRODUCT",
  OTHER: "OTHER",
});

const reasonSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      enum: Object.values(ExchangeReason),
      immutable: true,
    },
    label: shortText({ required: true, max: 80, immutable: true }),
    minPhotos: {
      type: Number,
      required: true,
      min: 0,
      max: 5,
      immutable: true,
      validate: {
        validator: Number.isInteger,
        message: "Minimum photo count must be a whole number.",
      },
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const exchangePolicySchema = createSchema(
  {
    key: {
      type: String,
      required: true,
      enum: [EXCHANGE_POLICY_KEY],
      immutable: true,
    },
    enabled: { type: Boolean, required: true, default: false },
    version: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "Policy version must be a whole number.",
      },
    },
    windowDays: {
      type: Number,
      required: true,
      min: 0,
      max: 365,
      validate: {
        validator: Number.isInteger,
        message: "Exchange window must be a whole number of days.",
      },
    },
    reasons: {
      type: [reasonSchema],
      required: true,
      validate: {
        validator(reasons) {
          const codes = reasons.map((reason) => reason.code);
          return reasons.length > 0 && codes.length === new Set(codes).size;
        },
        message: "Exchange reasons must be present and unique.",
      },
    },
  },
  { collection: "exchangePolicies" },
);

exchangePolicySchema.index({ key: 1 }, { unique: true });
exchangePolicySchema.index({ enabled: 1, version: -1 });

export const ExchangePolicy = registerModel(
  "ExchangePolicy",
  exchangePolicySchema,
);
