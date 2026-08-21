import mongoose from "mongoose";
import {
  createSchema,
  paise,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";

export const PaymentProvider = Object.freeze({
  COD: "COD",
  MOCK_PREPAID: "MOCK_PREPAID",
  PHONEPE: "PHONEPE",
});

export const PaymentAttemptStatus = Object.freeze({
  PENDING: "PENDING",
  FAILED: "FAILED",
  CONFIRMED: "CONFIRMED",
  RECONCILIATION_REQUIRED: "RECONCILIATION_REQUIRED",
  REFUND_PENDING: "REFUND_PENDING",
  REFUNDED: "REFUNDED",
});

export const PaymentCurrency = Object.freeze({ INR: "INR" });

const historySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
      enum: Object.values(PaymentAttemptStatus),
    },
    reason: shortText({ max: 120 }),
    at: { type: Date, required: true, default: Date.now },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const paymentSchema = createSchema(
  {
    order: { ...ref("Order", { required: true }), immutable: true },
    user: { ...ref("User", { required: true }), immutable: true },
    provider: {
      type: String,
      required: true,
      enum: Object.values(PaymentProvider),
      immutable: true,
    },
    merchantReference: shortText({
      required: true,
      max: 64,
      immutable: true,
    }),
    providerPaymentId: shortText({ max: 100 }),
    providerRefundId: shortText({ max: 100 }),
    refundReference: shortText({
      required: true,
      max: 64,
      immutable: true,
    }),
    refundDispatchClaimedAt: Date,
    refundDispatchLeaseUntil: Date,
    refundDispatchAttempts: { type: Number, min: 0, default: 0 },
    idempotencyKeyHash: shortText({
      required: true,
      max: 64,
      immutable: true,
    }),
    requestFingerprint: shortText({
      required: true,
      max: 64,
      immutable: true,
    }),
    amountPaise: { ...paise({ required: true }), immutable: true },
    currency: {
      type: String,
      required: true,
      enum: Object.values(PaymentCurrency),
      immutable: true,
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(PaymentAttemptStatus),
      default: PaymentAttemptStatus.PENDING,
    },
    expiresAt: { type: Date, required: true },
    confirmedAt: Date,
    failedAt: Date,
    refundedAt: Date,
    history: { type: [historySchema], default: [] },
  },
  {
    collection: "payments",
    privateFields: ["idempotencyKeyHash", "requestFingerprint"],
  },
);

paymentSchema.index({ order: 1 }, { unique: true });
paymentSchema.index({ provider: 1, merchantReference: 1 }, { unique: true });
paymentSchema.index({ provider: 1, refundReference: 1 }, { unique: true });
paymentSchema.index({ user: 1, idempotencyKeyHash: 1 }, { unique: true });
paymentSchema.index(
  { provider: 1, providerPaymentId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerPaymentId: { $type: "string" } },
  },
);
paymentSchema.index(
  { provider: 1, providerRefundId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerRefundId: { $type: "string" } },
  },
);
paymentSchema.index({ status: 1, expiresAt: 1 });
paymentSchema.index({ user: 1, createdAt: -1, _id: -1 });

export const Payment = registerModel("Payment", paymentSchema);
