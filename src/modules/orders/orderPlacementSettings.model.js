import mongoose from "mongoose";
import {
  createSchema,
  paise,
  registerModel,
  shortText,
} from "../../utils/schema.js";

export const ORDER_PLACEMENT_SETTINGS_KEY = "ORDER_PLACEMENT";
const overrideSchema = new mongoose.Schema(
  {
    pincode: { type: String, required: true, match: /^[1-9]\d{5}$/ },
    chargePaise: paise({ required: true }),
  },
  { strict: "throw", _id: false, versionKey: false },
);
const methodSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, required: true, default: false },
    surchargePaise: paise({ required: true, default: 0 }),
  },
  { strict: "throw", _id: false, versionKey: false },
);

const schema = createSchema(
  {
    key: {
      type: String,
      required: true,
      enum: [ORDER_PLACEMENT_SETTINGS_KEY],
      default: ORDER_PLACEMENT_SETTINGS_KEY,
      immutable: true,
    },
    enabled: { type: Boolean, required: true, default: false },
    version: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "Version must be a whole number.",
      },
    },
    allowedState: shortText({ required: true, max: 80, enum: ["Karnataka"] }),
    flatDeliveryPaise: paise({ required: true }),
    freeDeliveryThresholdPaise: {
      type: Number,
      min: 0,
      max: 1_000_000_000,
      default: null,
      validate: {
        validator(value) {
          return (
            value === null || value === undefined || Number.isInteger(value)
          );
        },
        message: "Free-delivery threshold must be whole paise or null.",
      },
    },
    pincodeChargeOverrides: {
      type: [overrideSchema],
      default: [],
      validate: [
        {
          validator: (values) => values.length <= 500,
          message: "Keep at most 500 pincode overrides.",
        },
        {
          validator: (values) =>
            values.length ===
            new Set(values.map((value) => value.pincode)).size,
          message: "Pincode overrides must be unique.",
        },
      ],
    },
    cod: { type: methodSchema, required: true },
    prepaid: { type: methodSchema, required: true },
  },
  { collection: "orderPlacementSettings" },
);

schema.index({ key: 1 }, { unique: true });
export const OrderPlacementSettings = registerModel(
  "OrderPlacementSettings",
  schema,
);
