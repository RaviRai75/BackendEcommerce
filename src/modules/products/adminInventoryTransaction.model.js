import mongoose from "mongoose";
import {
  createSchema,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";

export const AdminInventoryReason = Object.freeze({
  RECOUNT: "RECOUNT",
  DAMAGE: "DAMAGE",
  RETURN: "RETURN",
  CORRECTION: "CORRECTION",
  OTHER: "OTHER",
});

const schema = createSchema(
  {
    actor: { ...ref("User", { required: true }), immutable: true },
    product: { ...ref("Product", { required: true }), immutable: true },
    variant: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    reason: {
      type: String,
      required: true,
      enum: Object.values(AdminInventoryReason),
      immutable: true,
    },
    note: shortText({ max: 240, immutable: true }),
    quantityDelta: {
      type: Number,
      required: true,
      immutable: true,
      validate: {
        validator: (value) => Number.isInteger(value) && value !== 0,
        message: "Inventory delta must be a non-zero whole number.",
      },
    },
    beforeStock: {
      type: Number,
      required: true,
      min: 0,
      immutable: true,
    },
    afterStock: {
      type: Number,
      required: true,
      min: 0,
      immutable: true,
    },
    beforeRevision: {
      type: Number,
      required: true,
      min: 0,
      immutable: true,
    },
    afterRevision: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
    },
    idempotencyKeyHash: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/,
      immutable: true,
    },
    requestFingerprint: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/,
      immutable: true,
    },
  },
  { collection: "adminInventoryTransactions" },
);

schema.index({ actor: 1, idempotencyKeyHash: 1 }, { unique: true });
schema.index({ product: 1, variant: 1, createdAt: -1 });

function rejectLedgerMutation() {
  throw new Error("Administrative inventory transactions are append-only.");
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
  schema.pre(operation, rejectLedgerMutation);
}
schema.pre("deleteOne", { document: true, query: false }, rejectLedgerMutation);
schema.pre("save", function preventExistingLedgerSave() {
  if (!this.isNew) rejectLedgerMutation();
});

export const AdminInventoryTransaction = registerModel(
  "AdminInventoryTransaction",
  schema,
);
AdminInventoryTransaction.bulkWrite = async function rejectLedgerBulkMutation() {
  rejectLedgerMutation();
};
