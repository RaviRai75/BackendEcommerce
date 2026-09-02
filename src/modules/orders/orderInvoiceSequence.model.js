import { createSchema, registerModel, shortText } from "../../utils/schema.js";
import { ORDER_INVOICE_V1_MAX_SEQUENCE } from "./orderInvoice.contract.js";

const orderInvoiceSequenceSchema = createSchema(
  {
    financialYear: shortText({
      required: true,
      max: 7,
      match: /^\d{4}-\d{2}$/,
      immutable: true,
    }),
    nextValue: {
      type: Number,
      required: true,
      min: 0,
      max: ORDER_INVOICE_V1_MAX_SEQUENCE,
      default: 0,
      validate: Number.isSafeInteger,
    },
  },
  { collection: "orderInvoiceSequences" },
);

orderInvoiceSequenceSchema.index({ financialYear: 1 }, { unique: true });

export const OrderInvoiceSequence = registerModel(
  "OrderInvoiceSequence",
  orderInvoiceSequenceSchema,
);
