import { createSchema, longText, ref, registerModel, shortText } from "../../utils/schema.js";
import { CustomRequestStatus } from "./customRequest.model.js";

export const CustomMessageVisibility = Object.freeze({ PUBLIC: "PUBLIC", INTERNAL: "INTERNAL" });
export const CustomMessageSender = Object.freeze({ CUSTOMER: "CUSTOMER", ADMIN: "ADMIN" });
export const CustomMessageOperation = Object.freeze({ CUSTOMER_REPLY: "CUSTOMER_REPLY", ADMIN_REPLY: "ADMIN_REPLY", INTERNAL_NOTE: "INTERNAL_NOTE" });

const schema = createSchema(
  {
    request: { ...ref("CustomRequest", { required: true }), immutable: true },
    requestNumber: shortText({ required: true, max: 48, immutable: true }),
    actor: { ...ref("User", { required: true }), immutable: true },
    authorName: shortText({ required: true, max: 80, immutable: true }),
    sender: { type: String, required: true, enum: Object.values(CustomMessageSender), immutable: true },
    visibility: { type: String, required: true, enum: Object.values(CustomMessageVisibility), immutable: true },
    body: longText({ required: true, max: 4000, immutable: true }),
    operation: { type: String, required: true, enum: Object.values(CustomMessageOperation), immutable: true },
    idempotencyKeyHash: shortText({ required: true, max: 64, immutable: true }),
    requestFingerprint: shortText({ required: true, max: 64, immutable: true }),
    operationId: shortText({ required: true, max: 128, immutable: true }),
    requestVersion: { type: Number, required: true, min: 0, immutable: true },
    requestStatus: { type: String, required: true, enum: Object.values(CustomRequestStatus), immutable: true },
  },
  { collection: "customRequestMessages", privateFields: ["idempotencyKeyHash", "requestFingerprint", "operationId"] },
);
schema.index({ actor: 1, idempotencyKeyHash: 1 }, { unique: true });
schema.index({ request: 1, visibility: 1, createdAt: 1, _id: 1 });
schema.index({ operationId: 1 }, { unique: true });
export const CustomRequestMessage = registerModel("CustomRequestMessage", schema);
