import {
  createSchema,
  longText,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";
import { SupportStatus } from "./supportTicket.model.js";

export const SupportMessageVisibility = Object.freeze({
  PUBLIC: "PUBLIC",
  INTERNAL: "INTERNAL",
});

export const SupportMessageSender = Object.freeze({
  CUSTOMER: "CUSTOMER",
  SUPPORT: "SUPPORT",
});

export const SupportMessageOperation = Object.freeze({
  CREATE: "CREATE",
  CUSTOMER_REPLY: "CUSTOMER_REPLY",
  ADMIN_REPLY: "ADMIN_REPLY",
  INTERNAL_NOTE: "INTERNAL_NOTE",
});

const supportMessageSchema = createSchema(
  {
    ticket: { ...ref("SupportTicket", { required: true }), immutable: true },
    ticketNumber: shortText({ required: true, max: 64, immutable: true }),
    actor: { ...ref("User", { required: true }), immutable: true },
    authorName: shortText({ required: true, max: 80, immutable: true }),
    authorEmail: shortText({ required: true, max: 254, immutable: true }),
    authorRole: shortText({
      required: true,
      max: 20,
      enum: ["USER", "ADMIN"],
      immutable: true,
    }),
    sender: {
      type: String,
      required: true,
      enum: Object.values(SupportMessageSender),
      immutable: true,
    },
    visibility: {
      type: String,
      required: true,
      enum: Object.values(SupportMessageVisibility),
      immutable: true,
    },
    body: longText({ required: true, max: 4000, immutable: true }),
    operation: {
      type: String,
      required: true,
      enum: Object.values(SupportMessageOperation),
      immutable: true,
    },
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
    requestId: shortText({ required: true, max: 128, immutable: true }),
    ticketVersion: { type: Number, required: true, min: 0, immutable: true },
    ticketStatus: {
      type: String,
      required: true,
      enum: Object.values(SupportStatus),
      immutable: true,
    },
    purgeAt: { type: Date },
  },
  {
    collection: "supportMessages",
    privateFields: ["idempotencyKeyHash", "requestFingerprint", "requestId"],
  },
);

supportMessageSchema.index(
  { actor: 1, idempotencyKeyHash: 1 },
  { unique: true },
);
supportMessageSchema.index({ ticket: 1, createdAt: 1, _id: 1 });
supportMessageSchema.index({ ticket: 1, visibility: 1, createdAt: 1, _id: 1 });
supportMessageSchema.index({ requestId: 1 }, { unique: true });
supportMessageSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const SupportMessage = registerModel(
  "SupportMessage",
  supportMessageSchema,
);
