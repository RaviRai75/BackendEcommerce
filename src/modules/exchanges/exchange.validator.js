import { z } from "zod";
import {
  objectIdSchema,
  paginationSchema,
  strictObject,
} from "../../validators/common.js";
import { idempotencyKeySchema, orderNumberParamSchema } from "../orders/order.validator.js";
import { ExchangeReason } from "./exchangePolicy.model.js";

const lineTokenSchema = z
  .string()
  .min(20)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "Not a valid line token.");

export const exchangeEligibilityParamSchema = orderNumberParamSchema;

export const createExchangeSchema = strictObject({
  orderNumber: orderNumberParamSchema.shape.orderNumber,
  lineToken: lineTokenSchema,
  requestedSize: z.string().trim().toUpperCase().min(1).max(30),
  reason: z.enum(Object.values(ExchangeReason)),
  comment: z.string().trim().min(1).max(500).optional(),
  photoAssetIds: z
    .array(objectIdSchema)
    .max(5)
    .refine((ids) => ids.length === new Set(ids).size, {
      message: "Photo assets must not be repeated.",
    }),
}).superRefine((input, ctx) => {
  if (input.reason === ExchangeReason.OTHER && !input.comment) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["comment"],
      message: "Please describe the reason for this exchange.",
    });
  }
});

export const exchangeListQuerySchema = paginationSchema.strict();

export const exchangeNumberParamSchema = strictObject({
  exchangeNumber: z
    .string()
    .trim()
    .min(1)
    .max(48)
    .regex(/^[A-Za-z0-9_-]+$/, "Not a valid exchange number."),
});

export { idempotencyKeySchema };
