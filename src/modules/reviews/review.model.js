import mongoose from "mongoose";
import {
  createSchema,
  longText,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";

export const ReviewStatus = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});

export const ReviewModerationAction = Object.freeze({
  APPROVE: "APPROVE",
  REJECT: "REJECT",
});

const purchaseSnapshotSchema = new mongoose.Schema(
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
      immutable: true,
      validate: { validator: Number.isInteger },
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const photoSnapshotSchema = new mongoose.Schema(
  {
    assetId: { ...ref("MediaAsset", { required: true }), immutable: true },
    publicId: shortText({ required: true, max: 255, immutable: true }),
    url: shortText({ required: true, max: 1000, immutable: true }),
  },
  { strict: "throw", _id: false, versionKey: false },
);

const moderationSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: Object.values(ReviewModerationAction),
      immutable: true,
    },
    moderatedBy: { ...ref("User", { required: true }), immutable: true },
    moderatedAt: { type: Date, required: true, immutable: true },
    internalNote: longText({ max: 1000, immutable: true }),
  },
  { strict: "throw", _id: false, versionKey: false },
);

const reviewSchema = createSchema(
  {
    user: { ...ref("User", { required: true }), immutable: true },
    product: { ...ref("Product", { required: true }), immutable: true },
    order: { ...ref("Order", { required: true }), immutable: true },
    variant: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    orderNumber: shortText({ required: true, max: 48, immutable: true }),
    lineToken: shortText({ required: true, max: 128, immutable: true }),
    purchase: {
      type: purchaseSnapshotSchema,
      required: true,
      immutable: true,
    },
    verifiedPurchase: {
      type: Boolean,
      required: true,
      immutable: true,
      validate: {
        validator: (value) => value === true,
        message: "Reviews must be tied to a verified purchase.",
      },
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      immutable: true,
      validate: { validator: Number.isInteger },
    },
    comment: longText({
      required: true,
      max: 2000,
      minlength: [10, "Review comment must be at least 10 characters."],
      immutable: true,
    }),
    photo: { type: photoSnapshotSchema, default: undefined, immutable: true },
    idempotencyKeyHash: shortText({
      required: true,
      max: 64,
      immutable: true,
    }),
    requestFingerprint: shortText({
      required: true,
      max: 64,
      immutable: true,
    }),
    status: {
      type: String,
      required: true,
      enum: Object.values(ReviewStatus),
      default: ReviewStatus.PENDING,
    },
    moderation: { type: moderationSchema, default: undefined },
  },
  {
    collection: "reviews",
    privateFields: ["idempotencyKeyHash", "requestFingerprint"],
  },
);

reviewSchema.index({ user: 1, product: 1 }, { unique: true });
reviewSchema.index({ user: 1, idempotencyKeyHash: 1 }, { unique: true });
reviewSchema.index({ user: 1, createdAt: -1, _id: -1 });
reviewSchema.index({ product: 1, status: 1, createdAt: -1, _id: -1 });
reviewSchema.index({
  product: 1,
  status: 1,
  rating: 1,
  createdAt: -1,
  _id: -1,
});
reviewSchema.index({ status: 1, createdAt: -1, _id: -1 });
reviewSchema.index({ rating: 1, createdAt: -1, _id: -1 });
reviewSchema.index({ "photo.assetId": 1 }, { sparse: true });

export const Review = registerModel("Review", reviewSchema);
