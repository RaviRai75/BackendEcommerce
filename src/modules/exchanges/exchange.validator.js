import { z } from "zod";
import {
  objectIdSchema,
  paginationSchema,
  searchTermSchema,
  strictObject,
} from "../../validators/common.js";
import {
  idempotencyKeySchema,
  orderNumberParamSchema,
} from "../orders/order.validator.js";
import {
  ExchangeAction,
  ExchangeQcResult,
  ExchangeStatus,
} from "./exchange.model.js";
import { ExchangeReason } from "./exchangePolicy.model.js";

const lineTokenSchema = z
  .string()
  .min(20)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "Not a valid line token.");

const expectedVersionSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
const publicMessageSchema = z.string().trim().min(1).max(500);
const internalNoteSchema = z.string().trim().min(1).max(1000);
const optionalMessages = {
  publicMessage: publicMessageSchema.optional(),
  internalNote: internalNoteSchema.optional(),
};
const shipmentFields = {
  courier: z.string().trim().min(1).max(100),
  awb: z.string().trim().min(1).max(200),
  trackingId: z.string().trim().min(1).max(200),
  shipmentId: z.string().trim().min(1).max(200),
  trackingStatus: z.string().trim().min(1).max(120).optional(),
};

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

export const adminExchangeListQuerySchema = paginationSchema
  .extend({
    status: z.enum(Object.values(ExchangeStatus)).optional(),
    q: searchTermSchema
      .refine((value) => value.length > 0, {
        message: "Search cannot be empty.",
      })
      .optional(),
  })
  .strict();

export const exchangeNumberParamSchema = strictObject({
  exchangeNumber: z
    .string()
    .trim()
    .min(1)
    .max(48)
    .regex(/^[A-Za-z0-9_-]+$/, "Not a valid exchange number."),
});

const actionSchemas = [
  strictObject({
    action: z.literal(ExchangeAction.REQUEST_INFORMATION),
    expectedVersion: expectedVersionSchema,
    publicMessage: publicMessageSchema,
    internalNote: internalNoteSchema.optional(),
  }),
  strictObject({
    action: z.literal(ExchangeAction.APPROVE),
    expectedVersion: expectedVersionSchema,
    ...optionalMessages,
  }),
  strictObject({
    action: z.literal(ExchangeAction.REJECT),
    expectedVersion: expectedVersionSchema,
    publicMessage: publicMessageSchema,
    internalNote: internalNoteSchema.optional(),
  }),
  strictObject({
    action: z.literal(ExchangeAction.RECORD_FEE),
    expectedVersion: expectedVersionSchema,
    amountPaise: z.number().int().nonnegative().max(1_000_000_000),
    currency: z.literal("INR"),
    ...optionalMessages,
  }),
  strictObject({
    action: z.literal(ExchangeAction.RECORD_REVERSE_SHIPMENT),
    expectedVersion: expectedVersionSchema,
    ...shipmentFields,
    ...optionalMessages,
  }),
  strictObject({
    action: z.literal(ExchangeAction.MARK_RECEIVED),
    expectedVersion: expectedVersionSchema,
    ...optionalMessages,
  }),
  strictObject({
    action: z.literal(ExchangeAction.UPDATE_QC),
    expectedVersion: expectedVersionSchema,
    result: z.enum(Object.values(ExchangeQcResult)),
    ...optionalMessages,
  }),
  strictObject({
    action: z.literal(ExchangeAction.RECORD_REPLACEMENT_SHIPMENT),
    expectedVersion: expectedVersionSchema,
    ...shipmentFields,
    ...optionalMessages,
  }),
  strictObject({
    action: z.literal(ExchangeAction.COMPLETE),
    expectedVersion: expectedVersionSchema,
    ...optionalMessages,
  }),
];

export const adminExchangeActionSchema = z
  .discriminatedUnion("action", actionSchemas)
  .superRefine((input, ctx) => {
    if (
      input.action === ExchangeAction.UPDATE_QC &&
      input.result === ExchangeQcResult.FAILED &&
      !input.publicMessage
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publicMessage"],
        message: "Explain the failed quality check to the customer.",
      });
    }
  });

export { idempotencyKeySchema };
