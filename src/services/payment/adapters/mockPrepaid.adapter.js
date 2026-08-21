import crypto from "node:crypto";
import { env, isProduction } from "../../../config/env.js";
import { AppError } from "../../../utils/AppError.js";
import { ErrorCode } from "../../../utils/errorCodes.js";
import {
  PaymentCurrency,
  PaymentProvider,
} from "../../../modules/payments/payment.model.js";
import { PaymentEventType } from "../../../modules/payments/paymentEvent.model.js";

function unavailable() {
  throw new AppError(ErrorCode.PAYMENT_METHOD_UNAVAILABLE, {
    message: "Prepaid payment is temporarily unavailable.",
  });
}

function secret() {
  if (
    isProduction ||
    env.PREPAID_PROVIDER !== PaymentProvider.MOCK_PREPAID ||
    !env.MOCK_PREPAID_SECRET
  )
    unavailable();
  return env.MOCK_PREPAID_SECRET;
}

function hmac(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}

function timingSafeHex(actual, expected) {
  if (!/^[a-f0-9]{64}$/i.test(actual ?? "")) return false;
  const left = Buffer.from(actual.toLowerCase(), "hex");
  const right = Buffer.from(expected.toLowerCase(), "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function checkoutMessage(payment) {
  return [
    String(payment._id),
    payment.merchantReference,
    payment.amountPaise,
    payment.currency,
    new Date(payment.expiresAt).toISOString(),
  ].join(".");
}

export function signMockWebhook(rawBody, timestamp) {
  const bytes = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  return hmac(`${timestamp}.${bytes.toString("utf8")}`);
}

function verifyWebhookSignature(rawBody, signature, timestamp) {
  if (!Buffer.isBuffer(rawBody))
    throw new AppError(ErrorCode.WEBHOOK_SIGNATURE_INVALID);
  if (!/^\d{10}$/.test(timestamp ?? ""))
    throw new AppError(ErrorCode.WEBHOOK_SIGNATURE_INVALID);
  const ageSeconds = Math.abs(
    Math.floor(Date.now() / 1000) - Number(timestamp),
  );
  if (ageSeconds > env.PAYMENT_WEBHOOK_TOLERANCE_SECONDS)
    throw new AppError(ErrorCode.WEBHOOK_SIGNATURE_INVALID);
  const expected = signMockWebhook(rawBody, timestamp);
  if (!timingSafeHex(signature, expected))
    throw new AppError(ErrorCode.WEBHOOK_SIGNATURE_INVALID);
  return Object.freeze({ signature, timestamp });
}

function checkoutToken(payment) {
  return hmac(checkoutMessage(payment));
}

function providerPaymentId(payment) {
  return `MOCK_${String(payment._id)}`;
}

export const mockPrepaidAdapter = Object.freeze({
  provider: PaymentProvider.MOCK_PREPAID,

  async initiate(payment) {
    secret();
    return {
      type: "MOCK_PREPAID",
      provider: PaymentProvider.MOCK_PREPAID,
      providerReference: payment.merchantReference,
      checkoutToken: checkoutToken(payment),
      expiresAt: payment.expiresAt,
      amountPaise: payment.amountPaise,
      currency: payment.currency,
    };
  },

  async verify(payment, input) {
    secret();
    if (new Date(payment.expiresAt).getTime() <= Date.now())
      throw new AppError(ErrorCode.PAYMENT_FAILED, {
        message: "This payment session expired. Start payment again.",
      });
    if (!timingSafeHex(input.checkoutToken, checkoutToken(payment)))
      throw new AppError(ErrorCode.PAYMENT_VERIFICATION_FAILED);
    const id = providerPaymentId(payment);
    return {
      provider: PaymentProvider.MOCK_PREPAID,
      kind: PaymentEventType.PAYMENT_SUCCEEDED,
      eventId: `VERIFY_${String(payment._id)}`,
      providerReference: payment.merchantReference,
      merchantReference: payment.merchantReference,
      providerPaymentId: id,
      amountPaise: payment.amountPaise,
      currency: PaymentCurrency.INR,
      occurredAt: payment.createdAt,
    };
  },

  verifyWebhookSignature,

  async handleWebhook({ rawBody, signature, timestamp, payload }) {
    verifyWebhookSignature(rawBody, signature, timestamp);
    return {
      provider: PaymentProvider.MOCK_PREPAID,
      kind: payload.eventType,
      eventId: payload.eventId,
      providerReference: payload.providerReference,
      merchantReference: payload.merchantReference,
      providerPaymentId: payload.providerPaymentId,
      amountPaise: payload.amountPaise,
      currency: payload.currency,
      occurredAt: new Date(payload.occurredAt),
      payloadHash: crypto.createHash("sha256").update(rawBody).digest("hex"),
    };
  },

  async refund(payment) {
    secret();
    return {
      providerRefundId: `MOCK_${payment.refundReference}`,
      refundedAt: new Date(),
    };
  },
});
