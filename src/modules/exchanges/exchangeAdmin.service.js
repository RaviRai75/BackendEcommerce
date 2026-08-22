import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { supportsTransactions } from "../../config/database.js";
import { mediaService } from "../../services/media/media.service.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { notificationService } from "../notifications/notification.service.js";
import {
  NotificationTargetKind,
  NotificationType,
} from "../notifications/notification.model.js";
import { Order } from "../orders/order.model.js";
import { Product } from "../products/product.model.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import { User } from "../users/user.model.js";
import { adminExchangeDto, adminExchangeListItem } from "./exchange.dto.js";
import {
  Exchange,
  ExchangeAction,
  ExchangeQcResult,
  ExchangeStatus,
} from "./exchange.model.js";
import {
  ExchangeInventoryReason,
  ExchangeInventoryTransaction,
} from "./exchangeInventoryTransaction.model.js";

const MAX_TRANSACTION_ATTEMPTS = 5;
const MAX_COMMIT_ATTEMPTS = 5;
const MAX_RECONCILIATION_ATTEMPTS = 3;
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const AUDIT_ACTION_FOR = Object.freeze({
  [ExchangeAction.REQUEST_INFORMATION]:
    AuditAction.EXCHANGE_INFORMATION_REQUESTED,
  [ExchangeAction.APPROVE]: AuditAction.EXCHANGE_APPROVED,
  [ExchangeAction.REJECT]: AuditAction.EXCHANGE_REJECTED,
  [ExchangeAction.RECORD_FEE]: AuditAction.EXCHANGE_FEE_RECORDED,
  [ExchangeAction.RECORD_REVERSE_SHIPMENT]:
    AuditAction.EXCHANGE_REVERSE_SHIPMENT_RECORDED,
  [ExchangeAction.MARK_RECEIVED]: AuditAction.EXCHANGE_RECEIVED,
  [ExchangeAction.UPDATE_QC]: AuditAction.EXCHANGE_QC_UPDATED,
  [ExchangeAction.RECORD_REPLACEMENT_SHIPMENT]:
    AuditAction.EXCHANGE_REPLACEMENT_SHIPMENT_RECORDED,
  [ExchangeAction.COMPLETE]: AuditAction.EXCHANGE_COMPLETED,
});

const ADMIN_LIST_FIELDS = [
  "exchangeNumber",
  "__v",
  "user",
  "orderNumber",
  "source.productName",
  "source.size",
  "source.colour",
  "source.quantity",
  "replacement.size",
  "policy.reasonLabel",
  "reason",
  "status",
  "createdAt",
  "updatedAt",
].join(" ");

const ADMIN_FIELDS = [
  "exchangeNumber",
  "__v",
  "user",
  "orderNumber",
  "source",
  "replacement",
  "policy",
  "deliveredAt",
  "windowEndsAt",
  "reason",
  "comment",
  "photos.publicId",
  "status",
  "history",
  "fee",
  "reverseShipment",
  "replacementShipment",
  "qc",
  "createdAt",
  "updatedAt",
].join(" ");

const ACTOR_POPULATIONS = [
  { path: "user", select: "name email phone" },
  { path: "history.actor", select: "name email" },
  { path: "fee.recordedBy", select: "name email" },
  { path: "reverseShipment.recordedBy", select: "name email" },
  { path: "replacementShipment.recordedBy", select: "name email" },
  { path: "qc.recordedBy", select: "name email" },
];

function safePhotoUrl(photo) {
  return mediaService.deliveryForMedia({
    type: "IMAGE",
    publicId: photo.publicId,
  }).optimizedUrl;
}

function exchangeNotFound() {
  return new AppError(ErrorCode.EXCHANGE_NOT_FOUND);
}

function invalidTransition() {
  return new AppError(ErrorCode.INVALID_EXCHANGE_TRANSITION);
}

function transactionUnavailable(options = {}) {
  return new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
    message: "Exchange administration is temporarily unavailable.",
    ...options,
  });
}

