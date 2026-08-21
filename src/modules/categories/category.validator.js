import { z } from "zod";
import {
  idParamSchema,
  paginationSchema,
  searchTermSchema,
  slugParamSchema,
  strictObject,
} from "../../validators/common.js";
import { CategoryStatus } from "./category.model.js";

const nameSchema = z.string().trim().min(2).max(100);
const slugSchema = slugParamSchema.shape.slug;
const optionalText = (max) => z.string().trim().max(max).optional();

const seoSchema = strictObject({
  title: optionalText(70),
  description: optionalText(180),
}).optional();

const categoryShape = {
  name: nameSchema,
  slug: slugSchema,
  description: optionalText(2000),
  seo: seoSchema,
  sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
};

export const createCategorySchema = strictObject(categoryShape);
export const updateCategorySchema = strictObject(
  Object.fromEntries(
    Object.entries(categoryShape).map(([key, schema]) => [
      key,
      schema.optional(),
    ]),
  ),
).refine((value) => Object.keys(value).length > 0, {
  message: "Provide at least one field to update.",
});
export const categoryStatusSchema = strictObject({
  status: z.enum(Object.values(CategoryStatus)),
});
export const adminCategoryListQuerySchema = paginationSchema
  .extend({
    status: z.enum(Object.values(CategoryStatus)).optional(),
    q: searchTermSchema.refine((value) => value.length > 0).optional(),
  })
  .strict();

export {
  idParamSchema as categoryIdParamSchema,
  slugParamSchema as categorySlugParamSchema,
};
