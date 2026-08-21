import crypto from "node:crypto";
import mongoose from "mongoose";
import { env, isProduction } from "../../config/env.js";
import { supportsTransactions } from "../../config/database.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { auditService } from "../../modules/system/audit.service.js";
import {
  AuditAction,
  AuditTargetType,
} from "../../modules/system/auditLog.model.js";
import {
  Order,
  OrderFulfillmentStatus,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderPlacementStatus,
} from "../../modules/orders/order.model.js";
import {
  Payment,
  PaymentAttemptStatus,
  PaymentCurrency,
  PaymentProvider,
} from "../../modules/payments/payment.model.js";
import {
  PaymentEvent,
  PaymentEventStatus,
  PaymentEventType,
} from "../../modules/payments/paymentEvent.model.js";
import {
  paymentInitiationDto,
  paymentResultDto,
} from "../../modules/payments/payment.dto.js";
import { mockPrepaidAdapter } from "./adapters/mockPrepaid.adapter.js";

const MAX_TRANSACTION_ATTEMPTS = 3;
const REFUND_DISPATCH_LEASE_MS = 30_000;
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function paymentUnavailable() {
  return new AppError(ErrorCode.PAYMENT_METHOD_UNAVAILABLE, {
    message: "Prepaid payment is temporarily unavailable.",
  });
}

function verificationFailed() {
  return new AppError(ErrorCode.PAYMENT_VERIFICATION_FAILED);
}

function retryableTransactionError(error) {
  return (
    Boolean(error?.hasErrorLabel?.("TransientTransactionError")) ||
    error?.code === 112
  );
}

async function runTransaction(work) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction({
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      });
      const result = await work(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      lastError = error;
      if (session.inTransaction())
        await session.abortTransaction().catch(() => {});
      if (
        !retryableTransactionError(error) ||
        attempt === MAX_TRANSACTION_ATTEMPTS
      )
        throw error;
    } finally {
      await session.endSession();
    }
  }
  throw lastError;
}

async function requireTransactions() {
  if (!(await supportsTransactions()))
    throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
      message: "Payment is temporarily unavailable. Please try again.",
    });
}

export function getPaymentCapabilities(
  config = env,
  { production = isProduction } = {},
) {
  const prepaidReady =
    config.PREPAID_PROVIDER === PaymentProvider.MOCK_PREPAID &&
    !production &&
    Boolean(config.MOCK_PREPAID_SECRET);
  return Object.freeze({ prepaidReady });
}

function prepaidAdapter() {
  if (!getPaymentCapabilities().prepaidReady) throw paymentUnavailable();
  if (env.PREPAID_PROVIDER === PaymentProvider.MOCK_PREPAID)
    return mockPrepaidAdapter;
  throw paymentUnavailable();
}

function attemptExpiry() {
  return new Date(Date.now() + env.PAYMENT_ATTEMPT_TTL_MINUTES * 60 * 1000);
}

async function refreshExpiredAttempt(payment) {
  if (
    ![PaymentAttemptStatus.PENDING, PaymentAttemptStatus.FAILED].includes(
      payment.status,
    ) ||
    new Date(payment.expiresAt).getTime() > Date.now()
  )
    return payment;
  return (
    (await Payment.findOneAndUpdate(
      {
        _id: payment._id,
        status: {
          $in: [PaymentAttemptStatus.PENDING, PaymentAttemptStatus.FAILED],
        },
        expiresAt: { $lte: new Date() },
      },
      {
        $set: {
          status: PaymentAttemptStatus.PENDING,
          expiresAt: attemptExpiry(),
        },
        $push: {
          history: {
            status: PaymentAttemptStatus.PENDING,
            reason: "Payment session resumed",
            at: new Date(),
          },
        },
      },
      { new: true, runValidators: true },
    )) ?? payment
  );
}

