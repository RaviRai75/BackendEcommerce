import mongoose from "mongoose";
import {
  createSchema,
  paise,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";
import {
  InvoiceRegistrationMode,
  InvoiceTaxMode,
  ORDER_INVOICE_CONTRACT_VERSION_V1,
  ORDER_INVOICE_V1_MAX_SEQUENCE,
} from "./orderInvoice.contract.js";

const sellerSchema = new mongoose.Schema(
  {
    brandName: shortText({ required: true, max: 160, immutable: true }),
    legalName: shortText({ required: true, max: 200, immutable: true }),
    addressLines: {
      type: [String],
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
    email: shortText({ max: 254, lowercase: true, immutable: true }),
    phone: shortText({ max: 15, immutable: true }),
    registrationMode: {
      type: String,
      required: true,
      enum: Object.values(InvoiceRegistrationMode),
      immutable: true,
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const addressSchema = new mongoose.Schema(
  {
    recipientName: shortText({ required: true, max: 80, immutable: true }),
    phone: shortText({ required: true, max: 10, immutable: true }),
    email: shortText({
      required: true,
      max: 254,
      lowercase: true,
      immutable: true,
    }),
    addressLine1: shortText({ required: true, max: 180, immutable: true }),
    addressLine2: shortText({ max: 180, immutable: true }),
    landmark: shortText({ max: 120, immutable: true }),
    city: shortText({ required: true, max: 80, immutable: true }),
    district: shortText({ required: true, max: 80, immutable: true }),
    state: shortText({ required: true, max: 80, immutable: true }),
    pincode: shortText({ required: true, max: 6, immutable: true }),
  },
  { strict: "throw", _id: false, versionKey: false },
);

const itemSchema = new mongoose.Schema(
  {
    productName: shortText({ required: true, max: 160, immutable: true }),
    sku: shortText({ required: true, max: 64, immutable: true }),
    size: shortText({ required: true, max: 30, immutable: true }),
    colour: shortText({ required: true, max: 60, immutable: true }),
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 99,
      validate: Number.isInteger,
      immutable: true,
    },
    unitPricePaise: { ...paise({ required: true }), immutable: true },
    compareAtUnitPricePaise: { ...paise(), immutable: true },
    lineMerchandiseSubtotalPaise: {
      ...paise({ required: true }),
      immutable: true,
    },
    lineCompareAtSubtotalPaise: {
      ...paise({ required: true }),
      immutable: true,
    },
    lineProductDiscountPaise: { ...paise({ required: true }), immutable: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const pricingSchema = new mongoose.Schema(
  {
    merchandiseSubtotalPaise: { ...paise({ required: true }), immutable: true },
    compareAtSubtotalPaise: { ...paise({ required: true }), immutable: true },
    productDiscountPaise: { ...paise({ required: true }), immutable: true },
    couponDiscountPaise: { ...paise({ required: true }), immutable: true },
    merchandiseAfterCouponPaise: {
      ...paise({ required: true }),
      immutable: true,
    },
    deliveryChargePaise: { ...paise({ required: true }), immutable: true },
    codSurchargePaise: { ...paise({ required: true }), immutable: true },
    finalTotalPaise: { ...paise({ required: true }), immutable: true },
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
    totalTaxPaise: { ...paise({ required: true }), immutable: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const orderInvoiceSchema = createSchema(
  {
    contractVersion: {
      type: Number,
      required: true,
      enum: [ORDER_INVOICE_CONTRACT_VERSION_V1],
      immutable: true,
    },
    order: { ...ref("Order", { required: true }), immutable: true },
    owner: { ...ref("User", { required: true }), immutable: true },
    orderNumber: shortText({ required: true, max: 48, immutable: true }),
    invoiceNumber: shortText({ required: true, max: 64, immutable: true }),
    financialYear: shortText({
      required: true,
      max: 7,
      match: /^\d{4}-\d{2}$/,
      immutable: true,
    }),
    sequence: {
      type: Number,
      required: true,
      min: 1,
      max: ORDER_INVOICE_V1_MAX_SEQUENCE,
      validate: Number.isSafeInteger,
      immutable: true,
    },
    policyVersion: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger,
      immutable: true,
    },
    issuedAt: { type: Date, required: true, immutable: true },
    issuedBy: { ...ref("User", { required: true }), immutable: true },
    seller: { type: sellerSchema, required: true, immutable: true },
    customer: {
      type: addressSchema,
      required: true,
      immutable: true,
    },
    billingAddress: { type: addressSchema, required: true, immutable: true },
    shippingAddress: { type: addressSchema, required: true, immutable: true },
    items: {
      type: [itemSchema],
      required: true,
      immutable: true,
      validate: {
        validator: (items) => items.length >= 1 && items.length <= 100,
        message: "Invoice must contain between one and 100 item lines.",
      },
    },
    pricing: { type: pricingSchema, required: true, immutable: true },
    coupon: {
      type: new mongoose.Schema(
        {
          code: shortText({ required: true, max: 32, immutable: true }),
          discountPaise: { ...paise({ required: true }), immutable: true },
        },
        { strict: "throw", _id: false, versionKey: false },
      ),
      default: null,
      immutable: true,
    },
    paymentMethod: shortText({
      required: true,
      max: 20,
      enum: ["COD", "PREPAID"],
      immutable: true,
    }),
    paymentStatus: shortText({ required: true, max: 40, immutable: true }),
    tax: { type: taxSchema, required: true, immutable: true },
  },
  {
    collection: "orderInvoices",
    privateFields: ["order", "owner", "issuedBy"],
    schemaOptions: { timestamps: { createdAt: true, updatedAt: false } },
  },
);

orderInvoiceSchema.index({ order: 1 }, { unique: true });
orderInvoiceSchema.index({ invoiceNumber: 1 }, { unique: true });
orderInvoiceSchema.index({ financialYear: 1, sequence: 1 }, { unique: true });
orderInvoiceSchema.index({ owner: 1, orderNumber: 1 }, { unique: true });

function rejectInvoiceMutation() {
  throw new Error("Issued order invoices are append-only.");
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
  orderInvoiceSchema.pre(operation, rejectInvoiceMutation);
}
orderInvoiceSchema.pre("validate", function preventExistingInvoiceValidation() {
  if (!this.isNew) rejectInvoiceMutation();
});
orderInvoiceSchema.pre("save", function preventExistingInvoiceSave() {
  if (!this.isNew) rejectInvoiceMutation();
});
orderInvoiceSchema.pre(
  "deleteOne",
  { document: true, query: false },
  rejectInvoiceMutation,
);

export const OrderInvoice = registerModel("OrderInvoice", orderInvoiceSchema);
OrderInvoice.bulkWrite = async function rejectInvoiceBulkWrite() {
  rejectInvoiceMutation();
};
