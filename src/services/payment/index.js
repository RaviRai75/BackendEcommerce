import crypto from "node:crypto";
import mongoose from "mongoose";
import { env, isProduction } from "../../config/env.js";
import { supportsTransactions } from "../../config/database.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import {
  CustomOrder,
  CustomOrderPaymentStatus,
  CustomProductionStatus,
  CustomFulfillmentStatus,
  CustomCompletionStatus,
} from "../../modules/customization/customOrder.model.js";
import {
  CustomRequest,
  CustomRequestAction,
  CustomRequestStatus,
} from "../../modules/customization/customRequest.model.js";
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
import { notificationService } from "../../modules/notifications/notification.service.js";
import {
  NotificationTargetKind,
  NotificationType,
} from "../../modules/notifications/notification.model.js";
import {
  Payment,
  PaymentAttemptStatus,
  PaymentCurrency,
  PaymentPayableType,
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
const MAX_COMMIT_ATTEMPTS = 5;
const MAX_RECONCILIATION_ATTEMPTS = 3;
const REFUND_DISPATCH_LEASE_MS = 30_000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

function hasErrorLabel(error, label) {
  return (
    Boolean(error?.hasErrorLabel?.(label)) ||
    error?.errorLabels?.includes?.(label) === true
  );
}

function retryableTransactionError(error) {
  return (
    hasErrorLabel(error, "TransientTransactionError") || error?.code === 112
  );
}

async function reconcileAmbiguousCommit(reconcile) {
  if (!reconcile) return false;
  for (let attempt = 1; attempt <= MAX_RECONCILIATION_ATTEMPTS; attempt += 1) {
    if (await reconcile()) return true;
    if (attempt < MAX_RECONCILIATION_ATTEMPTS) await wait(25 * attempt);
  }
  return false;
}

async function runTransaction(work, { reconcile } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    const session = await mongoose.startSession();
    let ambiguousCommit = false;
    try {
      session.startTransaction({
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      });
      const result = await work(session);
      let commitError;
      for (
        let commitAttempt = 1;
        commitAttempt <= MAX_COMMIT_ATTEMPTS;
        commitAttempt += 1
      ) {
        try {
          await session.commitTransaction();
          return result;
        } catch (error) {
          commitError = error;
          if (hasErrorLabel(error, "UnknownTransactionCommitResult")) {
            ambiguousCommit = true;
            if (commitAttempt < MAX_COMMIT_ATTEMPTS)
              await wait(25 * commitAttempt);
            continue;
          }
          if (ambiguousCommit) break;
          throw error;
        }
      }
      if (ambiguousCommit) {
        if (await reconcileAmbiguousCommit(reconcile)) return result;
        throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
          message:
            "The payment update outcome could not be confirmed. Refresh before trying again.",
          cause: commitError,
        });
      }
      throw commitError;
    } catch (error) {
      lastError = error;
      if (!ambiguousCommit && session.inTransaction())
        await session.abortTransaction().catch(() => {});
      if (
        ambiguousCommit ||
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

function isInitiatableCustomOrder(order) {
  return Boolean(
    order &&
    order.paymentMethod === "PREPAID" &&
    order.paymentStatus === CustomOrderPaymentStatus.PREPAID_PENDING &&
    order.productionStatus === CustomProductionStatus.NOT_STARTED &&
    order.fulfillmentStatus === CustomFulfillmentStatus.UNFULFILLED &&
    order.completionStatus === CustomCompletionStatus.OPEN,
  );
}

function assertInitiatableCustomOrder(order) {
  if (!order) throw new AppError(ErrorCode.CUSTOM_ORDER_NOT_FOUND);
  if (!isInitiatableCustomOrder(order))
    throw new AppError(ErrorCode.INVALID_CUSTOM_ORDER_TRANSITION);
}

function paymentType(payment) {
  return payment.payableType ?? PaymentPayableType.ORDER;
}

async function customInitiationResponse(
  payment,
  { userId, orderNumber, fingerprint, adapter, replayed },
) {
  const order = await CustomOrder.findOne({ orderNumber, owner: userId });
  if (
    !order ||
    paymentType(payment) !== PaymentPayableType.CUSTOM_ORDER ||
    String(payment.customOrder) !== String(order._id) ||
    payment.requestFingerprint !== fingerprint
  )
    throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT);
  if (!isInitiatableCustomOrder(order))
    return {
      replayed,
      payment: paymentInitiationDto(payment, null),
    };

  const resumed = await refreshExpiredAttempt(payment);
  const stillInitiatable = await CustomOrder.exists({
    _id: order._id,
    owner: userId,
    paymentMethod: "PREPAID",
    paymentStatus: CustomOrderPaymentStatus.PREPAID_PENDING,
    productionStatus: CustomProductionStatus.NOT_STARTED,
    fulfillmentStatus: CustomFulfillmentStatus.UNFULFILLED,
    completionStatus: CustomCompletionStatus.OPEN,
  });
  const actionable =
    Boolean(stillInitiatable) &&
    [PaymentAttemptStatus.PENDING, PaymentAttemptStatus.FAILED].includes(
      resumed.status,
    );
  return {
    replayed,
    payment: paymentInitiationDto(
      resumed,
      actionable ? await adapter.initiate(resumed) : null,
    ),
  };
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

async function auditVerified(payment, payable, actor, req, session) {
  const custom = paymentType(payment) === PaymentPayableType.CUSTOM_ORDER;
  await auditService.recordStrict(
    {
      action: AuditAction.PAYMENT_VERIFIED,
      actor,
      targetType: custom ? AuditTargetType.CUSTOM_ORDER : AuditTargetType.ORDER,
      targetId: payable._id,
      targetLabel: payable.orderNumber,
      metadata: {
        provider: payment.provider,
        attemptId: String(payment._id),
        paymentStatus: payment.status,
        amountPaise: payment.amountPaise,
        currency: payment.currency,
      },
      req,
    },
    session,
  );
}

async function auditRefunded(payment, payable) {
  const custom = paymentType(payment) === PaymentPayableType.CUSTOM_ORDER;
  await auditService.record({
    action: AuditAction.PAYMENT_REFUNDED,
    targetType: custom ? AuditTargetType.CUSTOM_ORDER : AuditTargetType.ORDER,
    targetId: payable._id,
    targetLabel: payable.orderNumber,
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
  if (
    existing.payloadHash !== eventHash(result) ||
    String(existing.payment) !== String(paymentId) ||
    existing.providerReference !== result.merchantReference
  )
    throw verificationFailed();
  const payment = await Payment.findById(paymentId).lean();
  if (!payment) return null;
  const custom = paymentType(payment) === PaymentPayableType.CUSTOM_ORDER;
  const order = custom
    ? await CustomOrder.findById(payment.customOrder).lean()
    : await Order.findById(payment.order).lean();
  return order
    ? { replayed: true, outcome: "DUPLICATE", payment, order }
    : null;
}

async function publishPaymentConfirmedNotifications(
  order,
  occurredAt,
  session,
) {
  await notificationService.publish(
    {
      eventKey: `order:${order._id}:${NotificationType.ORDER_PAYMENT_CONFIRMED}`,
      type: NotificationType.ORDER_PAYMENT_CONFIRMED,
      occurredAt,
      payload: {},
      customer: {
        userId: order.user,
        email: order.shippingAddress.email,
        name: order.shippingAddress.recipientName,
      },
      customerTarget: {
        kind: NotificationTargetKind.ORDER,
        reference: order.orderNumber,
      },
    },
    { session },
  );
  await notificationService.publish(
    {
      eventKey: `order:${order._id}:${NotificationType.ADMIN_PAYMENT_CONFIRMED}`,
      type: NotificationType.ADMIN_PAYMENT_CONFIRMED,
      occurredAt,
      payload: {},
      notifyAdmins: true,
      adminTarget: {
        kind: NotificationTargetKind.ORDER,
        reference: order.orderNumber,
      },
    },
    { session },
  );
}

async function publishCustomPaymentConfirmedNotifications(
  order,
  request,
  occurredAt,
  session,
) {
  await notificationService.publish(
    {
      eventKey: `custom:${request._id}:payment:${NotificationType.CUSTOM_REQUEST_PAYMENT_CONFIRMED}`,
      type: NotificationType.CUSTOM_REQUEST_PAYMENT_CONFIRMED,
      occurredAt,
      payload: {},
      customer: {
        userId: order.owner,
        email: order.shippingAddress.email,
        name: order.shippingAddress.recipientName,
      },
      customerTarget: {
        kind: NotificationTargetKind.CUSTOM_REQUEST,
        reference: request.requestNumber,
      },
    },
    { session },
  );
  await notificationService.publish(
    {
      eventKey: `custom:${request._id}:payment:${NotificationType.ADMIN_CUSTOM_PAYMENT_CONFIRMED}`,
      type: NotificationType.ADMIN_CUSTOM_PAYMENT_CONFIRMED,
      occurredAt,
      payload: {},
      notifyAdmins: true,
      adminTarget: {
        kind: NotificationTargetKind.CUSTOM_REQUEST,
        reference: request.requestNumber,
      },
    },
    { session },
  );
}

async function applyProviderEvent(paymentId, result, { actor, req } = {}) {
  await requireTransactions();
  const binding = await Payment.findById(paymentId)
    .select(
      "payableType order customOrder provider merchantReference providerPaymentId amountPaise currency",
    )
    .lean();
  if (!binding) throw verificationFailed();
  assertBound(binding, result);
  const customPayment =
    paymentType(binding) === PaymentPayableType.CUSTOM_ORDER;
  const expectedEventHash = eventHash(result);
  const reconcile = customPayment
    ? async () => {
        const existing = await PaymentEvent.findOne({
          provider: result.provider,
          eventId: result.eventId,
        })
          .read("primary")
          .readConcern("majority")
          .lean();
        if (!existing) return false;
        if (
          existing.payloadHash !== expectedEventHash ||
          String(existing.payment) !== String(paymentId) ||
          existing.payableType !== PaymentPayableType.CUSTOM_ORDER ||
          String(existing.customOrder) !== String(binding.customOrder) ||
          existing.providerReference !== binding.merchantReference
        )
          throw verificationFailed();
        return true;
      }
    : undefined;
  try {
    return await runTransaction(
      async (session) => {
        const payment = await Payment.findById(paymentId).session(session);
        if (!payment) throw verificationFailed();
        assertBound(payment, result);

        const hash = eventHash(result);
        const custom = paymentType(payment) === PaymentPayableType.CUSTOM_ORDER;
        const order = custom
          ? await CustomOrder.findById(payment.customOrder).session(session)
          : await Order.findById(payment.order).session(session);
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
          payableType: custom
            ? PaymentPayableType.CUSTOM_ORDER
            : PaymentPayableType.ORDER,
          ...(custom ? { customOrder: order._id } : { order: order._id }),
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
            custom &&
            (order.paymentStatus === CustomOrderPaymentStatus.CANCELLED ||
              order.completionStatus === CustomCompletionStatus.CANCELLED)
          ) {
            payment.status = PaymentAttemptStatus.RECONCILIATION_REQUIRED;
            payment.providerPaymentId = result.providerPaymentId;
            payment.history.push({
              status: PaymentAttemptStatus.RECONCILIATION_REQUIRED,
              reason: "Payment succeeded after custom-order cancellation",
              at: new Date(),
            });
            event.status = PaymentEventStatus.RECONCILIATION_REQUIRED;
            outcome = "LATE_SUCCESS";
          } else if (
            !custom &&
            (order.placementStatus === OrderPlacementStatus.RELEASED ||
              order.paymentStatus === OrderPaymentStatus.CANCELLED)
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
            const now = new Date();
            if (custom) {
              assertInitiatableCustomOrder(order);
              payment.status = PaymentAttemptStatus.CONFIRMED;
              payment.providerPaymentId = result.providerPaymentId;
              payment.confirmedAt = now;
              payment.failedAt = undefined;
              payment.history.push({
                status: PaymentAttemptStatus.CONFIRMED,
                reason: "Provider payment verified",
                at: now,
              });
              order.paymentStatus = CustomOrderPaymentStatus.PREPAID_CONFIRMED;
              order.paidAt = now;
              order.history.push({
                axis: "PAYMENT",
                status: CustomOrderPaymentStatus.PREPAID_CONFIRMED,
                action: CustomRequestAction.PAYMENT_CONFIRMED,
                at: now,
                requestId: `payment:${result.eventId}`,
                version: order.__v + 1,
              });
              order.increment();
              await order.save({ session });
              const request = await CustomRequest.findById(
                order.request,
              ).session(session);
              if (!request) throw verificationFailed();
              request.status = CustomRequestStatus.PAYMENT_COMPLETED;
              request.history.push({
                action: CustomRequestAction.PAYMENT_CONFIRMED,
                status: CustomRequestStatus.PAYMENT_COMPLETED,
                at: now,
                actor: order.owner,
                requestId: `payment:${result.eventId}`,
                version: request.__v + 1,
              });
              request.increment();
              await request.save({ session });
            } else {
              if (
                order.paymentMethod !== OrderPaymentMethod.PREPAID ||
                order.placementStatus !== OrderPlacementStatus.PLACED ||
                order.fulfillmentStatus !==
                  OrderFulfillmentStatus.UNFULFILLED ||
                order.paymentStatus !== OrderPaymentStatus.PREPAID_PENDING
              )
                throw new AppError(ErrorCode.INVALID_STATUS_TRANSITION);
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
            }
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
        if (outcome === "CONFIRMED") {
          if (custom) {
            const request = await CustomRequest.findById(order.request).session(
              session,
            );
            await publishCustomPaymentConfirmedNotifications(
              order,
              request,
              order.paidAt,
              session,
            );
          } else {
            await publishPaymentConfirmedNotifications(
              order,
              order.paidAt,
              session,
            );
          }
          await auditVerified(payment, order, actor, req, session);
        }
        return { replayed: false, outcome, payment, order };
      },
      { reconcile },
    );
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
            payableType: PaymentPayableType.ORDER,
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
    const order =
      paymentType(payment) === PaymentPayableType.CUSTOM_ORDER
        ? await CustomOrder.findById(payment.customOrder)
        : await Order.findById(payment.order);
    if (!order) throw verificationFailed();
    const reconciled = await dispatchRefund(payment, order);
    return { replayed: true, payment: paymentResultDto(reconciled) };
  }
  const adapter = prepaidAdapter();
  const result = await adapter.verify(payment, input);
  const applied = await applyProviderEvent(payment._id, result, {
    actor,
    req,
  });
  let finalPayment = applied.payment;
  if (refundNeedsDispatch(applied.payment))
    finalPayment = await dispatchRefund(applied.payment, applied.order);
  return {
    replayed: applied.replayed,
    payment: paymentResultDto(finalPayment),
  };
}

async function initiateCustom(actor, orderNumber, rawIdempotencyKey) {
  const adapter = prepaidAdapter();
  await requireTransactions();
  const userId = actor._id;
  const keyHash = sha256(rawIdempotencyKey);
  const fingerprintValue = sha256(
    canonicalJson({
      payableType: PaymentPayableType.CUSTOM_ORDER,
      orderNumber,
    }),
  );
  const responseFor = (payment, replayed) =>
    customInitiationResponse(payment, {
      userId,
      orderNumber,
      fingerprint: fingerprintValue,
      adapter,
      replayed,
    });

  const keyed = await Payment.findOne({
    user: userId,
    idempotencyKeyHash: keyHash,
  });
  if (keyed) return responseFor(keyed, true);

  const customOrder = await CustomOrder.findOne({ orderNumber, owner: userId });
  assertInitiatableCustomOrder(customOrder);
  const existing = await Payment.findOne({
    customOrder: customOrder._id,
    user: userId,
  });
  if (existing) return responseFor(existing, true);

  let committed;
  try {
    committed = await runTransaction(
      async (session) => {
        const order = await CustomOrder.findOne({
          _id: customOrder._id,
          owner: userId,
        }).session(session);
        assertInitiatableCustomOrder(order);
        const now = new Date();
        const [payment] = await Payment.create(
          [
            {
              payableType: PaymentPayableType.CUSTOM_ORDER,
              customOrder: order._id,
              user: userId,
              provider: adapter.provider,
              merchantReference: `PAY_${crypto.randomBytes(18).toString("base64url")}`,
              refundReference: `RFN_${crypto.randomBytes(18).toString("base64url")}`,
              idempotencyKeyHash: keyHash,
              requestFingerprint: fingerprintValue,
              amountPaise: order.quote.finalPaise,
              currency: PaymentCurrency.INR,
              status: PaymentAttemptStatus.PENDING,
              expiresAt: attemptExpiry(),
              history: [
                {
                  status: PaymentAttemptStatus.PENDING,
                  reason: "Custom-order payment initiated",
                  at: now,
                },
              ],
            },
          ],
          { session },
        );
        return payment;
      },
      {
        reconcile: async () =>
          Boolean(
            await Payment.exists({
              payableType: PaymentPayableType.CUSTOM_ORDER,
              customOrder: customOrder._id,
              user: userId,
              provider: adapter.provider,
              idempotencyKeyHash: keyHash,
              requestFingerprint: fingerprintValue,
              amountPaise: customOrder.quote.finalPaise,
              currency: PaymentCurrency.INR,
            })
              .read("primary")
              .readConcern("majority"),
          ),
      },
    );
  } catch (error) {
    if (error?.code === 11000) {
      const replay = await Payment.findOne({
        $or: [
          { customOrder: customOrder._id, user: userId },
          { user: userId, idempotencyKeyHash: keyHash },
        ],
      });
      if (replay) return responseFor(replay, true);
    }
    throw error;
  }
  return responseFor(committed, false);
}

async function verifyCustom(actor, orderNumber, input, req) {
  const order = await CustomOrder.findOne({
    orderNumber,
    owner: actor._id,
  }).select("_id");
  if (!order) throw new AppError(ErrorCode.CUSTOM_ORDER_NOT_FOUND);
  const payment = await Payment.findOne({
    _id: input.attemptId,
    customOrder: order._id,
    user: actor._id,
  });
  if (!payment) throw new AppError(ErrorCode.CUSTOM_ORDER_NOT_FOUND);
  if (
    [PaymentAttemptStatus.CONFIRMED, PaymentAttemptStatus.REFUNDED].includes(
      payment.status,
    )
  )
    return { replayed: true, payment: paymentResultDto(payment) };
  if (refundNeedsDispatch(payment)) {
    const payable = await CustomOrder.findById(payment.customOrder);
    const reconciled = await dispatchRefund(payment, payable);
    return { replayed: true, payment: paymentResultDto(reconciled) };
  }
  const result = await prepaidAdapter().verify(payment, input);
  const applied = await applyProviderEvent(payment._id, result, {
    actor,
    req,
  });
  let finalPayment = applied.payment;
  if (refundNeedsDispatch(applied.payment))
    finalPayment = await dispatchRefund(applied.payment, applied.order);
  return {
    replayed: applied.replayed,
    payment: paymentResultDto(finalPayment),
  };
}

function authenticateMockWebhook(rawBody, signature, timestamp) {
  return mockPrepaidAdapter.verifyWebhookSignature(
    rawBody,
    signature,
    timestamp,
  );
}

async function handleWebhook({
  rawBody,
  signature,
  timestamp,
  payload,
  context,
}) {
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
  const applied = await applyProviderEvent(payment._id, result, {
    req: context,
  });
  if (refundNeedsDispatch(applied.payment))
    applied.payment = await dispatchRefund(applied.payment, applied.order);
  return { replayed: applied.replayed, outcome: applied.outcome };
}

async function refund(paymentId) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw verificationFailed();
  if (!refundNeedsDispatch(payment))
    throw new AppError(ErrorCode.INVALID_STATUS_TRANSITION);
  const order =
    paymentType(payment) === PaymentPayableType.CUSTOM_ORDER
      ? await CustomOrder.findById(payment.customOrder)
      : await Order.findById(payment.order);
  if (!order) throw verificationFailed();
  return dispatchRefund(payment, order);
}

export const paymentService = Object.freeze({
  initiate,
  initiateCustom,
  verify,
  verifyCustom,
  authenticateMockWebhook,
  handleWebhook,
  refund,
});