async function initiationReplay(payment, adapter) {
  const resumed = await refreshExpiredAttempt(payment);
  const actionable = [
    PaymentAttemptStatus.PENDING,
    PaymentAttemptStatus.FAILED,
  ].includes(resumed.status);
  return {
    replayed: true,
    payment: paymentInitiationDto(
      resumed,
      actionable ? await adapter.initiate(resumed) : null,
    ),
  };
}

function assertInitiatableOrder(order) {
  if (!order) throw new AppError(ErrorCode.ORDER_NOT_FOUND);
  if (order.paymentMethod !== OrderPaymentMethod.PREPAID)
    throw new AppError(ErrorCode.PAYMENT_METHOD_UNAVAILABLE);
  if (
    order.placementStatus !== OrderPlacementStatus.PLACED ||
    order.fulfillmentStatus !== OrderFulfillmentStatus.UNFULFILLED ||
    order.paymentStatus !== OrderPaymentStatus.PREPAID_PENDING
  )
    throw new AppError(ErrorCode.INVALID_STATUS_TRANSITION);
}

function assertBound(payment, result) {
  if (
    result.provider !== payment.provider ||
    result.providerReference !== payment.merchantReference ||
    result.merchantReference !== payment.merchantReference ||
    result.amountPaise !== payment.amountPaise ||
    result.currency !== payment.currency ||
    (payment.providerPaymentId &&
      payment.providerPaymentId !== result.providerPaymentId)
  )
    throw verificationFailed();
}

function eventHash(result) {
  return (
    result.payloadHash ??
    sha256(
      canonicalJson({
        provider: result.provider,
        kind: result.kind,
        eventId: result.eventId,
        providerReference: result.providerReference,
        merchantReference: result.merchantReference,
        providerPaymentId: result.providerPaymentId,
        amountPaise: result.amountPaise,
        currency: result.currency,
        occurredAt: new Date(result.occurredAt).toISOString(),
      }),
    )
  );
}

async function auditVerified(payment, order, actor, req) {
  await auditService.record({
    action: AuditAction.PAYMENT_VERIFIED,
    actor,
    targetType: AuditTargetType.ORDER,
    targetId: order._id,
    targetLabel: order.orderNumber,
    metadata: {
      provider: payment.provider,
      attemptId: String(payment._id),
      paymentStatus: payment.status,
      amountPaise: payment.amountPaise,
      currency: payment.currency,
    },
    req,
  });
}

async function auditRefunded(payment, order) {
  await auditService.record({
    action: AuditAction.PAYMENT_REFUNDED,
    targetType: AuditTargetType.ORDER,
    targetId: order._id,
    targetLabel: order.orderNumber,
    metadata: {
      provider: payment.provider,
      attemptId: String(payment._id),
      paymentStatus: payment.status,
      amountPaise: payment.amountPaise,
      currency: payment.currency,
      reason: "Late payment after placement release",
    },
  });
}

async function resolveDuplicateEvent(result, paymentId) {
  const existing = await PaymentEvent.findOne({
    provider: result.provider,
    eventId: result.eventId,
  }).lean();
  if (!existing) return null;
  if (existing.payloadHash !== eventHash(result)) throw verificationFailed();
  const payment = await Payment.findById(paymentId).lean();
  if (!payment) return null;
  const order = await Order.findById(payment.order).lean();
  return order
    ? { replayed: true, outcome: "DUPLICATE", payment, order }
    : null;
}

