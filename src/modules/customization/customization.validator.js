import { z } from "zod";
import {
  emailSchema,
  objectIdSchema,
  paginationSchema,
  personNameSchema,
  phoneSchema,
  pincodeSchema,
  strictObject,
} from "../../validators/common.js";
import {
  idempotencyKeySchema,
  shippingAddressSchema,
} from "../orders/order.validator.js";
import { verifiedImageAttachmentSchema } from "../media/media.validator.js";
import {
  CustomPriority,
  CustomRequestAction,
  CustomRequestStatus,
  CustomRequestType,
} from "./customRequest.model.js";
import { CustomMessageVisibility } from "./customRequestMessage.model.js";
import {
  CustomCompletionStatus,
  CustomFulfillmentStatus,
  CustomOrderPaymentStatus,
  CustomProductionStatus,
} from "./customOrder.model.js";
import { MeasurementUnit } from "./customizationConfig.js";

const plainText = (min, max, singleLine = false) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .refine((value) => value.length >= min, `Use at least ${min} characters.`)
    .refine((value) => value.length <= max, `Use ${max} characters or fewer.`)
    .refine(
      (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value),
      "Text contains unsupported control characters.",
    )
    .refine(
      (value) => !/<\/?[A-Za-z][^>]*>/.test(value),
      "HTML is not supported.",
    )
    .refine(
      (value) => !singleLine || !value.includes("\n"),
      "Use a single line.",
    );
const version = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const key = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_-]{1,39}$/);
const requestNumber = z
  .string()
  .trim()
  .regex(/^CUS-[1-9]\d{4,11}$/)
  .max(16);
const policy = strictObject({
  revision: z.coerce.number().int().positive(),
  hash: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-f0-9]{64}$/),
});
const measurement = strictObject({
  key,
  value: z.coerce.number().nonnegative().max(1000),
  unit: z.enum(Object.values(MeasurementUnit)),
});
const selectedOption = strictObject({ groupKey: key, choiceKey: key });
const sizing = strictObject({
  ageGroupKey: key.optional(),
  sizeKey: key.optional(),
  measurements: z.array(measurement).max(30).default([]),
  profileId: objectIdSchema.optional(),
}).refine(
  (value) =>
    value.measurements.length ===
    new Set(value.measurements.map((item) => item.key)).size,
  "Measurement keys must be unique.",
);
const requirements = strictObject({
  description: plainText(10, 5000),
  selectedOptions: z.array(selectedOption).max(30).default([]),
  preferredColour: plainText(1, 80, true).optional(),
  preferredFabric: plainText(1, 80, true).optional(),
  occasion: plainText(1, 120, true).optional(),
  budgetPreference: plainText(1, 120, true).optional(),
  additionalNotes: plainText(1, 2000).optional(),
});

export const submitCustomRequestSchema = strictObject({
  type: z.enum(Object.values(CustomRequestType)),
  categoryId: objectIdSchema,
  productId: objectIdSchema.optional(),
  variantId: objectIdSchema.optional(),
  policyAcknowledgement: policy,
  requirements,
  sizing,
  references: z.array(verifiedImageAttachmentSchema).max(10).default([]),
}).superRefine((value, ctx) => {
  if (value.type === CustomRequestType.EXISTING_PRODUCT && !value.productId)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["productId"],
      message: "Choose the product to customize.",
    });
  if (
    value.type === CustomRequestType.OWN_DESIGN &&
    (value.productId || value.variantId)
  )
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["productId"],
      message: "Own-design requests cannot carry product identity.",
    });
});

export const customRequestParamsSchema = strictObject({ requestNumber });
export const customOrderParamsSchema = strictObject({
  orderNumber: z
    .string()
    .trim()
    .regex(/^CUS-[1-9]\d{4,11}-ORDER$/)
    .max(24),
});
export const customListSchema = paginationSchema
  .extend({ status: z.enum(Object.values(CustomRequestStatus)).optional() })
  .strict();
export const adminCustomListSchema = customListSchema
  .extend({
    priority: z.enum(Object.values(CustomPriority)).optional(),
    type: z.enum(Object.values(CustomRequestType)).optional(),
    categoryId: objectIdSchema.optional(),
  })
  .strict();
export const adminCustomOrderListSchema = paginationSchema
  .extend({
    paymentStatus: z.enum(Object.values(CustomOrderPaymentStatus)).optional(),
    productionStatus: z.enum(Object.values(CustomProductionStatus)).optional(),
    fulfillmentStatus: z
      .enum(Object.values(CustomFulfillmentStatus))
      .optional(),
    completionStatus: z.enum(Object.values(CustomCompletionStatus)).optional(),
  })
  .strict();
export const customMessageListSchema = paginationSchema
  .extend({
    visibility: z.enum(Object.values(CustomMessageVisibility)).optional(),
  })
  .strict();
