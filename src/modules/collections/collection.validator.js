import { z } from "zod";
import {
  idParamSchema,
  paginationSchema,
  searchTermSchema,
  slugParamSchema,
  strictObject,
} from "../../validators/common.js";
import { verifiedImageAttachmentSchema } from "../media/media.validator.js";
import { CollectionStatus } from "./collection.model.js";

const nameSchema = z.string().trim().min(2).max(100);
const slugSchema = slugParamSchema.shape.slug;
const optionalText = (max) => z.string().trim().max(max).optional();

const seoSchema = strictObject({
  title: optionalText(70),
  description: optionalText(180),
}).optional();

const collectionShape = {
  name: nameSchema,
  slug: slugSchema,
  description: optionalText(2000),
  seo: seoSchema,
  editorialMedia: verifiedImageAttachmentSchema.nullable().optional(),
  featured: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
};

export const createCollectionSchema = strictObject(collectionShape);
export const updateCollectionSchema = strictObject(
  Object.fromEntries(
    Object.entries(collectionShape).map(([key, schema]) => [
      key,
      schema.optional(),
    ]),
  ),
).refine((value) => Object.keys(value).length > 0, {
  message: "Provide at least one field to update.",
});
export const collectionStatusSchema = strictObject({
  status: z.enum(Object.values(CollectionStatus)),
});
export const adminCollectionListQuerySchema = paginationSchema
  .extend({
    status: z.enum(Object.values(CollectionStatus)).optional(),
    q: searchTermSchema.refine((value) => value.length > 0).optional(),
  })
  .strict();

export {
  idParamSchema as collectionIdParamSchema,
  slugParamSchema as collectionSlugParamSchema,
};
