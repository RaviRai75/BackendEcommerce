import mongoose from "mongoose";
import {
  createSchema,
  demoFlag,
  longText,
  paise,
  ref,
  registerModel,
  shortText,
  slug,
} from "../../utils/schema.js";
import { cloudinaryMediaError } from "./cloudinaryMedia.js";

export const ProductStatus = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  ARCHIVED: "ARCHIVED",
};

export const ProductMediaType = {
  IMAGE: "IMAGE",
  VIDEO: "VIDEO",
};

const variantSchema = new mongoose.Schema(
  {
    sku: shortText({ required: true, max: 64, uppercase: true }),
    size: shortText({ required: true, max: 30, uppercase: true }),
    colour: shortText({ required: true, max: 60, lowercase: true }),
    stock: {
      type: Number,
      required: true,
      min: 0,
      max: 1_000_000,
      validate: {
        validator: Number.isInteger,
        message: "Stock must be a whole number.",
      },
    },
    lowStockThreshold: {
      type: Number,
      required: true,
      min: 0,
      max: 1_000_000,
      default: 3,
      validate: {
        validator: Number.isInteger,
        message: "Low-stock threshold must be a whole number.",
      },
    },
  },
  { strict: "throw", _id: true, versionKey: false },
);

const mediaSchema = new mongoose.Schema(
  {
    assetId: ref("MediaAsset", { required: true, index: false }),
    type: {
      type: String,
      required: true,
      enum: Object.values(ProductMediaType),
    },
    url: shortText({ required: true, max: 1000 }),
    publicId: shortText({ required: true, max: 255 }),
    altText: shortText({ required: true, max: 180 }),
    position: {
      type: Number,
      required: true,
      min: 0,
      max: 1000,
      validate: {
        validator: Number.isInteger,
        message: "Media position must be a whole number.",
      },
    },
    posterUrl: shortText({ max: 1000 }),
  },
  { strict: "throw", _id: true, versionKey: false },
);

const productSchema = createSchema(
  {
    name: shortText({ required: true, max: 160 }),
    slug: { ...slug(), unique: true },
    shortDescription: shortText({ max: 300 }),
    description: longText({ max: 5000 }),
    category: ref("Category", { required: true, index: true }),
    collections: [{ ...ref("Collection"), index: false }],
    basePricePaise: paise({ required: true }),
    compareAtPricePaise: paise(),
    fabric: shortText({ max: 80, lowercase: true }),
    occasions: [shortText({ max: 80, lowercase: true })],
    careInstructions: longText({ max: 1500 }),
    madeIn: shortText({ max: 120 }),
    tags: [shortText({ max: 60, lowercase: true })],
    seo: {
      title: shortText({ max: 70 }),
      description: shortText({ max: 180 }),
    },
    variants: {
      type: [variantSchema],
      default: [],
      validate: {
        validator(variants) {
          const skus = variants.map((variant) => variant.sku.toUpperCase());
          return skus.length === new Set(skus).size;
        },
        message: "Variant SKUs must be unique within a product.",
      },
    },
    media: {
      type: [mediaSchema],
      default: [],
      validate: [
        {
          validator(media) {
            return media.length <= 30;
          },
          message: "A product may have at most 30 media items.",
        },
        {
          validator(media) {
            const positions = media.map((item) => item.position);
            return positions.length === new Set(positions).size;
          },
          message: "Media positions must be unique within a product.",
        },
        {
          validator(media) {
            const assetIds = media.map((item) => item.assetId?.toString());
            return (
              assetIds.every(Boolean) &&
              assetIds.length === new Set(assetIds).size
            );
          },
          message: "Media assets must be unique within a product.",
        },
        {
          validator(media) {
            return media.every((item) => !cloudinaryMediaError(item));
          },
          message: "Cloudinary media metadata is inconsistent.",
        },
      ],
    },
    isNewArrival: { type: Boolean, default: false },
    isBestseller: { type: Boolean, default: false },
    exchangeEligible: { type: Boolean, default: false },
    merchandisingRank: {
      type: Number,
      required: true,
      min: 0,
      max: 1_000_000,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: "Merchandising rank must be a whole number.",
      },
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(ProductStatus),
      default: ProductStatus.DRAFT,
    },
    publishedAt: Date,
    archivedAt: Date,
    isDemoData: demoFlag(),
  },
  { collection: "products" },
);

productSchema.path("variants").validate(function uniqueVariantSelections(
  variants,
) {
  const selections = variants.map(
    (variant) =>
      `${variant.size.toUpperCase()}\u0000${variant.colour.toLowerCase()}`,
  );
  return selections.length === new Set(selections).size;
}, "Variant size/colour combinations must be unique within a product.");

productSchema
  .path("compareAtPricePaise")
  .validate(function compareAtExceedsPrice(value) {
    return value === null || value === undefined || value > this.basePricePaise;
  }, "Compare-at price must be greater than the selling price.");

productSchema.index({ "variants.sku": 1 }, { unique: true, sparse: true });
productSchema.index({ "media.assetId": 1 });
productSchema.index({
  name: "text",
  shortDescription: "text",
  description: "text",
  tags: "text",
  fabric: "text",
  occasions: "text",
});
productSchema.index({ status: 1, createdAt: -1, _id: -1 });
productSchema.index({ status: 1, category: 1, createdAt: -1, _id: -1 });
productSchema.index({ status: 1, collections: 1, createdAt: -1, _id: -1 });
productSchema.index({ status: 1, basePricePaise: 1, _id: 1 });
productSchema.index({ status: 1, isNewArrival: -1, createdAt: -1 });
productSchema.index({
  status: 1,
  isBestseller: -1,
  merchandisingRank: -1,
  createdAt: -1,
  _id: -1,
});
productSchema.index({
  status: 1,
  merchandisingRank: -1,
  createdAt: -1,
  _id: -1,
});

export const Product = registerModel("Product", productSchema);
