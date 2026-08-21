import { z } from "zod";
import {
  emailSchema,
  paginationSchema,
  personNameSchema,
  phoneSchema,
  pincodeSchema,
  strictObject,
} from "../../validators/common.js";
import { OrderPaymentMethod } from "./order.model.js";

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
