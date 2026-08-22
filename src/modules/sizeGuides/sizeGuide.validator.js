import { z } from "zod";
import {
  idParamSchema,
  paginationSchema,
  searchTermSchema,
  slugParamSchema,
  strictObject,
} from "../../validators/common.js";
import { isStructuredPlainText } from "../content/contentText.js";
import { SIZE_GUIDE_LIMITS } from "./sizeGuide.model.js";

const plainText = (max, { optional = false, allowEmpty = false } = {}) => {
  let schema = z.string().trim().max(max);
  if (!allowEmpty) schema = schema.min(1);
  schema = schema.refine(
    isStructuredPlainText,
    "Use plain text without HTML, Markdown, active content, or control characters.",
  );
  if (optional) schema = schema.optional();
  return schema;
};

const stableKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(SIZE_GUIDE_LIMITS.key)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and single hyphens only.",
  );

const columnSchema = strictObject({
  key: stableKeySchema,
  label: plainText(SIZE_GUIDE_LIMITS.label),
});

const rowSchema = strictObject({
  sizeKey: stableKeySchema,
  label: plainText(SIZE_GUIDE_LIMITS.label),
  cells: z
    .array(plainText(SIZE_GUIDE_LIMITS.cell, { allowEmpty: true }))
    .max(SIZE_GUIDE_LIMITS.columns),
});

export const sizeGuideContentSchema = strictObject({
  title: plainText(SIZE_GUIDE_LIMITS.title),
  summary: plainText(SIZE_GUIDE_LIMITS.summary, { optional: true }),
  notes: plainText(SIZE_GUIDE_LIMITS.notes, { optional: true }),
  showOnStandalone: z.boolean().default(false),
  columns: z.array(columnSchema).min(1).max(SIZE_GUIDE_LIMITS.columns),
  rows: z.array(rowSchema).min(1).max(SIZE_GUIDE_LIMITS.rows),
}).superRefine((content, ctx) => {
  const columnKeys = content.columns.map((column) => column.key);
  if (columnKeys.length !== new Set(columnKeys).size) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["columns"],
      message: "Column keys must be unique.",
    });
  }

  const rowKeys = content.rows.map((row) => row.sizeKey);
  if (rowKeys.length !== new Set(rowKeys).size) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rows"],
      message: "Row size keys must be unique.",
    });
  }

  content.rows.forEach((row, index) => {
    if (row.cells.length !== content.columns.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rows", index, "cells"],
        message: "Provide exactly one cell per column.",
      });
    }
  });

  const characterCount = [
    content.title,
    content.summary,
    content.notes,
    ...content.columns.flatMap((column) => [column.key, column.label]),
    ...content.rows.flatMap((row) => [row.sizeKey, row.label, ...row.cells]),
  ].reduce(
    (total, value) => total + (typeof value === "string" ? value.length : 0),
    0,
  );
  if (characterCount > SIZE_GUIDE_LIMITS.totalCharacters) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rows"],
      message: `A size guide must be ${SIZE_GUIDE_LIMITS.totalCharacters} characters or fewer.`,
    });
  }
});

const revisionSchema = z.coerce.number().int().min(0);

export const createSizeGuideSchema = strictObject({
  slug: slugParamSchema.shape.slug,
  content: sizeGuideContentSchema,
});

export const saveSizeGuideDraftSchema = strictObject({
  expectedDraftRevision: revisionSchema,
  content: sizeGuideContentSchema,
});

export const publishSizeGuideSchema = strictObject({
  expectedDraftRevision: revisionSchema,
  expectedPublishedRevision: revisionSchema,
});

export const unpublishSizeGuideSchema = strictObject({
  expectedPublishedRevision: revisionSchema,
});

export const publicSizeGuideListQuerySchema = paginationSchema.strict();

export const adminSizeGuideListQuerySchema = paginationSchema
  .extend({
    state: z.enum(["PUBLISHED", "UNPUBLISHED"]).optional(),
    q: searchTermSchema.refine((value) => value.length > 0).optional(),
  })
  .strict();

export {
  idParamSchema as sizeGuideIdParamSchema,
  slugParamSchema as sizeGuideSlugParamSchema,
};