async function applyProviderEvent(paymentId, result) {
  await requireTransactions();
  try {
    return await runTransaction(async (session) => {
      const payment = await Payment.findById(paymentId).session(session);
      if (!payment) throw verificationFailed();
      assertBound(payment, result);

      const hash = eventHash(result);
      const order = await Order.findById(payment.order).session(session);
      if (!order) throw verificationFailed();
      const existing = await PaymentEvent.findOne({
        provider: result.provider,
        eventId: result.eventId,
      }).session(session);
      if (existing) {
        if (existing.payloadHash !== hash) throw verificationFailed();
        return { replayed: true, outcome: "DUPLICATE", payment, order };
      }

      const event = new PaymentEvent({
        provider: result.provider,
        eventId: result.eventId,
        eventType: result.kind,
        payloadHash: hash,
        payment: payment._id,
        order: order._id,
        providerReference: result.providerReference,
        providerPaymentId: result.providerPaymentId,
        occurredAt: result.occurredAt,
        status: PaymentEventStatus.PROCESSED,
      });

      let outcome = "IGNORED";
      if (result.kind === PaymentEventType.PAYMENT_SUCCEEDED) {
        if (payment.status === PaymentAttemptStatus.REFUNDED) {
          event.status = PaymentEventStatus.IGNORED;
          outcome = "TERMINAL_REFUNDED";
        } else if (
          [
            PaymentAttemptStatus.RECONCILIATION_REQUIRED,
            PaymentAttemptStatus.REFUND_PENDING,
          ].includes(payment.status)
        ) {
          event.status = PaymentEventStatus.IGNORED;
          outcome = "REFUND_RETRY";
        } else if (payment.status === PaymentAttemptStatus.CONFIRMED) {
          event.status = PaymentEventStatus.IGNORED;
          outcome = "DUPLICATE_SUCCESS";
        } else if (
          order.placementStatus === OrderPlacementStatus.RELEASED ||
          order.paymentStatus === OrderPaymentStatus.CANCELLED
        ) {
          payment.status = PaymentAttemptStatus.RECONCILIATION_REQUIRED;
          payment.providerPaymentId = result.providerPaymentId;
          payment.history.push({
            status: PaymentAttemptStatus.RECONCILIATION_REQUIRED,
            reason: "Payment succeeded after placement release",
            at: new Date(),
          });
          event.status = PaymentEventStatus.RECONCILIATION_REQUIRED;
          outcome = "LATE_SUCCESS";
        } else {
          if (
            order.paymentMethod !== OrderPaymentMethod.PREPAID ||
            order.placementStatus !== OrderPlacementStatus.PLACED ||
            order.fulfillmentStatus !== OrderFulfillmentStatus.UNFULFILLED ||
            order.paymentStatus !== OrderPaymentStatus.PREPAID_PENDING
          )
            throw new AppError(ErrorCode.INVALID_STATUS_TRANSITION);
          const now = new Date();
          payment.status = PaymentAttemptStatus.CONFIRMED;
          payment.providerPaymentId = result.providerPaymentId;
          payment.confirmedAt = now;
          payment.failedAt = undefined;
          payment.history.push({
            status: PaymentAttemptStatus.CONFIRMED,
            reason: "Provider payment verified",
            at: now,
          });
          order.paymentStatus = OrderPaymentStatus.PREPAID_CONFIRMED;
          order.paidAt = now;
          order.statusHistory.push({
            domain: "PAYMENT",
            status: OrderPaymentStatus.PREPAID_CONFIRMED,
            reason: "Provider payment verified",
            at: now,
          });
          await order.save({ session });
          outcome = "CONFIRMED";
        }
      } else if (result.kind === PaymentEventType.PAYMENT_FAILED) {
        if (
          [
            PaymentAttemptStatus.CONFIRMED,
            PaymentAttemptStatus.REFUNDED,
            PaymentAttemptStatus.RECONCILIATION_REQUIRED,
            PaymentAttemptStatus.REFUND_PENDING,
          ].includes(payment.status)
        ) {
          event.status = PaymentEventStatus.IGNORED;
          outcome = "IGNORED_FAILURE";
        } else {
          const now = new Date();
          payment.status = PaymentAttemptStatus.FAILED;
          payment.failedAt = now;
          payment.providerPaymentId = result.providerPaymentId;
          payment.history.push({
            status: PaymentAttemptStatus.FAILED,
            reason: "Provider reported payment failure",
            at: now,
          });
          outcome = "FAILED";
        }
      } else if (result.kind === PaymentEventType.REFUND_SUCCEEDED) {
        if (
          [
            PaymentAttemptStatus.RECONCILIATION_REQUIRED,
            PaymentAttemptStatus.REFUND_PENDING,
          ].includes(payment.status)
        ) {
          payment.status = PaymentAttemptStatus.REFUNDED;
          payment.refundedAt = new Date(result.occurredAt);
          payment.history.push({
            status: PaymentAttemptStatus.REFUNDED,
            reason: "Provider refund verified",
            at: payment.refundedAt,
          });
          outcome = "REFUNDED";
        } else {
          event.status = PaymentEventStatus.IGNORED;
          outcome = "IGNORED_REFUND";
        }
      } else {
        throw verificationFailed();
      }

      await payment.save({ session });
      await event.save({ session });
      return { replayed: false, outcome, payment, order };
    });
  } catch (error) {
    if (error?.code === 11000) {
      const duplicate = await resolveDuplicateEvent(result, paymentId);
      if (duplicate) return duplicate;
    }
    throw error;
  }
}

