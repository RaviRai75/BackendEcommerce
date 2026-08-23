import {
  createSchema,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";

export const NotificationAudience = Object.freeze({
  CUSTOMER: "CUSTOMER",
  ADMIN: "ADMIN",
});

export const NotificationTargetKind = Object.freeze({
  ORDER: "ORDER",
  EXCHANGE: "EXCHANGE",
  PRODUCT: "PRODUCT",
  ACCOUNT: "ACCOUNT",
  SUPPORT_TICKET: "SUPPORT_TICKET",
  CUSTOM_REQUEST: "CUSTOM_REQUEST",
});

export const NotificationType = Object.freeze({
  ORDER_CONFIRMATION: "ORDER_CONFIRMATION",
  ORDER_PAYMENT_CONFIRMED: "ORDER_PAYMENT_CONFIRMED",
  ORDER_SHIPPED: "ORDER_SHIPPED",
  ORDER_OUT_FOR_DELIVERY: "ORDER_OUT_FOR_DELIVERY",
  ORDER_DELIVERED: "ORDER_DELIVERED",
  EXCHANGE_REQUESTED: "EXCHANGE_REQUESTED",
  EXCHANGE_INFORMATION_REQUESTED: "EXCHANGE_INFORMATION_REQUESTED",
  EXCHANGE_APPROVED: "EXCHANGE_APPROVED",
  EXCHANGE_FEE_DUE: "EXCHANGE_FEE_DUE",
  EXCHANGE_FEE_PAID: "EXCHANGE_FEE_PAID",
  EXCHANGE_REVERSE_PICKUP: "EXCHANGE_REVERSE_PICKUP",
  EXCHANGE_RECEIVED: "EXCHANGE_RECEIVED",
  EXCHANGE_QC_PASSED: "EXCHANGE_QC_PASSED",
  EXCHANGE_QC_FAILED: "EXCHANGE_QC_FAILED",
  EXCHANGE_REPLACEMENT_SHIPPED: "EXCHANGE_REPLACEMENT_SHIPPED",
  EXCHANGE_COMPLETED: "EXCHANGE_COMPLETED",
  EXCHANGE_REJECTED: "EXCHANGE_REJECTED",
  ADMIN_NEW_ORDER: "ADMIN_NEW_ORDER",
  ADMIN_PAYMENT_CONFIRMED: "ADMIN_PAYMENT_CONFIRMED",
  ADMIN_NEW_EXCHANGE: "ADMIN_NEW_EXCHANGE",
  ADMIN_LOW_STOCK: "ADMIN_LOW_STOCK",
  SUPPORT_TICKET_CREATED: "SUPPORT_TICKET_CREATED",
  SUPPORT_ADMIN_REPLIED: "SUPPORT_ADMIN_REPLIED",
  SUPPORT_STATUS_CHANGED: "SUPPORT_STATUS_CHANGED",
  ADMIN_NEW_SUPPORT_TICKET: "ADMIN_NEW_SUPPORT_TICKET",
  ADMIN_SUPPORT_CUSTOMER_REPLIED: "ADMIN_SUPPORT_CUSTOMER_REPLIED",
  CUSTOM_REQUEST_SUBMITTED: "CUSTOM_REQUEST_SUBMITTED",
  CUSTOM_REQUEST_ADMIN_REPLIED: "CUSTOM_REQUEST_ADMIN_REPLIED",
  CUSTOM_REQUEST_INFORMATION_NEEDED: "CUSTOM_REQUEST_INFORMATION_NEEDED",
  CUSTOM_REQUEST_QUOTE_READY: "CUSTOM_REQUEST_QUOTE_READY",
  CUSTOM_REQUEST_STATUS_CHANGED: "CUSTOM_REQUEST_STATUS_CHANGED",
  CUSTOM_REQUEST_PAYMENT_CONFIRMED: "CUSTOM_REQUEST_PAYMENT_CONFIRMED",
  ADMIN_NEW_CUSTOM_REQUEST: "ADMIN_NEW_CUSTOM_REQUEST",
  ADMIN_CUSTOM_REQUEST_CUSTOMER_REPLIED:
    "ADMIN_CUSTOM_REQUEST_CUSTOMER_REPLIED",
  ADMIN_CUSTOM_QUOTE_ACCEPTED: "ADMIN_CUSTOM_QUOTE_ACCEPTED",
  ADMIN_CUSTOM_PAYMENT_CONFIRMED: "ADMIN_CUSTOM_PAYMENT_CONFIRMED",
  PASSWORD_RESET: "PASSWORD_RESET",
});

const targetSchema = createSchema(
  {
    kind: {
      type: String,
      required: true,
      enum: Object.values(NotificationTargetKind),
    },
    reference: shortText({ required: true, max: 160 }),
  },
  { timestamps: false, schemaOptions: { _id: false } },
);

const notificationSchema = createSchema(
  {
    owner: ref("User", { required: true, index: true }),
    type: {
      type: String,
      required: true,
      enum: Object.values(NotificationType),
      immutable: true,
    },
    audience: {
      type: String,
      required: true,
      enum: Object.values(NotificationAudience),
      immutable: true,
    },
    title: shortText({ required: true, max: 120, immutable: true }),
    message: shortText({ required: true, max: 500, immutable: true }),
    target: { type: targetSchema, required: true, immutable: true },
    eventKey: shortText({ required: true, max: 240, immutable: true }),
    dedupeKey: shortText({ required: true, max: 64, immutable: true }),
    semanticHash: shortText({ required: true, max: 64, immutable: true }),
    occurredAt: { type: Date, required: true, immutable: true },
    readAt: { type: Date },
    purgeAt: { type: Date, required: true, immutable: true },
  },
  { collection: "notifications" },
);

notificationSchema.index({ dedupeKey: 1 }, { unique: true });
notificationSchema.index({ owner: 1, createdAt: -1, _id: -1 });
notificationSchema.index({ owner: 1, readAt: 1, createdAt: -1, _id: -1 });
notificationSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const Notification = registerModel("Notification", notificationSchema);
