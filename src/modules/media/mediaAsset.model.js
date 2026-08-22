import mongoose from "mongoose";
import {
  createSchema,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";
import { ProductMediaType } from "../products/product.model.js";

export const MediaAssetStatus = {
  PENDING: "PENDING",
  READY: "READY",
  DELETING: "DELETING",
  DELETED: "DELETED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
};

export const MediaResourceType = {
  IMAGE: "image",
  VIDEO: "video",
};

export const MediaPurpose = {
  PRODUCT: "PRODUCT",
  HOME_HERO: "HOME_HERO",
  COLLECTION: "COLLECTION",
  EXCHANGE_REQUEST: "EXCHANGE_REQUEST",
  REVIEW: "REVIEW",
  CUSTOM_REQUEST_REFERENCE: "CUSTOM_REQUEST_REFERENCE",
};

export const MediaPurposePrefix = {
  [MediaPurpose.PRODUCT]: "products",
  [MediaPurpose.HOME_HERO]: "home",
  [MediaPurpose.COLLECTION]: "collections",
  [MediaPurpose.EXCHANGE_REQUEST]: "exchanges",
  [MediaPurpose.REVIEW]: "reviews",
  [MediaPurpose.CUSTOM_REQUEST_REFERENCE]: "custom-requests",
};

export const MediaDeletionReason = {
  ADMIN: "ADMIN",
  RECONCILIATION: "RECONCILIATION",
};

const mediaAssetSchema = createSchema(
  {
    purpose: {
      type: String,
      required: true,
      enum: Object.values(MediaPurpose),
      default: MediaPurpose.PRODUCT,
    },
    publicId: {
      ...shortText({ required: true, max: 255 }),
      match: [
        /^(?:products|home|collections|exchanges|reviews|custom-requests)\/[a-f0-9-]{36}$/,
        "Media must use a generated server-owned public ID.",
      ],
      validate: {
        validator(value) {
          const purpose = this.purpose ?? MediaPurpose.PRODUCT;
          return value.startsWith(`${MediaPurposePrefix[purpose]}/`);
        },
        message: "Media purpose must match its generated public ID prefix.",
      },
    },
    providerAssetId: shortText({ max: 128 }),
    mediaType: {
      type: String,
      required: true,
      enum: Object.values(ProductMediaType),
    },
    resourceType: {
      type: String,
      required: true,
      enum: Object.values(MediaResourceType),
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(MediaAssetStatus),
      default: MediaAssetStatus.PENDING,
      index: true,
    },
    createdBy: ref("User", { required: true, index: true }),
    expectedMimeType: shortText({ required: true, max: 100, lowercase: true }),
    claimedBytes: {
      type: Number,
      required: true,
      min: 1,
      max: 500 * 1024 * 1024,
      validate: {
        validator: Number.isInteger,
        message: "Claimed upload size must be a whole number of bytes.",
      },
    },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    uploadedAt: Date,
    deletedAt: Date,
    reconciledAt: Date,
    reconciliationCheckedAt: Date,
    purgeAt: Date,
    deletionReason: {
      type: String,
      enum: Object.values(MediaDeletionReason),
    },
    deletionClaim: shortText({ max: 64 }),
    deletionClaimUntil: Date,
    secureUrl: shortText({ max: 1000 }),
    posterUrl: shortText({ max: 1000 }),
    format: shortText({ max: 20, lowercase: true }),
    bytes: {
      type: Number,
      min: 1,
      max: 500 * 1024 * 1024,
      validate: {
        validator: (value) => value === undefined || Number.isInteger(value),
        message: "Asset size must be a whole number of bytes.",
      },
    },
    width: {
      type: Number,
      min: 1,
      max: 20_000,
      validate: {
        validator: (value) => value === undefined || Number.isInteger(value),
        message: "Asset width must be a whole number.",
      },
    },
    height: {
      type: Number,
      min: 1,
      max: 20_000,
      validate: {
        validator: (value) => value === undefined || Number.isInteger(value),
        message: "Asset height must be a whole number.",
      },
    },
    durationSeconds: { type: Number, min: 0, max: 3600 },
    version: {
      type: Number,
      min: 1,
      validate: {
        validator: (value) => value === undefined || Number.isInteger(value),
        message: "Asset version must be a whole number.",
      },
    },
  },
  { collection: "mediaAssets" },
);

mediaAssetSchema.index({ resourceType: 1, publicId: 1 }, { unique: true });
mediaAssetSchema.index({ createdBy: 1, createdAt: -1 });
mediaAssetSchema.index({
  status: 1,
  purpose: 1,
  reconciliationCheckedAt: 1,
  uploadedAt: 1,
  _id: 1,
});
mediaAssetSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const MediaAsset = registerModel("MediaAsset", mediaAssetSchema);
