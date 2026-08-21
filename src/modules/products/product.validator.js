import { z } from "zod";
import {
  idParamSchema,
  objectIdSchema,
  paginationSchema,
  rupeeAmountSchema,
  searchTermSchema,
  slugParamSchema,
  strictObject,
} from "../../validators/common.js";
import {
  cloudinaryMediaError,
  parseCloudinaryDeliveryUrl,
} from "./cloudinaryMedia.js";
import { ProductMediaType, ProductStatus } from "./product.model.js";

const compactText = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) => z.string().trim().max(max).optional();
const lowerText = (max) =>
  compactText(max).transform((value) => value.toLowerCase());
const upperText = (max) =>
  compactText(max).transform((value) => value.toUpperCase());
const uniqueArray = (schema, max) =>
  z
    .array(schema)
    .max(max)
    .refine((values) => values.length === new Set(values).size, {
      message: "Values must not be repeated.",
    });

function cloudinaryUrlSchema() {
  return z
    .string()
    .url()
    .max(1000)
    .refine(
      (value) => Boolean(parseCloudinaryDeliveryUrl(value)),
      "Media must use a valid secure Cloudinary upload URL.",
    );
}

const cloudinaryPublicIdSchema = compactText(255).refine(
  (value) =>
    /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(value) &&
    !value.includes("..") &&
    !value.endsWith("/"),
  "Not a valid Cloudinary public ID.",
);

const seoSchema = strictObject({
  title: optionalText(70),
  description: optionalText(180),
}).optional();

const variantShape = {
  sku: upperText(64),
  size: upperText(30),
  colour: lowerText(60),
  stock: z.coerce.number().int().min(0).max(1_000_000),
  lowStockThreshold: z.coerce.number().int().min(0).max(1_000_000).default(3),
};
const variantSchema = strictObject(variantShape);
const updateVariantSchema = strictObject({
  id: objectIdSchema.optional(),
  ...variantShape,
});

function variantsAreUnique(variants) {
  const ids = variants.map((variant) => variant.id).filter(Boolean);
  const skus = variants.map((variant) => variant.sku);
  const selections = variants.map(
    (variant) => `${variant.size}\u0000${variant.colour}`,
  );
  return (
    ids.length === new Set(ids).size &&
    skus.length === new Set(skus).size &&
    selections.length === new Set(selections).size
  );
}

function variantListSchema(itemSchema) {
  return z
    .array(itemSchema)
    .max(100)
    .refine(variantsAreUnique, {
      message:
        "Variant IDs, SKUs, and size/colour combinations must be unique.",
      path: ["variants"],
    });
}

const mediaSchema = strictObject({
  assetId: objectIdSchema,
  type: z.enum(Object.values(ProductMediaType)),
  url: cloudinaryUrlSchema(),
  publicId: cloudinaryPublicIdSchema,
  altText: compactText(180),
  position: z.coerce.number().int().min(0).max(1000),
  posterUrl: cloudinaryUrlSchema().optional(),
}).superRefine((media, ctx) => {
  const message = cloudinaryMediaError(media);
  if (message) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [message.toLowerCase().includes("poster") ? "posterUrl" : "url"],
      message,
    });
  }
});

const productShape = {
  name: compactText(160),
  slug: slugParamSchema.shape.slug,
  shortDescription: optionalText(300),
  description: optionalText(5000),
  categoryId: objectIdSchema,
  collectionIds: uniqueArray(objectIdSchema, 30).default([]),
  basePriceRupees: rupeeAmountSchema,
  compareAtPriceRupees: rupeeAmountSchema.nullable().optional(),
  fabric: lowerText(80).optional(),
  occasions: uniqueArray(lowerText(80), 20).default([]),
  careInstructions: optionalText(1500),
  madeIn: optionalText(120),
  tags: uniqueArray(lowerText(60), 30).default([]),
  variants: variantListSchema(variantSchema).default([]),
  media: z
    .array(mediaSchema)
    .max(30)
    .refine(
      (media) => {
        const positions = media.map((item) => item.position);
        return positions.length === new Set(positions).size;
      },
      { message: "Media positions must be unique.", path: ["media"] },
    )
    .refine(
      (media) => {
        const assetIds = media.map((item) => item.assetId);
        return assetIds.length === new Set(assetIds).size;
      },
      { message: "Media assets must not be repeated.", path: ["media"] },
    )
    .default([]),
  isNewArrival: z.boolean().optional(),
  isBestseller: z.boolean().optional(),
  exchangeEligible: z.boolean().optional(),
  merchandisingRank: z.coerce.number().int().min(0).max(1_000_000).optional(),
  seo: seoSchema,
};

function validatePrices(value, ctx) {
  if (
    value.compareAtPriceRupees !== null &&
    value.compareAtPriceRupees !== undefined &&
    value.basePriceRupees !== undefined &&
    value.compareAtPriceRupees <= value.basePriceRupees
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["compareAtPriceRupees"],
      message: "Compare-at price must be greater than the selling price.",
    });
  }
}

export const createProductSchema =
  strictObject(productShape).superRefine(validatePrices);

const updateShape = Object.fromEntries(
  Object.entries(productShape).map(([key, schema]) => [key, schema.optional()]),
);
updateShape.variants = variantListSchema(updateVariantSchema).optional();
export const updateProductSchema = strictObject(updateShape)
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  })
  .superRefine(validatePrices);

export const productStatusSchema = strictObject({
  status: z.enum(Object.values(ProductStatus)),
});

export const productListQuerySchema = paginationSchema
  .extend({
    q: searchTermSchema.refine((value) => value.length > 0).optional(),
    category: slugParamSchema.shape.slug.optional(),
    collection: slugParamSchema.shape.slug.optional(),
    size: upperText(30).optional(),
    colour: lowerText(60).optional(),
    minPrice: rupeeAmountSchema.optional(),
    maxPrice: rupeeAmountSchema.optional(),
    availability: z.enum(["in-stock", "out-of-stock"]).optional(),
    occasion: lowerText(80).optional(),
    fabric: lowerText(80).optional(),
    newArrival: z
      .enum(["true"])
      .transform(() => true)
      .optional(),
    sort: z
      .enum(["newest", "price-asc", "price-desc", "popular", "best-selling"])
      .default("newest"),
  })
  .strict()
  .refine(
    (value) =>
      value.minPrice === undefined ||
      value.maxPrice === undefined ||
      value.minPrice <= value.maxPrice,
    {
      message: "Minimum price cannot exceed maximum price.",
      path: ["minPrice"],
    },
  );

export const adminProductListQuerySchema = paginationSchema
  .extend({
    status: z.enum(Object.values(ProductStatus)).optional(),
    q: searchTermSchema.refine((value) => value.length > 0).optional(),
    categoryId: objectIdSchema.optional(),
    collectionId: objectIdSchema.optional(),
    sort: z.enum(["newest", "oldest", "updated", "name"]).default("newest"),
  })
  .strict();

export const relatedProductsQuerySchema = strictObject({
  limit: z.coerce.number().int().min(1).max(12).default(4),
});

export {
  idParamSchema as productIdParamSchema,
  slugParamSchema as productSlugParamSchema,
};
