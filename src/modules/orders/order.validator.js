import { z } from "zod";
import {
  emailSchema,
  paginationSchema,
  personNameSchema,
  phoneSchema,
  pincodeSchema,
  searchTermSchema,
  strictObject,
} from "../../validators/common.js";
import {
  OrderFulfillmentAction,
  OrderFulfillmentStatus,
  OrderPaymentMethod,
  OrderPaymentStatus,
} from "./order.model.js";

const boundedLine = (max) => z.string().trim().min(1).max(max);
const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3)
  .max(32)
  .regex(/^[A-Z0-9_-]{3,32}$/)
  .nullable()
  .default(null);

export const shippingAddressSchema = strictObject({
  recipientName: personNameSchema,
  phone: phoneSchema,
  email: emailSchema,
  addressLine1: boundedLine(180),
  addressLine2: boundedLine(180).optional(),
  landmark: boundedLine(120).optional(),
  city: boundedLine(80),
  district: boundedLine(80),
  state: boundedLine(80),
  pincode: pincodeSchema,
});

export const quoteOrderSchema = strictObject({
  shippingAddress: shippingAddressSchema,
  couponCode: couponCodeSchema,
});

export const placeOrderSchema = strictObject({
  shippingAddress: shippingAddressSchema,
  couponCode: couponCodeSchema,
  paymentMethod: z.enum(Object.values(OrderPaymentMethod)),
});

/**
 * Customer cancellation accepts only an optional short reason. It never carries
 * a status, a refund instruction or any commercial field — the server decides
 * the transition from the stored order.
 */
export const cancelOrderSchema = strictObject({
  reason: z.string().trim().min(1).max(100).optional(),
});

export const idempotencyKeySchema = z
  .string()
  .min(32)
  .max(200)
  .regex(/^[\x21-\x7E]+$/, "Use a high-entropy printable key without spaces.")
  .refine((value) => new Set(value).size >= 8, {
    message:
      "Use a high-entropy key, not a repeated character or predictable value.",
  });

export const CustomerOrderStatusFilter = Object.freeze({
  PAYMENT_PENDING: "PAYMENT_PENDING",
  CONFIRMED: "CONFIRMED",
  CANCELLED: "CANCELLED",
});

export const orderListQuerySchema = paginationSchema
  .extend({
    status: z.enum(Object.values(CustomerOrderStatusFilter)).optional(),
  })
  .strict();

export const orderNumberParamSchema = strictObject({
  orderNumber: z
    .string()
    .trim()
    .min(1)
    .max(48)
    .regex(/^[A-Za-z0-9_-]+$/, "Not a valid order number."),
});

const expectedVersionSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
const shipmentFields = {
  courier: z.string().trim().min(1).max(100),
  awb: z.string().trim().min(1).max(200),
  trackingId: z.string().trim().min(1).max(200),
  shipmentId: z.string().trim().min(1).max(200),
};

export const adminOrderListQuerySchema = paginationSchema
  .extend({
    q: searchTermSchema
      .refine((value) => value.length > 0, {
        message: "Search cannot be empty.",
      })
      .optional(),
    status: z.enum(Object.values(OrderFulfillmentStatus)).optional(),
    paymentStatus: z.enum(Object.values(OrderPaymentStatus)).optional(),
  })
  .strict();

const adminActionSchemas = [
  strictObject({
    action: z.literal(OrderFulfillmentAction.START_PROCESSING),
    expectedVersion: expectedVersionSchema,
  }),
  strictObject({
    action: z.literal(OrderFulfillmentAction.MARK_PACKED),
    expectedVersion: expectedVersionSchema,
  }),
  strictObject({
    action: z.literal(OrderFulfillmentAction.RECORD_SHIPMENT),
    expectedVersion: expectedVersionSchema,
    ...shipmentFields,
  }),
  strictObject({
    action: z.literal(OrderFulfillmentAction.MARK_OUT_FOR_DELIVERY),
    expectedVersion: expectedVersionSchema,
  }),
  strictObject({
    action: z.literal(OrderFulfillmentAction.MARK_DELIVERED),
    expectedVersion: expectedVersionSchema,
  }),
  strictObject({
    action: z.literal(OrderFulfillmentAction.CANCEL),
    expectedVersion: expectedVersionSchema,
    reason: z.string().trim().min(1).max(160),
  }),
];

export const adminOrderActionSchema = z.discriminatedUnion(
  "action",
  adminActionSchemas,
);
