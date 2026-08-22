import mongoose from "mongoose";
import {
  createSchema,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";

export const SupportCategory = Object.freeze({
  ORDER: "ORDER",
  DELIVERY: "DELIVERY",
  EXCHANGE: "EXCHANGE",
  PAYMENT: "PAYMENT",
  CUSTOMIZATION: "CUSTOMIZATION",
  PRODUCT: "PRODUCT",
  SIZE: "SIZE",
  TECHNICAL: "TECHNICAL",
  ACCOUNT: "ACCOUNT",
  OTHER: "OTHER",
});

export const SupportStatus = Object.freeze({
  OPEN: "OPEN",
  WAITING_FOR_SUPPORT: "WAITING_FOR_SUPPORT",
  WAITING_FOR_CUSTOMER: "WAITING_FOR_CUSTOMER",
  IN_PROGRESS: "IN_PROGRESS",
  RESOLVED: "RESOLVED",
  CLOSED: "CLOSED",
});

export const SupportPriority = Object.freeze({
  LOW: "LOW",
  NORMAL: "NORMAL",
  HIGH: "HIGH",
  URGENT: "URGENT",
});

export const SupportContextKind = Object.freeze({
  ORDER: "ORDER",
  EXCHANGE: "EXCHANGE",
  CUSTOM_REQUEST: "CUSTOM_REQUEST",
});

export const SupportResponder = Object.freeze({
  CUSTOMER: "CUSTOMER",
  SUPPORT: "SUPPORT",
});

export const SupportAction = Object.freeze({
  CREATE: "CREATE",
  CUSTOMER_REPLY: "CUSTOMER_REPLY",
  ADMIN_REPLY: "ADMIN_REPLY",
  INTERNAL_NOTE: "INTERNAL_NOTE",
  START_PROGRESS: "START_PROGRESS",
  RESOLVE: "RESOLVE",
  CLOSE: "CLOSE",
  REOPEN: "REOPEN",
  SET_PRIORITY: "SET_PRIORITY",
});

const contextSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      required: true,
      enum: Object.values(SupportContextKind),
      immutable: true,
    },
    reference: shortText({ required: true, max: 64, immutable: true }),
    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const countersSchema = new mongoose.Schema(
  {
    publicMessages: { type: Number, required: true, min: 0, default: 0 },
    internalMessages: { type: Number, required: true, min: 0, default: 0 },
    customerMessages: { type: Number, required: true, min: 0, default: 0 },
    supportMessages: { type: Number, required: true, min: 0, default: 0 },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const activitySchema = new mongoose.Schema(
  {
    lastMessageAt: { type: Date, required: true },
    lastPublicMessageAt: { type: Date, required: true },
    lastCustomerMessageAt: { type: Date, required: true },
    lastSupportMessageAt: { type: Date },
    lastResponder: {
      type: String,
      required: true,
      enum: Object.values(SupportResponder),
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const historySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: Object.values(SupportAction),
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(SupportStatus),
    },
    priority: {
      type: String,
      required: true,
      enum: Object.values(SupportPriority),
    },
    at: { type: Date, required: true },
    actor: ref("User", { required: true }),
    requestId: shortText({ required: true, max: 128 }),
    version: { type: Number, required: true, min: 0 },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const supportTicketSchema = createSchema(
  {
    ticketNumber: shortText({ required: true, max: 64, immutable: true }),
    owner: { ...ref("User", { required: true }), immutable: true },
    category: {
      type: String,
      required: true,
      enum: Object.values(SupportCategory),
      immutable: true,
    },
    subject: shortText({ required: true, max: 160, immutable: true }),
    context: { type: contextSchema, default: undefined, immutable: true },
    status: {
      type: String,
      required: true,
      enum: Object.values(SupportStatus),
      default: SupportStatus.OPEN,
    },
    priority: {
      type: String,
      required: true,
      enum: Object.values(SupportPriority),
      default: SupportPriority.NORMAL,
    },
    counters: { type: countersSchema, required: true },
    activity: { type: activitySchema, required: true },
    history: { type: [historySchema], required: true },
    creationIdempotencyKeyHash: shortText({
      required: true,
      max: 64,
      immutable: true,
    }),
    creationFingerprint: shortText({
      required: true,
      max: 64,
      immutable: true,
    }),
    purgeAt: { type: Date },
  },
  {
    collection: "supportTickets",
    privateFields: ["creationIdempotencyKeyHash", "creationFingerprint"],
  },
);

supportTicketSchema.index({ ticketNumber: 1 }, { unique: true });
supportTicketSchema.index(
  { owner: 1, creationIdempotencyKeyHash: 1 },
  { unique: true },
);
supportTicketSchema.index({
  owner: 1,
  "activity.lastPublicMessageAt": -1,
  _id: -1,
});
supportTicketSchema.index({ status: 1, priority: 1, updatedAt: -1, _id: -1 });
supportTicketSchema.index({ category: 1, updatedAt: -1, _id: -1 });
supportTicketSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const SupportTicket = registerModel(
  "SupportTicket",
  supportTicketSchema,
);