function transactionAmbiguous(cause) {
  return transactionUnavailable({
    message:
      "The exchange update outcome could not be confirmed. Refresh before trying again.",
    cause,
  });
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

function unknownCommitResult(error) {
  return hasErrorLabel(error, "UnknownTransactionCommitResult");
}

function transactionSupportError(error) {
  return (
    error?.code === 20 ||
    error?.codeName === "IllegalOperation" ||
    /transaction numbers are only allowed|does not support transactions/i.test(
      error?.message ?? "",
    )
  );
}

async function transactionAttempt(work) {
  const session = await mongoose.startSession();
  let sawUnknownCommit = false;
  let result;

  try {
    session.startTransaction({
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });
    result = await work(session);

    for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt += 1) {
      try {
        await session.commitTransaction();
        return { outcome: "committed", result };
      } catch (error) {
        if (unknownCommitResult(error)) {
          sawUnknownCommit = true;
          if (attempt < MAX_COMMIT_ATTEMPTS) {
            await wait(25 * attempt);
            continue;
          }
          return { outcome: "ambiguous", result, error };
        }

        if (sawUnknownCommit) {
          return { outcome: "ambiguous", result, error };
        }
        throw error;
      }
    }
  } catch (error) {
    if (sawUnknownCommit) {
      return { outcome: "ambiguous", result, error };
    }
    if (session.inTransaction()) {
      await session.abortTransaction().catch(() => {});
    }
    return {
      outcome: retryableTransactionError(error) ? "retry" : "failed",
      error,
    };
  } finally {
    await session.endSession();
  }

  return { outcome: "failed", error: new Error("Transaction did not finish.") };
}

async function reconcileCommit(reconcile) {
  for (let attempt = 1; attempt <= MAX_RECONCILIATION_ATTEMPTS; attempt += 1) {
    try {
      if (await reconcile()) return true;
    } catch {
      // A failed reconciliation read cannot prove either outcome. Retry the
      // bounded read, then fail safely rather than replaying the transaction.
    }
    if (attempt < MAX_RECONCILIATION_ATTEMPTS) await wait(50 * attempt);
  }
  return false;
}

async function runTransaction(work, reconcile) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    const transaction = await transactionAttempt(work);
    if (transaction.outcome === "committed") return transaction.result;
    if (transaction.outcome === "ambiguous") {
      if (await reconcileCommit(reconcile)) return transaction.result;
      throw transactionAmbiguous(transaction.error);
    }
    if (transaction.outcome === "failed") throw transaction.error;

    lastError = transaction.error;
    if (attempt === MAX_TRANSACTION_ATTEMPTS) throw transaction.error;
    await wait(25 * attempt);
  }
  throw lastError;
}

function internalRequestId(req) {
  const requestId =
    typeof req?.id === "string" && req.id.length > 0
      ? req.id.slice(0, 64)
      : "exchange";
  return `${requestId}:${randomUUID()}`;
}

function historyEvent(actor, input, status, at, requestId) {
  return {
    action: input.action,
    status,
    at,
    actor: actor._id,
    requestId,
    version: input.expectedVersion + 1,
    ...(input.publicMessage ? { publicMessage: input.publicMessage } : {}),
    ...(input.internalNote ? { internalNote: input.internalNote } : {}),
  };
}

function shipmentSnapshot(actor, input, at) {
  return {
    courier: input.courier,
    awb: input.awb,
    trackingId: input.trackingId,
    shipmentId: input.shipmentId,
    ...(input.trackingStatus ? { trackingStatus: input.trackingStatus } : {}),
    recordedAt: at,
    recordedBy: actor._id,
  };
}

async function ensureConflictOrNotFound(exchangeNumber, session) {
  const exists = await Exchange.exists({ exchangeNumber }).session(session);
  if (!exists) throw exchangeNotFound();
  throw invalidTransition();
}

async function compareAndSet({
  actor,
  exchangeNumber,
  input,
  requestId,
  fromStatuses,
  toStatus,
  set = {},
  extraConditions = [],
  session,
}) {
  const now = new Date();
  const filter = {
    exchangeNumber,
    __v: input.expectedVersion,
    status: { $in: fromStatuses },
  };
  if (extraConditions.length > 0) filter.$and = extraConditions;
  const previous = await Exchange.findOneAndUpdate(
    filter,
    {
      $set: { status: toStatus, ...set },
      $push: {
        history: historyEvent(actor, input, toStatus, now, requestId),
      },
      $inc: { __v: 1 },
    },
    {
      new: false,
      runValidators: true,
      session,
    },
  ).select("exchangeNumber user order orderNumber status __v replacement");
  if (!previous) await ensureConflictOrNotFound(exchangeNumber, session);
  return { previous, toStatus, at: now };
}

