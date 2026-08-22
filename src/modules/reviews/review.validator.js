import { z } from "zod";
import {
  objectIdSchema,
  paginationSchema,
  searchTermSchema,
  strictObject,
} from "../../validators/common.js";
import { orderNumberParamSchema } from "../orders/order.validator.js";
import { ReviewModerationAction, ReviewStatus } from "./review.model.js";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RANDOM_HEX_PATTERN = /^[0-9a-f]{64,128}$/i;
const RANDOM_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43,200}$/;

export const idempotencyKeySchema = z
  .string()
  .min(32)
  .max(200)
  .regex(/^[\x21-\x7E]+$/, "Use a high-entropy printable key without spaces.")
  .refine(
    (value) =>
      UUID_V4_PATTERN.test(value) ||
      ((RANDOM_HEX_PATTERN.test(value) ||
        RANDOM_BASE64URL_PATTERN.test(value)) &&
        new Set(value.toLowerCase()).size >= 12),
    {
      message:
        "Use a UUID v4 or a cryptographically random 32-byte hex/base64url key.",
    },
  );

const lineTokenSchema = z
  .string()
  .min(20)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "Not a valid line token.");

const plainTextCommentSchema = z
  .string()
  .trim()
  .min(10)
  .max(2000)
  // eslint-disable-next-line no-control-regex
  .refine(
    (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value),
    {
      message: "Review comment contains unsupported control characters.",
    },
  )
  .refine((value) => !/<\/?[A-Za-z][^>]*>/.test(value), {
    message: "Review comment must be plain text, not HTML.",
  });

export const reviewEligibilityParamSchema = orderNumberParamSchema;

export const createReviewSchema = strictObject({
  orderNumber: orderNumberParamSchema.shape.orderNumber,
  lineToken: lineTokenSchema,
  rating: z.number().int().min(1).max(5),
  comment: plainTextCommentSchema,
  photoAssetId: objectIdSchema.optional(),
});

export const reviewListQuerySchema = paginationSchema
  .extend({ status: z.enum(Object.values(ReviewStatus)).optional() })
  .strict();

export const publicReviewListQuerySchema = paginationSchema
  .extend({ rating: z.coerce.number().int().min(1).max(5).optional() })
  .strict();

export const adminReviewListQuerySchema = paginationSchema
  .extend({
    status: z.enum(Object.values(ReviewStatus)).optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    q: searchTermSchema
      .refine((value) => value.length > 0, {
        message: "Search cannot be empty.",
      })
      .optional(),
    productId: objectIdSchema.optional(),
  })
  .strict();

export const reviewIdParamSchema = strictObject({ id: objectIdSchema });

export const adminReviewActionSchema = strictObject({
  action: z.enum(Object.values(ReviewModerationAction)),
  expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  internalNote: z.string().trim().min(1).max(1000).optional(),
});
