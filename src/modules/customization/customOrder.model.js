import mongoose from "mongoose";
import { editorialSnapshotSchema } from "../content/contentPage.model.js";
import {
  createSchema,
  longText,
  paise,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";

export const CustomOrderPaymentStatus = Object.freeze({
  PREPAID_PENDING: "PREPAID_PENDING",
  PREPAID_CONFIRMED: "PREPAID_CONFIRMED",
  CANCELLED: "CANCELLED",
});
export const CustomProductionStatus = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  IN_PRODUCTION: "IN_PRODUCTION",
  QUALITY_CHECK: "QUALITY_CHECK",
  READY_TO_SHIP: "READY_TO_SHIP",
});
export const CustomFulfillmentStatus = Object.freeze({
  UNFULFILLED: "UNFULFILLED",
  SHIPPED: "SHIPPED",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
});
export const CustomCompletionStatus = Object.freeze({
  OPEN: "OPEN",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
});

const addressSchema = new mongoose.Schema(
  {
    recipientName: shortText({ required: true, max: 80, immutable: true }),
    phone: shortText({ required: true, max: 10, immutable: true }),
    email: shortText({
      required: true,
      max: 254,
      lowercase: true,
      immutable: true,
    }),
    addressLine1: shortText({ required: true, max: 180, immutable: true }),
    addressLine2: shortText({ max: 180, immutable: true }),
    landmark: shortText({ max: 120, immutable: true }),
    city: shortText({ required: true, max: 80, immutable: true }),
    district: shortText({ required: true, max: 80, immutable: true }),
    state: shortText({ required: true, max: 80, immutable: true }),
    pincode: shortText({ required: true, max: 6, immutable: true }),
  },
  { strict: "throw", _id: false, versionKey: false },
);
const quoteChargesSchema = new mongoose.Schema(
  {
    basePaise: { ...paise({ required: true }), immutable: true },
    customizationPaise: { ...paise({ required: true }), immutable: true },
    materialPaise: { ...paise({ required: true }), immutable: true },
    otherPaise: { ...paise({ required: true }), immutable: true },
    shippingPaise: { ...paise({ required: true }), immutable: true },
    discountPaise: { ...paise({ required: true }), immutable: true },
    finalPaise: { ...paise({ required: true }), immutable: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);
const quotePolicySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      enum: ["CUSTOMIZATION_POLICY"],
      immutable: true,
    },
    revision: { type: Number, required: true, min: 1, immutable: true },
    hash: shortText({ required: true, max: 64, immutable: true }),
    publishedAt: { type: Date, required: true, immutable: true },
    snapshot: {
      type: editorialSnapshotSchema,
      required: true,
      immutable: true,
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);
const quoteSchema = new mongoose.Schema(
  {
    quoteId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    revision: { type: Number, required: true, min: 1, immutable: true },
    charges: { type: quoteChargesSchema, default: undefined, immutable: true },
    finalPaise: { ...paise({ required: true }), immutable: true },
    currency: { type: String, required: true, enum: ["INR"], immutable: true },
    productionEstimate: longText({ max: 500, immutable: true }),
    deliveryEstimate: longText({ max: 500, immutable: true }),
    expiryDays: { type: Number, min: 1, max: 90, immutable: true },
    sentAt: { type: Date, immutable: true },
    expiresAt: { type: Date, immutable: true },
    policy: { type: quotePolicySchema, default: undefined, immutable: true },
    policyRevision: { type: Number, required: true, min: 1, immutable: true },
    policyHash: shortText({ required: true, max: 64, immutable: true }),
  },
  { strict: "throw", _id: false, versionKey: false },
);
const historySchema = new mongoose.Schema(
  {
    axis: {
      type: String,
      required: true,
      enum: ["PAYMENT", "PRODUCTION", "FULFILLMENT", "COMPLETION"],
    },
    status: shortText({ required: true, max: 40 }),
    action: shortText({ required: true, max: 60 }),
    at: { type: Date, required: true },
    actor: ref("User"),
    requestId: shortText({ required: true, max: 128 }),
    version: { type: Number, required: true, min: 0 },
  },
  { strict: "throw", _id: false, versionKey: false },
);
const schema = createSchema(
  {
    orderNumber: shortText({ required: true, max: 48, immutable: true }),
    request: { ...ref("CustomRequest", { required: true }), immutable: true },
    requestNumber: shortText({ required: true, max: 48, immutable: true }),
    owner: { ...ref("User", { required: true }), immutable: true },
    quote: { type: quoteSchema, required: true, immutable: true },
    shippingAddress: { type: addressSchema, required: true, immutable: true },
    paymentMethod: {
      type: String,
      required: true,
      enum: ["PREPAID"],
      default: "PREPAID",
      immutable: true,
    },
    paymentStatus: {
      type: String,
      required: true,
      enum: Object.values(CustomOrderPaymentStatus),
      default: CustomOrderPaymentStatus.PREPAID_PENDING,
    },
    productionStatus: {
      type: String,
      required: true,
      enum: Object.values(CustomProductionStatus),
      default: CustomProductionStatus.NOT_STARTED,
    },
    fulfillmentStatus: {
      type: String,
      required: true,
      enum: Object.values(CustomFulfillmentStatus),
      default: CustomFulfillmentStatus.UNFULFILLED,
    },
    completionStatus: {
      type: String,
      required: true,
      enum: Object.values(CustomCompletionStatus),
      default: CustomCompletionStatus.OPEN,
    },
    paidAt: Date,
    shippedAt: Date,
    outForDeliveryAt: Date,
    deliveredAt: Date,
    completedAt: Date,
    cancelledAt: Date,
    history: { type: [historySchema], default: [] },
    acceptanceIdempotencyKeyHash: shortText({
      required: true,
      max: 64,
      immutable: true,
    }),
    acceptanceFingerprint: shortText({
      required: true,
      max: 64,
      immutable: true,
    }),
  },
  {
    collection: "customOrders",
    privateFields: ["acceptanceIdempotencyKeyHash", "acceptanceFingerprint"],
  },
);
schema.pre("validate", function validateNewAcceptedQuoteSnapshot(next) {
  if (this.isNew) {
    const quote = this.quote;
    if (!quote?.charges)
      this.invalidate(
        "quote.charges",
        "New custom orders require complete accepted quote charges.",
      );
    if (!quote?.policy)
      this.invalidate(
        "quote.policy",
        "New custom orders require accepted policy evidence.",
      );
    if (!quote?.policy?.publishedAt || !quote?.policy?.snapshot)
      this.invalidate(
        "quote.policy",
        "New custom orders require a complete accepted policy snapshot.",
      );
    if (!quote?.expiryDays || !quote?.sentAt || !quote?.expiresAt)
      this.invalidate(
        "quote",
        "New custom orders require sent and expiry evidence.",
      );
    if (quote?.charges?.finalPaise !== quote?.finalPaise)
      this.invalidate("quote.finalPaise", "Accepted quote totals must match.");
    if (
      quote?.policy &&
      (quote.policy.revision !== quote.policyRevision ||
        quote.policy.hash !== quote.policyHash)
    )
      this.invalidate("quote.policy", "Accepted policy evidence must match.");
  }
  next();
});
schema.index({ orderNumber: 1 }, { unique: true });
schema.index({ request: 1 }, { unique: true });
schema.index({ owner: 1, acceptanceIdempotencyKeyHash: 1 }, { unique: true });
schema.index({ owner: 1, createdAt: -1, _id: -1 });
schema.index({
  paymentStatus: 1,
  productionStatus: 1,
  fulfillmentStatus: 1,
  createdAt: -1,
});
export const CustomOrder = registerModel("CustomOrder", schema);