function refundNeedsDispatch(payment) {
  return [
    PaymentAttemptStatus.RECONCILIATION_REQUIRED,
    PaymentAttemptStatus.REFUND_PENDING,
  ].includes(payment.status);
}

async function dispatchRefund(payment, order) {
  const now = new Date();
  const claimed = await Payment.findOneAndUpdate(
    {
      _id: payment._id,
      $or: [
        { status: PaymentAttemptStatus.RECONCILIATION_REQUIRED },
        {
          status: PaymentAttemptStatus.REFUND_PENDING,
          refundDispatchLeaseUntil: { $lte: now },
        },
      ],
    },
    {
      $set: {
        status: PaymentAttemptStatus.REFUND_PENDING,
        refundDispatchClaimedAt: now,
        refundDispatchLeaseUntil: new Date(
          now.getTime() + REFUND_DISPATCH_LEASE_MS,
        ),
      },
      $inc: { refundDispatchAttempts: 1 },
      $push: {
        history: {
          status: PaymentAttemptStatus.REFUND_PENDING,
          reason: "Late-payment refund dispatch claimed",
          at: now,
        },
      },
    },
    { new: true, runValidators: true },
  );

  if (!claimed) {
    const current = await Payment.findById(payment._id);
    if (current?.status === PaymentAttemptStatus.REFUNDED) return current;
    throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
      message: "Payment reconciliation is still in progress. Please retry.",
    });
  }

  const adapter = prepaidAdapter();
  const refund = await adapter.refund(claimed);
  const updated = await Payment.findOneAndUpdate(
    {
      _id: claimed._id,
      status: PaymentAttemptStatus.REFUND_PENDING,
      refundDispatchClaimedAt: now,
    },
    {
      $set: {
        status: PaymentAttemptStatus.REFUNDED,
        providerRefundId: refund.providerRefundId,
        refundedAt: refund.refundedAt,
      },
      $unset: {
        refundDispatchLeaseUntil: "",
      },
      $push: {
        history: {
          status: PaymentAttemptStatus.REFUNDED,
          reason: "Late payment automatically refunded",
          at: refund.refundedAt,
        },
      },
    },
    { new: true, runValidators: true },
  );
  if (!updated)
    throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
      message: "Payment reconciliation is still in progress. Please retry.",
    });
  await auditRefunded(updated, order);
  return updated;
}

