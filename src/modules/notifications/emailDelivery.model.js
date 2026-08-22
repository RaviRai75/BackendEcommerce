import { createSchema, ref, registerModel, shortText } from "../../utils/schema.js";
import { NotificationAudience, NotificationType } from "./notification.model.js";

export const EmailDeliveryStatus = Object.freeze({
  PENDING: "PENDING",
  CLAIMED: "CLAIMED",
  SENT: "SENT",
  DEAD: "DEAD",
  SUPERSEDED: "SUPERSEDED",
});

const emailDeliverySchema = createSchema(
  {
    eventKey: shortText({ required: true, max: 240, immutable: true }),
    dedupeKey: shortText({ required: true, max: 64, immutable: true }),
    semanticHash: shortText({ required: true, max: 64, immutable: true }),
    recipientUser: ref("User", { index: true }),
    audience: {
      type: String,
      required: true,
      enum: Object.values(NotificationAudience),
      immutable: true,
    },
    type: {
      type: String,
      required: true,
      enum: Object.values(NotificationType),
      immutable: true,
    },
    templateKey: shortText({ required: true, max: 80, immutable: true }),
    templateVersion: { type: Number, required: true, min: 1, immutable: true },
    keyId: shortText({ required: true, max: 80, select: false }),
    iv: { type: Buffer, required: true, select: false },
    authTag: { type: Buffer, required: true, select: false },
    ciphertext: { type: Buffer, required: true, select: false },
    status: {
      type: String,
      required: true,
      enum: Object.values(EmailDeliveryStatus),
      default: EmailDeliveryStatus.PENDING,
      index: true,
    },
    attempts: { type: Number, required: true, default: 0, min: 0, max: 5 },
    maxAttempts: { type: Number, required: true, default: 5, min: 5, max: 5, immutable: true },
    availableAt: { type: Date, required: true, default: Date.now, index: true },
    leaseToken: shortText({ max: 80, select: false }),
    leaseUntil: { type: Date, select: false },
    messageId: shortText({ required: true, max: 200, immutable: true }),
    providerId: shortText({ max: 200 }),
    lastErrorCode: shortText({ max: 80 }),
    sentAt: { type: Date },
    purgeAt: { type: Date },
    resetGeneration: { type: Number, min: 1, immutable: true },
  },
  {
    collection: "emailDeliveries",
    privateFields: ["keyId", "iv", "authTag", "ciphertext", "leaseToken", "leaseUntil"],
  },
);

emailDeliverySchema.index({ dedupeKey: 1 }, { unique: true });
emailDeliverySchema.index({ status: 1, availableAt: 1, createdAt: 1 });
emailDeliverySchema.index({ status: 1, leaseUntil: 1 });
emailDeliverySchema.index({ recipientUser: 1, type: 1, resetGeneration: -1 });
emailDeliverySchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0, sparse: true });

export const EmailDelivery = registerModel("EmailDelivery", emailDeliverySchema);
