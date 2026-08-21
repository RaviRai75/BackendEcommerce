import mongoose from "mongoose";
import {
  createSchema,
  longText,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";
import { ExchangeReason } from "./exchangePolicy.model.js";

export const ExchangeStatus = Object.freeze({ REQUESTED: "REQUESTED" });

const lineSnapshotSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    productName: shortText({ required: true, max: 160, immutable: true }),
    sku: shortText({ required: true, max: 64, immutable: true }),
    size: shortText({ required: true, max: 30, immutable: true }),
    colour: shortText({ required: true, max: 60, immutable: true }),
    quantity: { type: Number, required: true, min: 1, max: 99, immutable: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const photoSchema = new mongoose.Schema(
  {
    assetId: { ...ref("MediaAsset", { required: true }), immutable: true },
    publicId: shortText({ required: true, max: 255, immutable: true }),
    url: shortText({ required: true, max: 1000, immutable: true }),
  },
  { strict: "throw", _id: false, versionKey: false },
);

const historySchema = new mongoose.Schema(
  {
    status: { type: String, required: true, enum: Object.values(ExchangeStatus) },
    at: { type: Date, required: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const policySnapshotSchema = new mongoose.Schema(
  {
    key: shortText({ required: true, max: 40, immutable: true }),
    version: { type: Number, required: true, min: 1, immutable: true },
    windowDays: { type: Number, required: true, min: 0, max: 365, immutable: true },
    reason: {
      type: String,
      required: true,
      enum: Object.values(ExchangeReason),
      immutable: true,
    },
    reasonLabel: shortText({ required: true, max: 80, immutable: true }),
    minPhotos: { type: Number, required: true, min: 0, max: 5, immutable: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const exchangeSchema = createSchema(
  {
    exchangeNumber: shortText({ required: true, max: 48, immutable: true }),
    user: { ...ref("User", { required: true }), immutable: true },
    order: { ...ref("Order", { required: true }), immutable: true },
    orderNumber: shortText({ required: true, max: 48, immutable: true }),
    lineToken: shortText({ required: true, max: 128, immutable: true }),
    idempotencyKeyHash: shortText({ required: true, max: 64, immutable: true }),
    requestFingerprint: shortText({ required: true, max: 64, immutable: true }),
    source: { type: lineSnapshotSchema, required: true, immutable: true },
    replacement: { type: lineSnapshotSchema, required: true, immutable: true },
    policy: { type: policySnapshotSchema, required: true, immutable: true },
    deliveredAt: { type: Date, required: true, immutable: true },
    windowEndsAt: { type: Date, required: true, immutable: true },
    reason: {
      type: String,
      required: true,
      enum: Object.values(ExchangeReason),
      immutable: true,
    },
    comment: longText({ max: 500, immutable: true }),
    photos: { type: [photoSchema], default: [], immutable: true },
    status: {
      type: String,
      required: true,
      enum: Object.values(ExchangeStatus),
      default: ExchangeStatus.REQUESTED,
      immutable: true,
    },
    history: { type: [historySchema], required: true, immutable: true },
  },
  {
    collection: "exchanges",
    privateFields: ["idempotencyKeyHash", "requestFingerprint"],
  },
);

exchangeSchema.index({ exchangeNumber: 1 }, { unique: true });
exchangeSchema.index({ user: 1, idempotencyKeyHash: 1 }, { unique: true });
exchangeSchema.index({ order: 1, lineToken: 1 }, { unique: true });
exchangeSchema.index({ user: 1, createdAt: -1, _id: -1 });
exchangeSchema.index({ status: 1, createdAt: -1, _id: -1 });
exchangeSchema.index({ "photos.assetId": 1 });

export const Exchange = registerModel("Exchange", exchangeSchema);
