import { z } from "zod";
import {
  idParamSchema,
  paginationSchema,
  searchTermSchema,
  strictObject,
} from "../../validators/common.js";
import { idempotencyKeySchema } from "../orders/order.validator.js";
import {
  SupportAction,
  SupportCategory,
  SupportContextKind,
  SupportPriority,
  SupportStatus,
} from "./supportTicket.model.js";
import { SupportMessageVisibility } from "./supportMessage.model.js";

const plainText = (min, max, singleLine = false) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .refine((value) => value.length >= min, {
      message: `Use at least ${min} character${min === 1 ? "" : "s"}.`,
    })
    .refine((value) => value.length <= max, {
      message: `Use ${max} characters or fewer.`,
    })
    .refine(
      (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value),
      { message: "Text contains unsupported control characters." },
    )
    .refine((value) => !/<\/?[A-Za-z][^>]*>/.test(value), {
      message: "HTML is not supported.",
    })
    .refine((value) => !singleLine || !value.includes("\n"), {
      message: "Use a single line of text.",
    });

const referenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Not a valid reference.");
const expectedVersionSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);

const contextSchemas = [
  strictObject({
    kind: z.literal(SupportContextKind.ORDER),
    reference: referenceSchema,
  }),
  strictObject({
    kind: z.literal(SupportContextKind.EXCHANGE),
    reference: referenceSchema,
  }),
  strictObject({
    kind: z.literal(SupportContextKind.CUSTOM_REQUEST),
    reference: z
      .string()
      .trim()
      .regex(/^CUS-[1-9]\d{4,11}$/)
      .max(16),
  }),
];

export const createSupportTicketSchema = strictObject({
  category: z.enum(Object.values(SupportCategory)),
  subject: plainText(3, 160, true),
  message: plainText(1, 4000),
  context: z.discriminatedUnion("kind", contextSchemas).optional(),
});

export const supportReplySchema = strictObject({
  message: plainText(1, 4000),
});

export const supportTicketNumberParamSchema = strictObject({
  ticketNumber: z
    .string()
    .trim()
    .min(20)
    .max(64)
    .regex(/^SUP_[A-Za-z0-9_-]+$/, "Not a valid support ticket number."),
});

export const customerSupportListQuerySchema = paginationSchema
  .extend({
    status: z.enum(Object.values(SupportStatus)).optional(),
    category: z.enum(Object.values(SupportCategory)).optional(),
  })
  .strict();

export const adminSupportListQuerySchema = paginationSchema
  .extend({
    status: z.enum(Object.values(SupportStatus)).optional(),
    priority: z.enum(Object.values(SupportPriority)).optional(),
    category: z.enum(Object.values(SupportCategory)).optional(),
  })
  .strict();

export const adminSupportSearchBodySchema = adminSupportListQuerySchema
  .extend({
    q: searchTermSchema
      .refine((value) => value.length > 0, {
        message: "Search cannot be empty.",
      })
      .optional(),
  })
  .strict();

export const customerSupportMessageQuerySchema = paginationSchema.strict();

export const adminSupportMessageQuerySchema = paginationSchema
  .extend({
    visibility: z.enum(Object.values(SupportMessageVisibility)).optional(),
  })
  .strict();

const actionSchemas = [
  strictObject({
    action: z.literal(SupportAction.START_PROGRESS),
    expectedVersion: expectedVersionSchema,
  }),
  strictObject({
    action: z.literal(SupportAction.RESOLVE),
    expectedVersion: expectedVersionSchema,
  }),
  strictObject({
    action: z.literal(SupportAction.CLOSE),
    expectedVersion: expectedVersionSchema,
  }),
  strictObject({
    action: z.literal(SupportAction.REOPEN),
    expectedVersion: expectedVersionSchema,
  }),
  strictObject({
    action: z.literal(SupportAction.SET_PRIORITY),
    expectedVersion: expectedVersionSchema,
    priority: z.enum(Object.values(SupportPriority)),
  }),
];

export const supportActionSchema = z.discriminatedUnion(
  "action",
  actionSchemas,
);

export const createQuickReplySchema = strictObject({
  title: plainText(1, 100, true),
  body: plainText(1, 2000),
});

export const updateQuickReplySchema = strictObject({
  expectedVersion: expectedVersionSchema,
  title: plainText(1, 100, true).optional(),
  body: plainText(1, 2000).optional(),
}).refine((value) => value.title !== undefined || value.body !== undefined, {
  message: "Provide a title or body to update.",
});

export const deleteQuickReplyQuerySchema = strictObject({
  expectedVersion: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const quickReplyListQuerySchema = paginationSchema.strict();
export const quickReplyIdParamSchema = idParamSchema;
export { idempotencyKeySchema };
