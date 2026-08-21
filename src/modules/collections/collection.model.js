import mongoose from "mongoose";
import {
  createSchema,
  demoFlag,
  longText,
  ref,
  registerModel,
  shortText,
  slug,
} from "../../utils/schema.js";
import { ProductMediaType } from "../products/product.model.js";
import { cloudinaryMediaError } from "../products/cloudinaryMedia.js";

export const CollectionStatus = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  ARCHIVED: "ARCHIVED",
};

const imageAttachmentSchema = new mongoose.Schema(
  {
    assetId: ref("MediaAsset", { required: true }),
    type: {
      type: String,
      required: true,
      enum: [ProductMediaType.IMAGE],
    },
    url: shortText({ required: true, max: 1000 }),
    publicId: shortText({ required: true, max: 255 }),
    altText: shortText({ required: true, max: 180 }),
  },
  { strict: "throw", _id: false, versionKey: false },
);

imageAttachmentSchema.pre("validate", function validateCloudinaryMetadata() {
  const message = cloudinaryMediaError(this);
  if (message) this.invalidate("url", message);
});

const collectionSchema = createSchema(
  {
    name: shortText({ required: true, max: 100 }),
    slug: { ...slug(), unique: true },
    description: longText({ max: 2000 }),
    seo: {
      title: shortText({ max: 70 }),
      description: shortText({ max: 180 }),
    },
    editorialMedia: { type: imageAttachmentSchema, default: null },
    featured: { type: Boolean, default: false },
    status: {
      type: String,
      required: true,
      enum: Object.values(CollectionStatus),
      default: CollectionStatus.DRAFT,
    },
    sortOrder: {
      type: Number,
      required: true,
      min: 0,
      max: 100_000,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: "Sort order must be a whole number.",
      },
    },
    publishedAt: Date,
    archivedAt: Date,
    isDemoData: demoFlag(),
  },
  { collection: "collections" },
);

collectionSchema.index({ status: 1, featured: -1, sortOrder: 1, name: 1 });
collectionSchema.index({ "editorialMedia.assetId": 1 });

export const Collection = registerModel("Collection", collectionSchema);