export const customMessageSchema = strictObject({
  message: plainText(1, 4000),
});

export const customAdminActionSchema = z.discriminatedUnion("action", [
  strictObject({
    action: z.literal(CustomRequestAction.START_REVIEW),
    expectedVersion: version,
  }),
  strictObject({
    action: z.literal(CustomRequestAction.START_FEASIBILITY),
    expectedVersion: version,
  }),
  strictObject({
    action: z.literal(CustomRequestAction.REQUEST_INFORMATION),
    expectedVersion: version,
  }),
  strictObject({
    action: z.literal(CustomRequestAction.REJECT),
    expectedVersion: version,
  }),
  strictObject({
    action: z.literal(CustomRequestAction.SET_PRIORITY),
    expectedVersion: version,
    priority: z.enum(Object.values(CustomPriority)),
  }),
  strictObject({
    action: z.literal(CustomRequestAction.CANCEL),
    expectedVersion: version,
  }),
]);

const paise = z.coerce.number().int().min(0).max(1_000_000_000);
export const prepareQuoteSchema = strictObject({
  expectedRequestVersion: version,
  basePaise: paise,
  customizationPaise: paise,
  materialPaise: paise,
  otherPaise: paise,
  shippingPaise: paise,
  discountPaise: paise,
  productionEstimate: plainText(1, 500).optional(),
  deliveryEstimate: plainText(1, 500).optional(),
  expiryDays: z.coerce.number().int().min(1).max(90),
});
export const sendQuoteSchema = strictObject({
  expectedRequestVersion: version,
  expectedQuoteVersion: version,
});
export const requestQuoteChangesSchema = strictObject({
  expectedRequestVersion: version,
  expectedQuoteVersion: version,
  message: plainText(1, 4000),
});
export const acceptQuoteSchema = strictObject({
  expectedRequestVersion: version,
  expectedQuoteVersion: version,
  policyAcknowledgement: policy,
  shippingAddress: shippingAddressSchema,
});

export const profileSchema = strictObject({
  name: plainText(1, 80, true),
  ageGroup: plainText(1, 80, true).optional(),
  size: plainText(1, 80, true).optional(),
  measurements: z
    .array(measurement.extend({ label: plainText(1, 80, true) }))
    .max(30)
    .default([]),
});
export const updateProfileSchema = profileSchema
  .extend({ expectedVersion: version })
  .partial({ name: true, ageGroup: true, size: true, measurements: true })
  .refine(
    (value) => Object.keys(value).some((field) => field !== "expectedVersion"),
    "Provide a field to update.",
  );
export const profileIdSchema = strictObject({ id: objectIdSchema });
export const profileDeleteQuerySchema = strictObject({
  expectedVersion: version,
});

export const productionActionSchema = z.discriminatedUnion("action", [
  strictObject({
    action: z.literal(CustomRequestAction.START_PRODUCTION),
    expectedVersion: version,
  }),
  strictObject({
    action: z.literal(CustomRequestAction.START_QUALITY_CHECK),
    expectedVersion: version,
  }),
  strictObject({
    action: z.literal(CustomRequestAction.MARK_READY_TO_SHIP),
    expectedVersion: version,
  }),
]);
export const fulfillmentActionSchema = z.discriminatedUnion("action", [
  strictObject({
    action: z.literal(CustomRequestAction.RECORD_SHIPMENT),
    expectedVersion: version,
    courier: plainText(1, 100, true),
    awb: plainText(1, 200, true),
    trackingId: plainText(1, 200, true),
    shipmentId: plainText(1, 200, true),
  }),
  strictObject({
    action: z.literal(CustomRequestAction.MARK_OUT_FOR_DELIVERY),
    expectedVersion: version,
  }),
  strictObject({
    action: z.literal(CustomRequestAction.MARK_DELIVERED),
    expectedVersion: version,
  }),
  strictObject({
    action: z.literal(CustomRequestAction.COMPLETE),
    expectedVersion: version,
  }),
]);
export const cancelCustomOrderSchema = strictObject({
  expectedVersion: version,
});
export const customPaymentVerifySchema = strictObject({
  attemptId: objectIdSchema,
  checkoutToken: z.string().regex(/^[a-f0-9]{64}$/i),
});
export const supportHandoffSchema = strictObject({
  subject: plainText(3, 160, true),
  message: plainText(1, 4000),
});
export const customReferenceIntentSchema = strictObject({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => !/[\\/\u0000-\u001F\u007F]/.test(value)),
  mimeType: z.string().trim().toLowerCase().min(1).max(100),
  sizeBytes: z.coerce
    .number()
    .int()
    .positive()
    .max(500 * 1024 * 1024),
});
export { idempotencyKeySchema };
