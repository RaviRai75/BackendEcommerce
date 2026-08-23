import {
  createSchema,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";
import { PaymentPayableType, PaymentProvider } from "./payment.model.js";

export const PaymentEventType = Object.freeze({
  PAYMENT_SUCCEEDED: "PAYMENT_SUCCEEDED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  REFUND_SUCCEEDED: "REFUND_SUCCEEDED",
});

export const PaymentEventStatus = Object.freeze({
  PROCESSED: "PROCESSED",
  IGNORED: "IGNORED",
  RECONCILIATION_REQUIRED: "RECONCILIATION_REQUIRED",
});

const paymentEventSchema = createSchema(
  {
    provider: {
      type: String,
      required: true,
      enum: Object.values(PaymentProvider),
      immutable: true,
    },
    eventId: shortText({ required: true, max: 100, immutable: true }),
    eventType: {
      type: String,
      required: true,
      enum: Object.values(PaymentEventType),
      immutable: true,
    },
    payloadHash: shortText({ required: true, max: 64, immutable: true }),
    payment: { ...ref("Payment", { required: true }), immutable: true },
    payableType: {
      type: String,
      enum: Object.values(PaymentPayableType),
      immutable: true,
    },
    order: { ...ref("Order"), immutable: true },
    customOrder: { ...ref("CustomOrder"), immutable: true },
    providerReference: shortText({
      required: true,
      max: 100,
      immutable: true,
    }),
    providerPaymentId: shortText({ max: 100, immutable: true }),
    status: {
      type: String,
      required: true,
      enum: Object.values(PaymentEventStatus),
      immutable: true,
    },
    occurredAt: { type: Date, required: true, immutable: true },
  },
  { collection: "paymentEvents", privateFields: ["payloadHash"] },
);

paymentEventSchema.pre("validate", function validatePayableReference(next) {
  const custom = this.payableType === PaymentPayableType.CUSTOM_ORDER;
  if (custom) {
    if (!this.customOrder)
      this.invalidate(
        "customOrder",
        "CUSTOM_ORDER payment events require a custom order.",
      );
    if (this.order)
      this.invalidate(
        "order",
        "CUSTOM_ORDER payment events cannot reference an order.",
      );
  } else {
    if (!this.order)
      this.invalidate("order", "ORDER payment events require an order.");
    if (this.customOrder)
      this.invalidate(
        "customOrder",
        "ORDER payment events cannot reference a custom order.",
      );
  }
  next();
});

paymentEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
paymentEventSchema.index({ payment: 1, occurredAt: -1 });
paymentEventSchema.index({ order: 1, occurredAt: -1 }, { sparse: true });
paymentEventSchema.index({ customOrder: 1, occurredAt: -1 }, { sparse: true });
paymentEventSchema.index({ status: 1, createdAt: 1 });

function rejectPaymentEventMutation() {
  throw new Error("Payment events are append-only.");
}
for (const operation of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
]) {
  paymentEventSchema.pre(operation, rejectPaymentEventMutation);
}
paymentEventSchema.pre(
  "deleteOne",
  { document: true, query: false },
  rejectPaymentEventMutation,
);
paymentEventSchema.pre("save", function preventExistingPaymentEventSave() {
  if (!this.isNew) rejectPaymentEventMutation();
});

export const PaymentEvent = registerModel("PaymentEvent", paymentEventSchema);
PaymentEvent.bulkWrite = async function rejectPaymentEventBulkMutation() {
  rejectPaymentEventMutation();
};