async function loadAdminExchange(exchangeNumber) {
  const exchange = await Exchange.findOne({ exchangeNumber })
    .select(ADMIN_FIELDS)
    .populate(ACTOR_POPULATIONS)
    .lean();
  if (!exchange) throw exchangeNotFound();
  return exchange;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function adminFilter({ status, q }) {
  const filter = {};
  if (status) filter.status = status;
  if (!q) return filter;

  const pattern = new RegExp(escapeRegex(q), "i");
  const customers = await User.find({
    $or: [{ name: pattern }, { email: pattern }, { phone: pattern }],
  })
    .select("_id")
    .limit(500)
    .lean();
  filter.$or = [
    { exchangeNumber: pattern },
    { orderNumber: pattern },
    { "source.productName": pattern },
    { "source.sku": pattern },
    { "replacement.sku": pattern },
    { user: { $in: customers.map((customer) => customer._id) } },
  ];
  return filter;
}

async function auditAccepted({ actor, input, result, req, session }) {
  await auditService.recordStrict(
    {
      action: AUDIT_ACTION_FOR[input.action],
      actor,
      targetType: AuditTargetType.EXCHANGE,
      targetId: result.previous._id,
      targetLabel: result.previous.exchangeNumber,
      metadata: {
        exchangeNumber: result.previous.exchangeNumber,
        orderNumber: result.previous.orderNumber,
        action: input.action,
        fromStatus: result.previous.status,
        toStatus: result.toStatus,
        fromVersion: result.previous.__v,
        toVersion: result.previous.__v + 1,
      },
      req,
    },
    session,
  );
}

async function recordReplacementShipment(
  actor,
  exchangeNumber,
  input,
  requestId,
  session,
) {
  const now = new Date();
  const result = await compareAndSet({
    actor,
    exchangeNumber,
    input,
    requestId,
    fromStatuses: [ExchangeStatus.QC_PASSED],
    toStatus: ExchangeStatus.REPLACEMENT_SHIPPED,
    set: {
      replacementShipment: shipmentSnapshot(actor, input, now),
    },
    session,
  });
  const replacement = result.previous.replacement;
  const product = await Product.findOneAndUpdate(
    {
      _id: replacement.productId,
      variants: {
        $elemMatch: {
          _id: replacement.variantId,
          stock: { $gte: replacement.quantity },
        },
      },
    },
    {
      $inc: {
        "variants.$[selected].stock": -replacement.quantity,
        __v: 1,
      },
    },
    {
      new: false,
      session,
      arrayFilters: [
        {
          "selected._id": replacement.variantId,
          "selected.stock": { $gte: replacement.quantity },
        },
      ],
    },
  ).select("name status variants");
  if (!product) {
    throw new AppError(ErrorCode.STOCK_CHANGED);
  }
  const variant = product.variants.id(replacement.variantId);
  if (!variant) throw new AppError(ErrorCode.STOCK_CHANGED);

  let transaction;
  try {
    [transaction] = await ExchangeInventoryTransaction.create(
      [
        {
          exchange: result.previous._id,
          product: replacement.productId,
          variant: replacement.variantId,
          reason: ExchangeInventoryReason.REPLACEMENT_SHIPPED,
          quantityDelta: -replacement.quantity,
        },
      ],
      { session },
    );
  } catch (error) {
    if (error?.code === 11000) throw invalidTransition();
    throw error;
  }
  await notificationService.observeLowStockTransition(
    {
      productId: product._id,
      variantId: variant._id,
      productName: product.name,
      sku: variant.sku,
      beforeStock: variant.stock,
      afterStock: variant.stock - replacement.quantity,
      threshold: variant.lowStockThreshold,
      productStatus: product.status,
      variantStatus: variant.status,
      sourceType: ExchangeInventoryReason.REPLACEMENT_SHIPPED,
      sourceId: transaction._id,
      occurredAt: transaction.createdAt,
    },
    { session },
  );
  return result;
}

async function applyAction(actor, exchangeNumber, input, requestId, session) {
  if (!session) throw transactionUnavailable();

  switch (input.action) {
    case ExchangeAction.REQUEST_INFORMATION:
      return compareAndSet({
        actor,
        exchangeNumber,
        input,
        requestId,
        fromStatuses: [ExchangeStatus.REQUESTED],
        toStatus: ExchangeStatus.INFORMATION_REQUESTED,
        session,
      });
    case ExchangeAction.APPROVE:
      return compareAndSet({
        actor,
        exchangeNumber,
        input,
        requestId,
        fromStatuses: [
          ExchangeStatus.REQUESTED,
          ExchangeStatus.INFORMATION_REQUESTED,
        ],
        toStatus: ExchangeStatus.APPROVED,
        session,
      });
    case ExchangeAction.REJECT:
      return compareAndSet({
        actor,
        exchangeNumber,
        input,
        requestId,
        fromStatuses: [
          ExchangeStatus.REQUESTED,
          ExchangeStatus.INFORMATION_REQUESTED,
        ],
        toStatus: ExchangeStatus.REJECTED,
        session,
      });
    case ExchangeAction.RECORD_FEE: {
      const now = new Date();
      return compareAndSet({
        actor,
        exchangeNumber,
        input,
        requestId,
        fromStatuses: [ExchangeStatus.APPROVED],
        toStatus:
          input.amountPaise > 0
            ? ExchangeStatus.FEE_DUE
            : ExchangeStatus.APPROVED,
        set: {
          fee: {
            amountPaise: input.amountPaise,
            currency: input.currency,
            recordedAt: now,
            recordedBy: actor._id,
          },
        },
        extraConditions: [{ fee: { $exists: false } }],
        session,
      });
    }
    case ExchangeAction.RECORD_REVERSE_SHIPMENT: {
      const now = new Date();
      return compareAndSet({
        actor,
        exchangeNumber,
        input,
        requestId,
        fromStatuses: [ExchangeStatus.APPROVED, ExchangeStatus.FEE_PAID],
        toStatus: ExchangeStatus.REVERSE_PICKUP,
        set: { reverseShipment: shipmentSnapshot(actor, input, now) },
        extraConditions: [
          {
            $or: [
              {
                status: ExchangeStatus.APPROVED,
                $or: [{ fee: { $exists: false } }, { "fee.amountPaise": 0 }],
              },
              { status: ExchangeStatus.FEE_PAID },
            ],
          },
        ],
        session,
      });
    }
    case ExchangeAction.MARK_RECEIVED:
      return compareAndSet({
        actor,
        exchangeNumber,
        input,
        requestId,
        fromStatuses: [ExchangeStatus.REVERSE_PICKUP],
        toStatus: ExchangeStatus.RECEIVED,
        session,
      });
    case ExchangeAction.UPDATE_QC: {
      const now = new Date();
      const passed = input.result === ExchangeQcResult.PASSED;
      return compareAndSet({
        actor,
        exchangeNumber,
        input,
        requestId,
        fromStatuses: [ExchangeStatus.RECEIVED],
        toStatus: passed ? ExchangeStatus.QC_PASSED : ExchangeStatus.QC_FAILED,
        set: {
          qc: {
            result: input.result,
            recordedAt: now,
            recordedBy: actor._id,
          },
        },
        session,
      });
    }
    case ExchangeAction.RECORD_REPLACEMENT_SHIPMENT:
      return recordReplacementShipment(
        actor,
        exchangeNumber,
        input,
        requestId,
        session,
      );
    case ExchangeAction.COMPLETE:
      return compareAndSet({
        actor,
        exchangeNumber,
        input,
        requestId,
        fromStatuses: [ExchangeStatus.REPLACEMENT_SHIPPED],
        toStatus: ExchangeStatus.COMPLETED,
        extraConditions: [{ replacementShipment: { $exists: true } }],
        session,
      });
    default:
      throw invalidTransition();
  }
}

function exchangeNotificationType(input, result) {
  switch (input.action) {
    case ExchangeAction.REQUEST_INFORMATION:
      return NotificationType.EXCHANGE_INFORMATION_REQUESTED;
    case ExchangeAction.APPROVE:
      return NotificationType.EXCHANGE_APPROVED;
    case ExchangeAction.REJECT:
      return NotificationType.EXCHANGE_REJECTED;
    case ExchangeAction.RECORD_FEE:
      return result.toStatus === ExchangeStatus.FEE_DUE
        ? NotificationType.EXCHANGE_FEE_DUE
        : null;
    case ExchangeAction.RECORD_REVERSE_SHIPMENT:
      return NotificationType.EXCHANGE_REVERSE_PICKUP;
    case ExchangeAction.MARK_RECEIVED:
      return NotificationType.EXCHANGE_RECEIVED;
    case ExchangeAction.UPDATE_QC:
      return result.toStatus === ExchangeStatus.QC_PASSED
        ? NotificationType.EXCHANGE_QC_PASSED
        : NotificationType.EXCHANGE_QC_FAILED;
    case ExchangeAction.RECORD_REPLACEMENT_SHIPMENT:
      return NotificationType.EXCHANGE_REPLACEMENT_SHIPPED;
    case ExchangeAction.COMPLETE:
      return NotificationType.EXCHANGE_COMPLETED;
    default:
      return null;
  }
}

async function publishExchangeTransitionNotification(input, result, session) {
  const type = exchangeNotificationType(input, result);
  if (!type) return;

  const order = await Order.findById(result.previous.order)
    .select("shippingAddress.email shippingAddress.recipientName")
    .session(session)
    .lean();
  if (!order) throw new AppError(ErrorCode.ORDER_NOT_FOUND);

  const exchange = result.previous;
  await notificationService.publish(
    {
      eventKey: `exchange:${exchange._id}:v:${exchange.__v + 1}:${result.toStatus}:${input.action}:${type}`,
      type,
      occurredAt: result.at,
      payload: {},
      customer: {
        userId: exchange.user,
        email: order.shippingAddress.email,
        name: order.shippingAddress.recipientName,
      },
      customerTarget: {
        kind: NotificationTargetKind.EXCHANGE,
        reference: exchange.exchangeNumber,
      },
    },
    { session },
  );
}

async function actionWasCommitted({ actor, exchangeNumber, input, requestId }) {
  const committed = await Exchange.exists({
    exchangeNumber,
    history: {
      $elemMatch: {
        requestId,
        version: input.expectedVersion + 1,
        action: input.action,
        actor: actor._id,
      },
    },
  })
    .read("primary")
    .readConcern("majority");
  return Boolean(committed);
}

export const exchangeAdminService = {
  async list(query) {
    const filter = await adminFilter(query);
    const { page, limit } = query;
    const [rows, total] = await Promise.all([
      Exchange.find(filter)
        .select(ADMIN_LIST_FIELDS)
        .populate({ path: "user", select: "name email" })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Exchange.countDocuments(filter),
    ]);
    return {
      exchanges: rows.map(adminExchangeListItem),
      page,
      limit,
      total,
    };
  },

  async get(exchangeNumber) {
    return adminExchangeDto(
      await loadAdminExchange(exchangeNumber),
      safePhotoUrl,
    );
  },

  async performAction(actor, exchangeNumber, input, req) {
    if (!(await supportsTransactions())) throw transactionUnavailable();

    const requestId = internalRequestId(req);
    try {
      await runTransaction(
        async (session) => {
          const result = await applyAction(
            actor,
            exchangeNumber,
            input,
            requestId,
            session,
          );
          await auditAccepted({ actor, input, result, req, session });
          await publishExchangeTransitionNotification(input, result, session);
          return result;
        },
        () => actionWasCommitted({ actor, exchangeNumber, input, requestId }),
      );
    } catch (error) {
      if (transactionSupportError(error)) {
        throw transactionUnavailable({ cause: error });
      }
      throw error;
    }

    return adminExchangeDto(
      await loadAdminExchange(exchangeNumber),
      safePhotoUrl,
    );
  },
};
