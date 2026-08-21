import mongoose from "mongoose";
import {
  createSchema,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";

export const InventoryReason = Object.freeze({
  ORDER_PLACED: "ORDER_PLACED",
  ORDER_RELEASED: "ORDER_RELEASED",
});
const schema = createSchema(
  {
    order: { ...ref("Order", { required: true }), immutable: true },
    product: { ...ref("Product", { required: true }), immutable: true },
    variant: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    reason: {
      type: String,
      required: true,
      enum: Object.values(InventoryReason),
      immutable: true,
    },
    quantityDelta: {
      type: Number,
      required: true,
      immutable: true,
      validate: {
        validator: (value) => Number.isInteger(value) && value !== 0,
        message: "Inventory delta must be a non-zero whole number.",
      },
    },
    note: shortText({ max: 160, immutable: true }),
  },
  { collection: "inventoryTransactions" },
);

schema.index({ order: 1, variant: 1, reason: 1 }, { unique: true });
schema.index({ product: 1, variant: 1, createdAt: -1 });

function rejectLedgerMutation() {
  throw new Error("Inventory transactions are append-only.");
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

export const InventoryTransaction = registerModel(
  "InventoryTransaction",
  schema,
);
InventoryTransaction.bulkWrite = async function rejectLedgerBulkMutation() {
  rejectLedgerMutation();
};