async function initiate(actor, orderId, rawIdempotencyKey) {
  const adapter = prepaidAdapter();
  await requireTransactions();
  const userId = actor._id;
  const keyHash = sha256(rawIdempotencyKey);
  const fingerprint = sha256(canonicalJson({ orderId }));

  const keyed = await Payment.findOne({
    user: userId,
    idempotencyKeyHash: keyHash,
  });
  if (keyed) {
    if (
      String(keyed.order) !== orderId ||
      keyed.requestFingerprint !== fingerprint
    )
      throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT);
    return initiationReplay(keyed, adapter);
  }

  const existing = await Payment.findOne({ order: orderId, user: userId });
  if (existing) return initiationReplay(existing, adapter);

  let committed;
  try {
    committed = await runTransaction(async (session) => {
      const order = await Order.findOne({ _id: orderId, user: userId }).session(
        session,
      );
      assertInitiatableOrder(order);
      const now = new Date();
      const [payment] = await Payment.create(
        [
          {
            order: order._id,
            user: userId,
            provider: adapter.provider,
            merchantReference: `PAY_${crypto
              .randomBytes(18)
              .toString("base64url")}`,
            refundReference: `RFN_${crypto
              .randomBytes(18)
              .toString("base64url")}`,
            idempotencyKeyHash: keyHash,
            requestFingerprint: fingerprint,
            amountPaise: order.pricing.finalTotalPaise,
            currency: PaymentCurrency.INR,
            status: PaymentAttemptStatus.PENDING,
            expiresAt: attemptExpiry(),
            history: [
              {
                status: PaymentAttemptStatus.PENDING,
                reason: "Payment initiated",
                at: now,
              },
            ],
          },
        ],
        { session },
      );
      return payment;
    });
  } catch (error) {
    if (error?.code === 11000) {
      const replay = await Payment.findOne({
        $or: [
          { order: orderId, user: userId },
          { user: userId, idempotencyKeyHash: keyHash },
        ],
      });
      if (replay) {
        if (
          replay.idempotencyKeyHash === keyHash &&
          (String(replay.order) !== orderId ||
            replay.requestFingerprint !== fingerprint)
        )
          throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT);
        return initiationReplay(replay, adapter);
      }
    }
    throw error;
  }

  return {
    replayed: false,
    payment: paymentInitiationDto(committed, await adapter.initiate(committed)),
  };
}

async function verify(actor, orderId, input, req) {
  const payment = await Payment.findOne({
    _id: input.attemptId,
    order: orderId,
    user: actor._id,
  });
  if (!payment) throw new AppError(ErrorCode.ORDER_NOT_FOUND);
  if (
    [PaymentAttemptStatus.CONFIRMED, PaymentAttemptStatus.REFUNDED].includes(
      payment.status,
    )
  )
    return { replayed: true, payment: paymentResultDto(payment) };
  if (refundNeedsDispatch(payment)) {
    const order = await Order.findById(payment.order);
    if (!order) throw verificationFailed();
    const reconciled = await dispatchRefund(payment, order);
    return { replayed: true, payment: paymentResultDto(reconciled) };
  }
  const adapter = prepaidAdapter();
  const result = await adapter.verify(payment, input);
  const applied = await applyProviderEvent(payment._id, result);
  let finalPayment = applied.payment;
  if (refundNeedsDispatch(applied.payment))
    finalPayment = await dispatchRefund(applied.payment, applied.order);
  if (applied.outcome === "CONFIRMED")
    await auditVerified(applied.payment, applied.order, actor, req);
  return {
    replayed: applied.replayed,
    payment: paymentResultDto(finalPayment),
  };
}

async function handleWebhook({ rawBody, signature, timestamp, payload, req }) {
  const adapter = mockPrepaidAdapter;
  const result = await adapter.handleWebhook({
    rawBody,
    signature,
    timestamp,
    payload,
  });
  const payment = await Payment.findOne({
    provider: result.provider,
    merchantReference: result.merchantReference,
  });
  if (!payment) throw verificationFailed();
  const applied = await applyProviderEvent(payment._id, result);
  if (refundNeedsDispatch(applied.payment))
    applied.payment = await dispatchRefund(applied.payment, applied.order);
  if (applied.outcome === "CONFIRMED")
    await auditVerified(applied.payment, applied.order, undefined, req);
  return { replayed: applied.replayed, outcome: applied.outcome };
}

async function refund(paymentId) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw verificationFailed();
  if (!refundNeedsDispatch(payment))
    throw new AppError(ErrorCode.INVALID_STATUS_TRANSITION);
  const order = await Order.findById(payment.order);
  if (!order) throw verificationFailed();
  return dispatchRefund(payment, order);
}

export const paymentService = Object.freeze({
  initiate,
  verify,
  handleWebhook,
  refund,
});
