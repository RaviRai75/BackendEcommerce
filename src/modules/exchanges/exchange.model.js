import mongoose from "mongoose";
import {
  createSchema,
  longText,
  paise,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";
import { ExchangeReason } from "./exchangePolicy.model.js";

export const ExchangeStatus = Object.freeze({
  REQUESTED: "REQUESTED",
  INFORMATION_REQUESTED: "INFORMATION_REQUESTED",
  APPROVED: "APPROVED",
  FEE_DUE: "FEE_DUE",
  FEE_PAID: "FEE_PAID",
  REVERSE_PICKUP: "REVERSE_PICKUP",
  RECEIVED: "RECEIVED",
  QC_PASSED: "QC_PASSED",
  QC_FAILED: "QC_FAILED",
  REPLACEMENT_SHIPPED: "REPLACEMENT_SHIPPED",
  COMPLETED: "COMPLETED",
  REJECTED: "REJECTED",
});

export const ExchangeAction = Object.freeze({
  REQUEST_INFORMATION: "REQUEST_INFORMATION",
  APPROVE: "APPROVE",
  REJECT: "REJECT",
  RECORD_FEE: "RECORD_FEE",
  RECORD_REVERSE_SHIPMENT: "RECORD_REVERSE_SHIPMENT",
  MARK_RECEIVED: "MARK_RECEIVED",
  UPDATE_QC: "UPDATE_QC",
  RECORD_REPLACEMENT_SHIPMENT: "RECORD_REPLACEMENT_SHIPMENT",
  COMPLETE: "COMPLETE",
});

export const ExchangeQcResult = Object.freeze({
  PASSED: "PASSED",
  FAILED: "FAILED",
});

const lineSnapshotSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    productName: shortText({ required: true, max: 160, immutable: true }),
    sku: shortText({ required: true, max: 64, immutable: true }),
    size: shortText({ required: true, max: 30, immutable: true }),
    colour: shortText({ required: true, max: 60, immutable: true }),
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 99,
      immutable: true,
    },
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
    action: { type: String, enum: Object.values(ExchangeAction) },
    status: {
      type: String,
      required: true,
      enum: Object.values(ExchangeStatus),
    },
    at: { type: Date, required: true },
    actor: ref("User"),
    // Internal commit-reconciliation fields. DTO allowlists deliberately omit
    // both values from customer and administrator responses.
    requestId: shortText({ max: 128 }),
    version: { type: Number, min: 1 },
    publicMessage: longText({ max: 500 }),
    internalNote: longText({ max: 1000 }),
  },
  { strict: "throw", _id: false, versionKey: false },
);

const policySnapshotSchema = new mongoose.Schema(
  {
    key: shortText({ required: true, max: 40, immutable: true }),
    version: { type: Number, required: true, min: 1, immutable: true },
    windowDays: {
      type: Number,
      required: true,
      min: 0,
      max: 365,
      immutable: true,
    },
    reason: {
      type: String,
      required: true,
      enum: Object.values(ExchangeReason),
      immutable: true,
    },
    reasonLabel: shortText({ required: true, max: 80, immutable: true }),
    minPhotos: {
      type: Number,
      required: true,
      min: 0,
      max: 5,
      immutable: true,
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const feeSchema = new mongoose.Schema(
  {
    amountPaise: { ...paise({ required: true }), immutable: true },
    currency: {
      type: String,
      required: true,
      enum: ["INR"],
      immutable: true,
    },
    recordedAt: { type: Date, required: true, immutable: true },
    recordedBy: { ...ref("User", { required: true }), immutable: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const shipmentSchema = new mongoose.Schema(
  {
    courier: shortText({ required: true, max: 100, immutable: true }),
    awb: shortText({ required: true, max: 200, immutable: true }),
    trackingId: shortText({ required: true, max: 200, immutable: true }),
    shipmentId: shortText({ required: true, max: 200, immutable: true }),
    trackingStatus: shortText({ max: 120 }),
    recordedAt: { type: Date, required: true, immutable: true },
    recordedBy: { ...ref("User", { required: true }), immutable: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const qcSchema = new mongoose.Schema(
  {
    result: {
      type: String,
      required: true,
      enum: Object.values(ExchangeQcResult),
      immutable: true,
    },
    recordedAt: { type: Date, required: true, immutable: true },
    recordedBy: { ...ref("User", { required: true }), immutable: true },
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
    },
    history: { type: [historySchema], required: true },
    fee: { type: feeSchema, default: undefined },
    reverseShipment: { type: shipmentSchema, default: undefined },
    replacementShipment: { type: shipmentSchema, default: undefined },
    qc: { type: qcSchema, default: undefined },
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
exchangeSchema.index({ createdAt: -1, _id: -1 });
exchangeSchema.index({ deliveredAt: -1 });
exchangeSchema.index({ "photos.assetId": 1 });

export const Exchange = registerModel("Exchange", exchangeSchema);
