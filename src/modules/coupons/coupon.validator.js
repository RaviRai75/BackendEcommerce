import { z } from "zod";
import {
  isoDateSchema,
  objectIdSchema,
  paginationSchema,
  searchTermSchema,
  strictObject,
} from "../../validators/common.js";
import { cartItemsSchema } from "../cart/cart.validator.js";
import {
  COUPON_MAX_REFERENCES,
  CouponDiscountType,
  CouponStatus,
} from "./coupon.model.js";

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3)
  .max(32)
  .regex(
    /^[A-Z0-9_-]{3,32}$/,
    "Use only A-Z, numbers, underscores, and hyphens.",
  );
const paiseSchema = z.number().int().min(0).max(1_000_000_000);
const positivePaiseSchema = paiseSchema.min(1);
const usageLimitSchema = z.number().int().positive().nullable();
const uniqueIds = z
  .array(objectIdSchema)
  .max(COUPON_MAX_REFERENCES)
  .transform((values) => [...new Set(values)]);

export const validateCouponSchema = strictObject({
  code: codeSchema,
  items: cartItemsSchema,
});

const writableShape = {
  code: codeSchema,
  discountType: z.enum(Object.values(CouponDiscountType)),
  percentageBasisPoints: z.number().int().min(1).max(10_000),
  flatDiscountPaise: positivePaiseSchema,
  minimumOrderPaise: paiseSchema,
  startsAt: isoDateSchema.nullable(),
  expiresAt: isoDateSchema,
  usageLimit: usageLimitSchema,
  perCustomerUsageLimit: usageLimitSchema,
  firstOrderOnly: z.boolean(),
  eligibleUserIds: uniqueIds,
  applicableProductIds: uniqueIds,
  applicableCategoryIds: uniqueIds,
  status: z.enum(Object.values(CouponStatus)),
};

function validateDiscount(value, ctx) {
  if (value.discountType === CouponDiscountType.PERCENTAGE) {
    if (value.percentageBasisPoints === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["percentageBasisPoints"],
        message: "Required for percentage coupons.",
      });
    }
    if (value.flatDiscountPaise !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["flatDiscountPaise"],
        message: "Not allowed for percentage coupons.",
      });
    }
  }
  if (value.discountType === CouponDiscountType.FLAT) {
    if (value.flatDiscountPaise === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["flatDiscountPaise"],
        message: "Required for flat coupons.",
      });
    }
    if (value.percentageBasisPoints !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["percentageBasisPoints"],
        message: "Not allowed for flat coupons.",
      });
    }
  }
  if (value.startsAt && value.expiresAt && value.expiresAt <= value.startsAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "Expiry must be later than the start date.",
    });
  }
}

function validateUpdateDiscount(value, ctx) {
  if (
    value.discountType === CouponDiscountType.PERCENTAGE &&
    value.flatDiscountPaise !== undefined
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["flatDiscountPaise"],
      message: "Not allowed for percentage coupons.",
    });
  }
  if (
    value.discountType === CouponDiscountType.FLAT &&
    value.percentageBasisPoints !== undefined
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["percentageBasisPoints"],
      message: "Not allowed for flat coupons.",
    });
  }
}

export const createCouponSchema = strictObject({
  code: writableShape.code,
  discountType: writableShape.discountType,
  percentageBasisPoints: writableShape.percentageBasisPoints.optional(),
  flatDiscountPaise: writableShape.flatDiscountPaise.optional(),
  minimumOrderPaise: writableShape.minimumOrderPaise.default(0),
  startsAt: writableShape.startsAt.default(null),
  expiresAt: writableShape.expiresAt,
  usageLimit: writableShape.usageLimit.default(null),
  perCustomerUsageLimit: writableShape.perCustomerUsageLimit.default(1),
  firstOrderOnly: writableShape.firstOrderOnly.default(false),
  eligibleUserIds: writableShape.eligibleUserIds.default([]),
  applicableProductIds: writableShape.applicableProductIds.default([]),
  applicableCategoryIds: writableShape.applicableCategoryIds.default([]),
  status: writableShape.status.default(CouponStatus.DRAFT),
}).superRefine(validateDiscount);

export const updateCouponSchema = strictObject({
  expectedRevision: z.coerce.number().int().min(0),
  ...Object.fromEntries(
    Object.entries(writableShape).map(([key, schema]) => [
      key,
      schema.optional(),
    ]),
  ),
})
  .superRefine(validateUpdateDiscount)
  .refine(
    (value) => Object.keys(value).some((key) => key !== "expectedRevision"),
    {
      message: "Provide at least one field to update.",
    },
  );

export const customerOptionSearchSchema = strictObject({
  q: searchTermSchema
    .refine((value) => value.length >= 2, "Enter at least 2 characters.")
    .optional(),
  ids: uniqueIds.optional(),
  limit: z.coerce.number().int().min(1).max(20).default(20),
}).refine((value) => Boolean(value.q || value.ids?.length), {
  message: "Provide a search term or selected customer IDs.",
});

export const adminCouponListQuerySchema = paginationSchema
  .extend({
    status: z.enum(Object.values(CouponStatus)).optional(),
    q: searchTermSchema.refine((value) => value.length > 0).optional(),
  })
  .strict();

export const couponIdParamSchema = strictObject({ couponId: objectIdSchema });
