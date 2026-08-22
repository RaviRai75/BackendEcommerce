import mongoose from "mongoose";
import {
  createSchema,
  ref,
  registerModel,
} from "../../utils/schema.js";

export const ExchangeInventoryReason = Object.freeze({
  REPLACEMENT_SHIPPED: "REPLACEMENT_SHIPPED",
});

const exchangeInventoryTransactionSchema = createSchema(
  {
    exchange: { ...ref("Exchange", { required: true }), immutable: true },
    product: { ...ref("Product", { required: true }), immutable: true },
    variant: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    reason: {
      type: String,
      required: true,
      enum: Object.values(ExchangeInventoryReason),
      immutable: true,
    },
    quantityDelta: {
      type: Number,
      required: true,
      immutable: true,
      validate: {
        validator: (value) => Number.isInteger(value) && value < 0,
        message: "Exchange inventory delta must be a negative whole number.",
      },
    },
  },
  { collection: "exchangeInventoryTransactions" },
);

exchangeInventoryTransactionSchema.index(
  { exchange: 1, reason: 1 },
  { unique: true },
);
exchangeInventoryTransactionSchema.index({
  product: 1,
  variant: 1,
  createdAt: -1,
});

function rejectLedgerMutation() {
  throw new Error("Exchange inventory transactions are append-only.");
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
  exchangeInventoryTransactionSchema.pre(operation, rejectLedgerMutation);
}
exchangeInventoryTransactionSchema.pre(
  "deleteOne",
  { document: true, query: false },
  rejectLedgerMutation,
);
exchangeInventoryTransactionSchema.pre(
  "save",
  function preventExistingLedgerSave() {
    if (!this.isNew) rejectLedgerMutation();
  },
);

export const ExchangeInventoryTransaction = registerModel(
  "ExchangeInventoryTransaction",
  exchangeInventoryTransactionSchema,
);
ExchangeInventoryTransaction.bulkWrite = async function rejectBulkMutation() {
  rejectLedgerMutation();
};
