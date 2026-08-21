import { z } from "zod";
import { objectIdSchema, strictObject } from "../../validators/common.js";
import { PaymentCurrency } from "./payment.model.js";
import { PaymentEventType } from "./paymentEvent.model.js";

const boundedReference = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, "Not a valid payment reference.");

export const paymentOrderParamsSchema = strictObject({
  orderId: objectIdSchema,
});

export const initiatePaymentSchema = strictObject({});

export const verifyPaymentSchema = strictObject({
  attemptId: objectIdSchema,
  checkoutToken: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const mockWebhookSchema = strictObject({
  eventId: boundedReference,
  eventType: z.enum(Object.values(PaymentEventType)),
  providerReference: boundedReference,
  merchantReference: boundedReference,
  providerPaymentId: boundedReference,
  amountPaise: z.number().int().nonnegative().max(1_000_000_000),
  currency: z.literal(PaymentCurrency.INR),
  occurredAt: z.string().datetime({ offset: true }),
});
