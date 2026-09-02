import mongoose from "mongoose";
import { createSchema, registerModel, shortText } from "../../utils/schema.js";
import {
  InvoiceRegistrationMode,
  InvoiceTaxMode,
  ORDER_INVOICE_CONTRACT_VERSION_V1,
  ORDER_INVOICE_POLICY_KEY,
  ORDER_INVOICE_V1_PREFIX,
  ORDER_INVOICE_V1_SEQUENCE_WIDTH,
} from "./orderInvoice.contract.js";

export {
  InvoiceRegistrationMode,
  InvoiceTaxMode,
  ORDER_INVOICE_POLICY_KEY,
} from "./orderInvoice.contract.js";

const addressLineSchema = {
  type: String,
  required: true,
  trim: true,
  maxlength: 180,
};

const sellerSchema = new mongoose.Schema(
  {
    brandName: shortText({ required: true, max: 160, immutable: true }),
    legalName: shortText({ required: true, max: 200, immutable: true }),
    addressLines: {
      type: [addressLineSchema],
      required: true,
      immutable: true,
      validate: {
        validator: (lines) => lines.length >= 1 && lines.length <= 4,
        message: "Seller address must contain between one and four lines.",
      },
    },
    state: shortText({ required: true, max: 80, immutable: true }),
    stateCode: shortText({
      required: true,
      max: 2,
      match: /^\d{2}$/,
      immutable: true,
    }),
    pincode: shortText({
      required: true,
      max: 6,
      match: /^[1-9]\d{5}$/,
      immutable: true,
    }),
    email: shortText({
      max: 254,
      lowercase: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      immutable: true,
    }),
    phone: shortText({ max: 15, match: /^\+?[1-9]\d{7,14}$/, immutable: true }),
    registrationMode: {
      type: String,
      required: true,
      enum: Object.values(InvoiceRegistrationMode),
      immutable: true,
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const taxSchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      required: true,
      enum: Object.values(InvoiceTaxMode),
      immutable: true,
    },
    deliveryTaxMode: {
      type: String,
      required: true,
      enum: Object.values(InvoiceTaxMode),
      immutable: true,
    },
    codTaxMode: {
      type: String,
      required: true,
      enum: Object.values(InvoiceTaxMode),
      immutable: true,
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const orderInvoicePolicySchema = createSchema(
  {
    key: {
      type: String,
      required: true,
      enum: [ORDER_INVOICE_POLICY_KEY],
      default: ORDER_INVOICE_POLICY_KEY,
      immutable: true,
    },
    contractVersion: {
      type: Number,
      required: true,
      enum: [ORDER_INVOICE_CONTRACT_VERSION_V1],
      immutable: true,
    },
    version: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger,
      immutable: true,
    },
    effectiveFrom: { type: Date, required: true, immutable: true },
    eligibleOrderPlacedFrom: { type: Date, required: true, immutable: true },
    issuanceEvent: {
      type: String,
      required: true,
      enum: ["RECORD_SHIPMENT"],
      default: "RECORD_SHIPMENT",
      immutable: true,
    },
    invoicePrefix: shortText({
      required: true,
      max: ORDER_INVOICE_V1_PREFIX.length,
      enum: [ORDER_INVOICE_V1_PREFIX],
      immutable: true,
    }),
    sequenceWidth: {
      type: Number,
      required: true,
      enum: [ORDER_INVOICE_V1_SEQUENCE_WIDTH],
      immutable: true,
    },
    timezone: {
      type: String,
      required: true,
      enum: ["Asia/Kolkata"],
      default: "Asia/Kolkata",
      immutable: true,
    },
    financialYearStartMonth: {
      type: Number,
      required: true,
      enum: [4],
      default: 4,
      immutable: true,
    },
    billingAddressMode: {
      type: String,
      required: true,
      enum: ["SHIPPING"],
      default: "SHIPPING",
      immutable: true,
    },
    seller: { type: sellerSchema, required: true, immutable: true },
    tax: { type: taxSchema, required: true, immutable: true },
  },
  {
    collection: "orderInvoicePolicies",
    schemaOptions: { timestamps: { createdAt: true, updatedAt: false } },
  },
);

orderInvoicePolicySchema.index({ key: 1, version: 1 }, { unique: true });
orderInvoicePolicySchema.index({ key: 1, effectiveFrom: -1, version: -1 });

function rejectPolicyMutation() {
  throw new Error("Published invoice policies are append-only.");
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
  orderInvoicePolicySchema.pre(operation, rejectPolicyMutation);
}

orderInvoicePolicySchema.pre(
  "validate",
  function preventExistingPolicyValidation() {
    if (!this.isNew) rejectPolicyMutation();
  },
);
orderInvoicePolicySchema.pre("save", function preventExistingPolicySave() {
  if (!this.isNew) rejectPolicyMutation();
});
orderInvoicePolicySchema.pre(
  "deleteOne",
  { document: true, query: false },
  rejectPolicyMutation,
);

export const OrderInvoicePolicy = registerModel(
  "OrderInvoicePolicy",
  orderInvoicePolicySchema,
);
OrderInvoicePolicy.bulkWrite = async function rejectPolicyBulkWrite() {
  rejectPolicyMutation();
};
