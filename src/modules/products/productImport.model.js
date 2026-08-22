import mongoose from "mongoose";
import { createSchema, ref, registerModel } from "../../utils/schema.js";

export const ProductImportStatus = Object.freeze({
  PREVIEWED: "PREVIEWED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
});

function limitedArray(type, max, message) {
  return {
    type,
    default: [],
    validate: {
      validator: (values) => values.length <= max,
      message,
    },
  };
}

const diagnosticSchema = new mongoose.Schema(
  {
    severity: { type: String, required: true, enum: ["error", "warning"] },
    row: { type: Number, min: 1, default: null },
    field: { type: String, maxlength: 80, default: null },
    code: { type: String, required: true, maxlength: 80 },
    message: { type: String, required: true, maxlength: 300 },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const summarySchema = new mongoose.Schema(
  {
    rowCount: { type: Number, required: true, min: 0 },
    productCount: { type: Number, required: true, min: 0, max: 500 },
    variantCount: { type: Number, required: true, min: 0, max: 20_000 },
    errorCount: { type: Number, required: true, min: 0 },
    warningCount: { type: Number, required: true, min: 0 },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const variantPlanSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, maxlength: 64 },
    size: { type: String, required: true, maxlength: 30 },
    colour: { type: String, required: true, maxlength: 60 },
    stock: { type: Number, required: true, min: 0, max: 1_000_000 },
    lowStockThreshold: {
      type: Number,
      required: true,
      min: 0,
      max: 1_000_000,
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const productPlanSchema = new mongoose.Schema(
  {
    sourceRow: { type: Number, required: true, min: 2 },
    slug: { type: String, required: true, maxlength: 140 },
    name: { type: String, required: true, maxlength: 160 },
    categoryId: ref("Category", { required: true }),
    categorySlug: { type: String, required: true, maxlength: 140 },
    collectionIds: limitedArray(
      [{ ...ref("Collection"), index: false }],
      30,
      "A product import may reference at most 30 collections.",
    ),
    collectionSlugs: limitedArray(
      [{ type: String, maxlength: 140 }],
      30,
      "A product import may reference at most 30 collections.",
    ),
    basePricePaise: { type: Number, required: true, min: 0 },
    compareAtPricePaise: { type: Number, min: 0, default: null },
    shortDescription: { type: String, maxlength: 300 },
    description: { type: String, maxlength: 5000 },
    fabric: { type: String, maxlength: 80 },
    occasions: limitedArray(
      [{ type: String, maxlength: 80 }],
      20,
      "A product import may contain at most 20 occasions.",
    ),
    careInstructions: { type: String, maxlength: 1500 },
    madeIn: { type: String, maxlength: 120 },
    tags: limitedArray(
      [{ type: String, maxlength: 60 }],
      30,
      "A product import may contain at most 30 tags.",
    ),
    seoTitle: { type: String, maxlength: 70 },
    seoDescription: { type: String, maxlength: 180 },
    isNewArrival: { type: Boolean, required: true },
    isBestseller: { type: Boolean, required: true },
    exchangeEligible: { type: Boolean, required: true },
    merchandisingRank: {
      type: Number,
      required: true,
      min: 0,
      max: 1_000_000,
    },
    variants: limitedArray(
      [variantPlanSchema],
      100,
      "A product import may contain at most 100 variants per product.",
    ),
  },
  { strict: "throw", _id: false, versionKey: false },
);

const resultProductSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, maxlength: 64 },
    slug: { type: String, required: true, maxlength: 140 },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const resultSchema = new mongoose.Schema(
  {
    productCount: { type: Number, required: true, min: 0, max: 200 },
    variantCount: { type: Number, required: true, min: 0, max: 20_000 },
    products: limitedArray(
      [resultProductSchema],
      200,
      "A product import result may contain at most 200 products.",
    ),
    completedAt: { type: Date, required: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const productImportSchema = createSchema(
  {
    publicId: { type: String, required: true, maxlength: 64, immutable: true },
    actor: { ...ref("User", { required: true }), immutable: true },
    schemaVersion: {
      type: String,
      required: true,
      maxlength: 20,
      immutable: true,
    },
    contentHash: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/,
      immutable: true,
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(ProductImportStatus),
      default: ProductImportStatus.PREVIEWED,
    },
    plan: {
      ...limitedArray(
        [productPlanSchema],
        200,
        "A product import may contain at most 200 products.",
      ),
      immutable: true,
    },
    diagnostics: {
      ...limitedArray(
        [diagnosticSchema],
        200,
        "A product import may store at most 200 diagnostics.",
      ),
      immutable: true,
    },
    summary: { type: summarySchema, required: true, immutable: true },
    expiresAt: { type: Date, required: true, immutable: true },
    purgeAt: { type: Date, required: true },
    processingAt: Date,
    completedAt: Date,
    failedAt: Date,
    expiredAt: Date,
    idempotencyKeyHash: {
      type: String,
      match: /^[a-f0-9]{64}$/,
      maxlength: 64,
    },
    idempotencyFingerprint: {
      type: String,
      match: /^[a-f0-9]{64}$/,
      maxlength: 64,
    },
    result: { type: resultSchema, default: null },
  },
  { collection: "productImports" },
);

productImportSchema.index({ publicId: 1 }, { unique: true });
productImportSchema.index(
  { actor: 1, idempotencyKeyHash: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKeyHash: { $type: "string" } },
  },
);
productImportSchema.index({ status: 1, expiresAt: 1 });
productImportSchema.index({ actor: 1, createdAt: -1, _id: -1 });
productImportSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const ProductImport = registerModel(
  "ProductImport",
  productImportSchema,
);
