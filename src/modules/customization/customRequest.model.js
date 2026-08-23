import mongoose from "mongoose";
import {
  createSchema,
  longText,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";
import {
  customizationDefinitionSchema,
  MeasurementUnit,
} from "./customizationConfig.js";

export const CustomRequestType = Object.freeze({
  EXISTING_PRODUCT: "EXISTING_PRODUCT",
  OWN_DESIGN: "OWN_DESIGN",
});
export const CustomRequestStatus = Object.freeze({
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  NEED_MORE_INFORMATION: "NEED_MORE_INFORMATION",
  FEASIBILITY_CHECK: "FEASIBILITY_CHECK",
  QUOTE_PREPARED: "QUOTE_PREPARED",
  QUOTE_SENT: "QUOTE_SENT",
  CUSTOMER_APPROVED: "CUSTOMER_APPROVED",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  PAYMENT_COMPLETED: "PAYMENT_COMPLETED",
  IN_PRODUCTION: "IN_PRODUCTION",
  QUALITY_CHECK: "QUALITY_CHECK",
  READY_TO_SHIP: "READY_TO_SHIP",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
  COMPLETED: "COMPLETED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
});
export const CustomPriority = Object.freeze({
  LOW: "LOW",
  NORMAL: "NORMAL",
  HIGH: "HIGH",
  URGENT: "URGENT",
});
export const CustomRequestAction = Object.freeze({
  SUBMIT: "SUBMIT",
  START_REVIEW: "START_REVIEW",
  START_FEASIBILITY: "START_FEASIBILITY",
  REQUEST_INFORMATION: "REQUEST_INFORMATION",
  CUSTOMER_REPLY: "CUSTOMER_REPLY",
  REJECT: "REJECT",
  PREPARE_QUOTE: "PREPARE_QUOTE",
  SEND_QUOTE: "SEND_QUOTE",
  REQUEST_CHANGES: "REQUEST_CHANGES",
  ACCEPT_QUOTE: "ACCEPT_QUOTE",
  PAYMENT_CONFIRMED: "PAYMENT_CONFIRMED",
  SET_PRIORITY: "SET_PRIORITY",
  CANCEL: "CANCEL",
  START_PRODUCTION: "START_PRODUCTION",
  START_QUALITY_CHECK: "START_QUALITY_CHECK",
  MARK_READY_TO_SHIP: "MARK_READY_TO_SHIP",
  RECORD_SHIPMENT: "RECORD_SHIPMENT",
  MARK_OUT_FOR_DELIVERY: "MARK_OUT_FOR_DELIVERY",
  MARK_DELIVERED: "MARK_DELIVERED",
  COMPLETE: "COMPLETE",
});

const selectedOptionSchema = new mongoose.Schema(
  {
    groupKey: shortText({ required: true, max: 40, immutable: true }),
    choiceKey: shortText({ required: true, max: 40, immutable: true }),
    groupLabel: shortText({ required: true, max: 80, immutable: true }),
    choiceLabel: shortText({ required: true, max: 80, immutable: true }),
  },
  { strict: "throw", _id: false, versionKey: false },
);
const measurementSchema = new mongoose.Schema(
  {
    key: shortText({ required: true, max: 40, immutable: true }),
    label: shortText({ required: true, max: 80, immutable: true }),
    value: { type: Number, required: true, min: 0, max: 1000, immutable: true },
    unit: {
      type: String,
      required: true,
      enum: Object.values(MeasurementUnit),
      immutable: true,
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);
const profileSnapshotSchema = new mongoose.Schema(
  {
    sourceProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    sourceProfileRevision: {
      type: Number,
      required: true,
      min: 0,
      immutable: true,
    },
    name: shortText({ required: true, max: 80, immutable: true }),
    ageGroup: shortText({ max: 80, immutable: true }),
    size: shortText({ max: 80, immutable: true }),
    measurements: { type: [measurementSchema], default: [], immutable: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);
const referenceSchema = new mongoose.Schema(
  {
    assetId: { ...ref("MediaAsset", { required: true }), immutable: true },
    publicId: shortText({ required: true, max: 255, immutable: true }),
    url: shortText({ required: true, max: 1000, immutable: true }),
    altText: shortText({ required: true, max: 180, immutable: true }),
  },
  { strict: "throw", _id: false, versionKey: false },
);
const categorySnapshotSchema = new mongoose.Schema(
  {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    name: shortText({ required: true, max: 100, immutable: true }),
    slug: shortText({ required: true, max: 140, immutable: true }),
    revision: { type: Number, required: true, min: 0, immutable: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);
const productSnapshotSchema = new mongoose.Schema(
  {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    name: shortText({ required: true, max: 160, immutable: true }),
    slug: shortText({ required: true, max: 140, immutable: true }),
    imageUrl: shortText({ max: 1000, immutable: true }),
    pricePaise: {
      type: Number,
      required: true,
      min: 0,
      max: 1_000_000_000,
      immutable: true,
    },
    revision: { type: Number, required: true, min: 0, immutable: true },
    variant: {
      type: new mongoose.Schema(
        {
          id: { type: mongoose.Schema.Types.ObjectId, required: true },
          sku: shortText({ required: true, max: 64 }),
          size: shortText({ required: true, max: 30 }),
          colour: shortText({ required: true, max: 60 }),
        },
        { strict: "throw", _id: false, versionKey: false },
      ),
      default: undefined,
      immutable: true,
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);
const policyEvidenceSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      enum: ["CUSTOMIZATION_POLICY"],
      immutable: true,
    },
    revision: { type: Number, required: true, min: 1, immutable: true },
    hash: shortText({ required: true, max: 64, immutable: true }),
  },
  { strict: "throw", _id: false, versionKey: false },
);
const historySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: Object.values(CustomRequestAction),
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(CustomRequestStatus),
    },
    at: { type: Date, required: true },
    actor: ref("User", { required: true }),
    requestId: shortText({ required: true, max: 128 }),
    version: { type: Number, required: true, min: 0 },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const schema = createSchema(
  {
    requestNumber: shortText({ required: true, max: 48, immutable: true }),
    owner: { ...ref("User", { required: true }), immutable: true },
    type: {
      type: String,
      required: true,
      enum: Object.values(CustomRequestType),
      immutable: true,
    },
    category: { type: categorySnapshotSchema, required: true, immutable: true },
    product: {
      type: productSnapshotSchema,
      default: undefined,
      immutable: true,
    },
    configuration: {
      type: customizationDefinitionSchema,
      required: true,
      immutable: true,
    },
    policy: { type: policyEvidenceSchema, required: true, immutable: true },
    requirements: {
      description: longText({ required: true, max: 5000, immutable: true }),
      selectedOptions: {
        type: [selectedOptionSchema],
        default: [],
        immutable: true,
      },
      preferredColour: shortText({ max: 80, immutable: true }),
      preferredFabric: shortText({ max: 80, immutable: true }),
      occasion: shortText({ max: 120, immutable: true }),
      budgetPreference: shortText({ max: 120, immutable: true }),
      additionalNotes: longText({ max: 2000, immutable: true }),
    },
    sizing: {
      ageGroupKey: shortText({ max: 40, immutable: true }),
      ageGroupLabel: shortText({ max: 80, immutable: true }),
      sizeKey: shortText({ max: 40, immutable: true }),
      sizeLabel: shortText({ max: 80, immutable: true }),
      measurements: { type: [measurementSchema], default: [], immutable: true },
      profileId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
      profileSnapshot: {
        type: profileSnapshotSchema,
        default: undefined,
        immutable: true,
      },
    },
    references: { type: [referenceSchema], default: [], immutable: true },
    status: {
      type: String,
      required: true,
      enum: Object.values(CustomRequestStatus),
      default: CustomRequestStatus.SUBMITTED,
    },
    priority: {
      type: String,
      required: true,
      enum: Object.values(CustomPriority),
      default: CustomPriority.NORMAL,
    },
    currentQuote: ref("CustomRequestQuote"),
    history: { type: [historySchema], required: true },
    creationIdempotencyKeyHash: shortText({
      required: true,
      max: 64,
      immutable: true,
    }),
    creationFingerprint: shortText({
      required: true,
      max: 64,
      immutable: true,
    }),
  },
  {
    collection: "customRequests",
    privateFields: ["creationIdempotencyKeyHash", "creationFingerprint"],
  },
);
schema.index({ requestNumber: 1 }, { unique: true });
schema.index({ owner: 1, creationIdempotencyKeyHash: 1 }, { unique: true });
schema.index({ owner: 1, createdAt: -1, _id: -1 });
schema.index({ createdAt: -1, _id: -1 });
schema.index({ status: 1, priority: 1, createdAt: -1, _id: -1 });
schema.index({ status: 1, createdAt: -1, _id: -1 });
schema.index({ priority: 1, createdAt: -1, _id: -1 });
schema.index({ type: 1, createdAt: -1, _id: -1 });
schema.index({ "category.id": 1, createdAt: -1, _id: -1 });
schema.index({ "references.assetId": 1 });
export const CustomRequest = registerModel("CustomRequest", schema);
