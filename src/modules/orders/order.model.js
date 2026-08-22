import mongoose from "mongoose";
import {
  createSchema,
  paise,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";
import { EXCHANGE_POLICY_KEY } from "../exchanges/exchangePolicy.model.js";

export const EXCHANGE_LINE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

export const OrderPlacementStatus = Object.freeze({
  PLACED: "PLACED",
  RELEASED: "RELEASED",
});
export const OrderPaymentStatus = Object.freeze({
  COD_DUE: "COD_DUE",
  PREPAID_PENDING: "PREPAID_PENDING",
  PREPAID_CONFIRMED: "PREPAID_CONFIRMED",
  CANCELLED: "CANCELLED",
});
export const OrderFulfillmentStatus = Object.freeze({
  UNFULFILLED: "UNFULFILLED",
  PROCESSING: "PROCESSING",
  PACKED: "PACKED",
  SHIPPED: "SHIPPED",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
});
export const OrderFulfillmentAction = Object.freeze({
  START_PROCESSING: "START_PROCESSING",
  MARK_PACKED: "MARK_PACKED",
  RECORD_SHIPMENT: "RECORD_SHIPMENT",
  MARK_OUT_FOR_DELIVERY: "MARK_OUT_FOR_DELIVERY",
  MARK_DELIVERED: "MARK_DELIVERED",
  CANCEL: "CANCEL",
});
export const OrderPaymentMethod = Object.freeze({
  COD: "COD",
  PREPAID: "PREPAID",
});

const entitlementReasonSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      enum: [
        "SIZE_ISSUE",
        "WRONG_PRODUCT_RECEIVED",
        "DAMAGED_PRODUCT",
        "OTHER",
      ],
      immutable: true,
    },
    label: shortText({ required: true, max: 80, immutable: true }),
    minPhotos: {
      type: Number,
      required: true,
      min: 0,
      max: 5,
      immutable: true,
      validate: { validator: Number.isInteger },
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const exchangeEntitlementSchema = new mongoose.Schema(
  {
    eligible: { type: Boolean, required: true, immutable: true },
    productEligible: { type: Boolean, required: true, immutable: true },
    policyAvailable: { type: Boolean, required: true, immutable: true },
    policyKey: shortText({
      max: 40,
      enum: [EXCHANGE_POLICY_KEY],
      immutable: true,
    }),
    policyVersion: { type: Number, min: 1, immutable: true },
    windowDays: { type: Number, min: 0, max: 365, immutable: true },
    reasons: { type: [entitlementReasonSchema], default: [], immutable: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const itemSchema = new mongoose.Schema(
  {
    lineToken: shortText({
      max: 128,
      match: EXCHANGE_LINE_TOKEN_PATTERN,
      immutable: true,
    }),
    exchangeEntitlement: {
      type: exchangeEntitlementSchema,
      immutable: true,
      default: undefined,
    },
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
    unitPricePaise: { ...paise({ required: true }), immutable: true },
    compareAtUnitPricePaise: { ...paise(), immutable: true },
    lineMerchandiseSubtotalPaise: {
      ...paise({ required: true }),
      immutable: true,
    },
    lineCompareAtSubtotalPaise: {
      ...paise({ required: true }),
      immutable: true,
    },
    lineProductDiscountPaise: { ...paise({ required: true }), immutable: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);

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

const pricingSchema = new mongoose.Schema(
  {
    merchandiseSubtotalPaise: { ...paise({ required: true }), immutable: true },
    compareAtSubtotalPaise: { ...paise({ required: true }), immutable: true },
    productDiscountPaise: { ...paise({ required: true }), immutable: true },
    couponDiscountPaise: { ...paise({ required: true }), immutable: true },
    merchandiseAfterCouponPaise: {
      ...paise({ required: true }),
      immutable: true,
    },
    deliveryChargePaise: { ...paise({ required: true }), immutable: true },
    codSurchargePaise: { ...paise({ required: true }), immutable: true },
    finalTotalPaise: { ...paise({ required: true }), immutable: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const couponSnapshotSchema = new mongoose.Schema(
  {
    couponId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    code: shortText({ required: true, max: 32, immutable: true }),
    discountType: shortText({ required: true, max: 20, immutable: true }),
    percentageBasisPoints: { type: Number, immutable: true },
    flatDiscountPaise: { ...paise(), immutable: true },
    discountPaise: { ...paise({ required: true }), immutable: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const historySchema = new mongoose.Schema(
  {
    domain: {
      type: String,
      required: true,
      enum: ["PLACEMENT", "PAYMENT", "FULFILLMENT"],
    },
    status: shortText({ required: true, max: 40 }),
    reason: shortText({ max: 160 }),
    at: { type: Date, required: true, default: Date.now },
    action: {
      type: String,
      enum: Object.values(OrderFulfillmentAction),
    },
    actor: ref("User"),
    // Private commit-reconciliation fields. Every API DTO deliberately omits
    // these even from administrator responses.
    requestId: shortText({ max: 128 }),
    version: { type: Number, min: 1 },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const orderSchema = createSchema(
  {
    orderNumber: shortText({ required: true, max: 48, immutable: true }),
    user: { ...ref("User", { required: true }), immutable: true },
    idempotencyKeyHash: shortText({ required: true, max: 64, immutable: true }),
    requestFingerprint: shortText({ required: true, max: 64, immutable: true }),
    customerOrderSequence: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
    },
    settingsVersion: { type: Number, required: true, min: 1, immutable: true },
    paymentMethod: {
      type: String,
      required: true,
      enum: Object.values(OrderPaymentMethod),
      immutable: true,
    },
    items: { type: [itemSchema], required: true, immutable: true },
    shippingAddress: { type: addressSchema, required: true, immutable: true },
    pricing: { type: pricingSchema, required: true, immutable: true },
    coupon: { type: couponSnapshotSchema, default: null, immutable: true },
    placementStatus: {
      type: String,
      required: true,
      enum: Object.values(OrderPlacementStatus),
      default: OrderPlacementStatus.PLACED,
    },
    paymentStatus: {
      type: String,
      required: true,
      enum: Object.values(OrderPaymentStatus),
    },
    fulfillmentStatus: {
      type: String,
      required: true,
      enum: Object.values(OrderFulfillmentStatus),
      default: OrderFulfillmentStatus.UNFULFILLED,
    },
    statusHistory: { type: [historySchema], default: [] },
    itemCount: { type: Number, required: true, min: 1, immutable: true },
    cartCleared: { type: Boolean, required: true, immutable: true },
    paidAt: Date,
    deliveredAt: Date,
    releasedAt: Date,
    releaseReason: shortText({ max: 160 }),
  },
  {
    collection: "orders",
    privateFields: ["idempotencyKeyHash", "requestFingerprint"],
  },
);

orderSchema.path("items").validate(function uniqueExchangeLineTokens(items) {
  const tokens = (items ?? []).map((item) => item.lineToken).filter(Boolean);
  return tokens.length === new Set(tokens).size;
}, "Exchange line tokens must be unique within an order.");

orderSchema.index({ orderNumber: 1 }, { unique: true });
orderSchema.index({ user: 1, idempotencyKeyHash: 1 }, { unique: true });
orderSchema.index({ user: 1, customerOrderSequence: 1 }, { unique: true });
orderSchema.index({ user: 1, createdAt: -1, _id: -1 });
orderSchema.index({ createdAt: -1, _id: -1 });
orderSchema.index({ placementStatus: 1, fulfillmentStatus: 1, createdAt: 1 });
orderSchema.index({
  fulfillmentStatus: 1,
  paymentStatus: 1,
  createdAt: -1,
  _id: -1,
});
orderSchema.index({
  placementStatus: 1,
  fulfillmentStatus: 1,
  paymentMethod: 1,
  paymentStatus: 1,
  deliveredAt: -1,
});

export const Order = registerModel("Order", orderSchema);
