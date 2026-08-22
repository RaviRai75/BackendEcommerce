import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { supportsTransactions } from "../../config/database.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { notificationService } from "../notifications/notification.service.js";
import {
  NotificationTargetKind,
  NotificationType,
} from "../notifications/notification.model.js";
import { Exchange } from "../exchanges/exchange.model.js";
import {
  normalizeCourierKey,
  Shipment,
  ShipmentAdapter,
  ShipmentDirection,
  ShipmentStatus,
  ShipmentTargetType,
} from "../shipping/shipment.model.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import { User } from "../users/user.model.js";
import { adminOrderDetail, adminOrderListItem } from "./order.dto.js";
import {
  Order,
  OrderFulfillmentAction,
  OrderFulfillmentStatus,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderPlacementStatus,
} from "./order.model.js";
import { releaseOrderResources } from "./orderRelease.service.js";

const MAX_TRANSACTION_ATTEMPTS = 5;
const MAX_COMMIT_ATTEMPTS = 5;
const MAX_RECONCILIATION_ATTEMPTS = 3;
const MAX_DETAIL_READ_ATTEMPTS = 3;
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const AUDIT_ACTION_FOR = Object.freeze({
  [OrderFulfillmentAction.START_PROCESSING]: AuditAction.ORDER_STATUS_CHANGED,
  [OrderFulfillmentAction.MARK_PACKED]: AuditAction.ORDER_STATUS_CHANGED,
  [OrderFulfillmentAction.RECORD_SHIPMENT]: AuditAction.SHIPMENT_RECORDED,
  [OrderFulfillmentAction.MARK_OUT_FOR_DELIVERY]:
    AuditAction.ORDER_STATUS_CHANGED,
  [OrderFulfillmentAction.MARK_DELIVERED]: AuditAction.ORDER_STATUS_CHANGED,
  [OrderFulfillmentAction.CANCEL]: AuditAction.ORDER_CANCELLED,
});

const ADMIN_LIST_FIELDS = [
  "orderNumber",
  "__v",
  "user",
  "paymentMethod",
  "paymentStatus",
  "fulfillmentStatus",
  "itemCount",
  "items.productName",
  "items.sku",
  "pricing.finalTotalPaise",
  "createdAt",
  "updatedAt",
].join(" ");

const ADMIN_DETAIL_FIELDS = [
  "orderNumber",
  "__v",
  "user",
  "paymentMethod",
  "placementStatus",
  "paymentStatus",
  "fulfillmentStatus",
  "items",
  "shippingAddress",
  "pricing",
  "coupon",
  "statusHistory",
  "itemCount",
  "paidAt",
  "deliveredAt",
  "releasedAt",
  "releaseReason",
  "createdAt",
  "updatedAt",
].join(" ");

const ORDER_POPULATIONS = [
  { path: "user", select: "name email phone" },
  { path: "statusHistory.actor", select: "name email" },
];

const SHIPMENT_POPULATIONS = [
  { path: "recordedBy", select: "name email" },
  { path: "milestones.actor", select: "name email" },
];

function orderNotFound() {
  return new AppError(ErrorCode.ORDER_NOT_FOUND);
}

function invalidTransition(options = {}) {
  return new AppError(ErrorCode.INVALID_STATUS_TRANSITION, options);
}

function transactionUnavailable(options = {}) {
  return new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
    message: "Order fulfillment is temporarily unavailable.",
    ...options,
  });
}

function transactionAmbiguous(cause) {
  return transactionUnavailable({
    message:
      "The order update outcome could not be confirmed. Refresh before trying again.",
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
      // A failed majority read cannot prove that the transaction did not commit.
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
      : "order";
  return `${requestId}:${randomUUID()}`;
}

function fulfillmentHistoryEvent({
  actor,
  input,
  status,
  at,
  requestId,
  reason,
}) {
  return {
    domain: "FULFILLMENT",
    status,
    at,
    action: input.action,
    actor: actor._id,
    requestId,
    version: input.expectedVersion + 1,
    ...(reason ? { reason } : {}),
  };
}

async function ensureConflictOrNotFound(orderNumber, session) {
  const exists = await Order.exists({ orderNumber }).session(session);
  if (!exists) throw orderNotFound();
  throw invalidTransition();
}

async function compareAndSet({
  actor,
  orderNumber,
  input,
  requestId,
  fromStatuses,
  toStatus,
  set = {},
  extraConditions = [],
  at = new Date(),
  session,
}) {
  const filter = {
    orderNumber,
    __v: input.expectedVersion,
    placementStatus: OrderPlacementStatus.PLACED,
    fulfillmentStatus: { $in: fromStatuses },
  };
  if (extraConditions.length > 0) filter.$and = extraConditions;

  const previous = await Order.findOneAndUpdate(
    filter,
    {
      $set: { fulfillmentStatus: toStatus, ...set },
      $push: {
        statusHistory: fulfillmentHistoryEvent({
          actor,
          input,
          status: toStatus,
          at,
          requestId,
        }),
      },
      $inc: { __v: 1 },
    },
    { new: false, runValidators: true, session },
  ).select(
    "orderNumber __v user shippingAddress.email shippingAddress.recipientName placementStatus paymentMethod paymentStatus fulfillmentStatus items",
  );

  if (!previous) await ensureConflictOrNotFound(orderNumber, session);
  return { previous, toStatus, at };
}

async function createForwardShipment({ actor, result, input, session }) {
  try {
    await Shipment.create(
      [
        {
          targetType: ShipmentTargetType.ORDER,
          order: result.previous._id,
          orderNumber: result.previous.orderNumber,
          direction: ShipmentDirection.FORWARD,
          adapter: ShipmentAdapter.MANUAL,
          courier: input.courier,
          courierKey: normalizeCourierKey(input.courier),
          awb: input.awb,
          trackingId: input.trackingId,
          shipmentId: input.shipmentId,
          status: ShipmentStatus.SHIPPED,
          recordedAt: result.at,
          recordedBy: actor._id,
          shippedAt: result.at,
          milestones: [
            {
              status: ShipmentStatus.SHIPPED,
              at: result.at,
              actor: actor._id,
            },
          ],
        },
      ],
      { session },
    );
  } catch (error) {
    if (error?.code === 11000) throw invalidTransition({ cause: error });
    throw error;
  }
}

async function advanceShipment({
  actor,
  orderId,
  fromStatus,
  toStatus,
  at,
  session,
}) {
  const timestampField =
    toStatus === ShipmentStatus.OUT_FOR_DELIVERY
      ? "outForDeliveryAt"
      : "deliveredAt";
  const shipment = await Shipment.findOneAndUpdate(
    {
      order: orderId,
      direction: ShipmentDirection.FORWARD,
      status: fromStatus,
      [timestampField]: { $exists: false },
    },
    {
      $set: { status: toStatus, [timestampField]: at },
      $push: { milestones: { status: toStatus, at, actor: actor._id } },
    },
    { new: false, runValidators: true, session },
  ).select("status");
  if (!shipment) throw invalidTransition();
}

async function cancelOrder(actor, orderNumber, input, requestId, session) {
  const existingShipment = await Shipment.exists({
    orderNumber,
    direction: ShipmentDirection.FORWARD,
  }).session(session);
  if (existingShipment) throw invalidTransition();

  const at = new Date();
  const reason = input.reason;
  const fulfillmentEvent = fulfillmentHistoryEvent({
    actor,
    input,
    status: OrderFulfillmentStatus.CANCELLED,
    at,
    requestId,
    reason,
  });
  const previous = await Order.findOneAndUpdate(
    {
      orderNumber,
      __v: input.expectedVersion,
      placementStatus: OrderPlacementStatus.PLACED,
      fulfillmentStatus: {
        $in: [
          OrderFulfillmentStatus.UNFULFILLED,
          OrderFulfillmentStatus.PROCESSING,
          OrderFulfillmentStatus.PACKED,
        ],
      },
      paymentStatus: {
        $in: [OrderPaymentStatus.COD_DUE, OrderPaymentStatus.PREPAID_PENDING],
      },
    },
    {
      $set: {
        placementStatus: OrderPlacementStatus.RELEASED,
        paymentStatus: OrderPaymentStatus.CANCELLED,
        fulfillmentStatus: OrderFulfillmentStatus.CANCELLED,
        releasedAt: at,
        releaseReason: reason,
      },
      $push: {
        statusHistory: {
          $each: [
            {
              domain: "PLACEMENT",
              status: OrderPlacementStatus.RELEASED,
              reason,
              at,
            },
            {
              domain: "PAYMENT",
              status: OrderPaymentStatus.CANCELLED,
              reason,
              at,
            },
            fulfillmentEvent,
          ],
        },
      },
      $inc: { __v: 1 },
    },
    { new: false, runValidators: true, session },
  ).select(
    "orderNumber __v user shippingAddress.email shippingAddress.recipientName placementStatus paymentMethod paymentStatus fulfillmentStatus items",
  );

  if (!previous) await ensureConflictOrNotFound(orderNumber, session);
  await releaseOrderResources({ order: previous, reason, at, session });
  return { previous, toStatus: OrderFulfillmentStatus.CANCELLED, at };
}

async function applyAction(actor, orderNumber, input, requestId, session) {
  if (!session) throw transactionUnavailable();

  switch (input.action) {
    case OrderFulfillmentAction.START_PROCESSING:
      return compareAndSet({
        actor,
        orderNumber,
        input,
        requestId,
        fromStatuses: [OrderFulfillmentStatus.UNFULFILLED],
        toStatus: OrderFulfillmentStatus.PROCESSING,
        extraConditions: [
          {
            $or: [
              {
                paymentMethod: OrderPaymentMethod.COD,
                paymentStatus: OrderPaymentStatus.COD_DUE,
              },
              {
                paymentMethod: OrderPaymentMethod.PREPAID,
                paymentStatus: OrderPaymentStatus.PREPAID_CONFIRMED,
              },
            ],
          },
        ],
        session,
      });
    case OrderFulfillmentAction.MARK_PACKED:
      return compareAndSet({
        actor,
        orderNumber,
        input,
        requestId,
        fromStatuses: [OrderFulfillmentStatus.PROCESSING],
        toStatus: OrderFulfillmentStatus.PACKED,
        session,
      });
    case OrderFulfillmentAction.RECORD_SHIPMENT: {
      const result = await compareAndSet({
        actor,
        orderNumber,
        input,
        requestId,
        fromStatuses: [OrderFulfillmentStatus.PACKED],
        toStatus: OrderFulfillmentStatus.SHIPPED,
        session,
      });
      await createForwardShipment({ actor, result, input, session });
      return result;
    }
    case OrderFulfillmentAction.MARK_OUT_FOR_DELIVERY: {
      const result = await compareAndSet({
        actor,
        orderNumber,
        input,
        requestId,
        fromStatuses: [OrderFulfillmentStatus.SHIPPED],
        toStatus: OrderFulfillmentStatus.OUT_FOR_DELIVERY,
        session,
      });
      await advanceShipment({
        actor,
        orderId: result.previous._id,
        fromStatus: ShipmentStatus.SHIPPED,
        toStatus: ShipmentStatus.OUT_FOR_DELIVERY,
        at: result.at,
        session,
      });
      return result;
    }
    case OrderFulfillmentAction.MARK_DELIVERED: {
      const at = new Date();
      const result = await compareAndSet({
        actor,
        orderNumber,
        input,
        requestId,
        fromStatuses: [OrderFulfillmentStatus.OUT_FOR_DELIVERY],
        toStatus: OrderFulfillmentStatus.DELIVERED,
        set: { deliveredAt: at },
        extraConditions: [{ deliveredAt: { $exists: false } }],
        at,
        session,
      });
      await advanceShipment({
        actor,
        orderId: result.previous._id,
        fromStatus: ShipmentStatus.OUT_FOR_DELIVERY,
        toStatus: ShipmentStatus.DELIVERED,
        at,
        session,
      });
      return result;
    }
    case OrderFulfillmentAction.CANCEL:
      return cancelOrder(actor, orderNumber, input, requestId, session);
    default:
      throw invalidTransition();
  }
}

async function auditAccepted({ actor, input, result, req, session }) {
  await auditService.recordStrict(
    {
      action: AUDIT_ACTION_FOR[input.action],
      actor,
      targetType: AuditTargetType.ORDER,
      targetId: result.previous._id,
      targetLabel: result.previous.orderNumber,
      metadata: {
        orderNumber: result.previous.orderNumber,
        action: input.action,
        fromStatus: result.previous.fulfillmentStatus,
        toStatus: result.toStatus,
        fromVersion: result.previous.__v,
        toVersion: result.previous.__v + 1,
      },
      req,
    },
    session,
  );
}

const FULFILLMENT_NOTIFICATION_TYPE_FOR = Object.freeze({
  [OrderFulfillmentStatus.SHIPPED]: NotificationType.ORDER_SHIPPED,
  [OrderFulfillmentStatus.OUT_FOR_DELIVERY]:
    NotificationType.ORDER_OUT_FOR_DELIVERY,
  [OrderFulfillmentStatus.DELIVERED]: NotificationType.ORDER_DELIVERED,
});

async function publishFulfillmentNotification(result, session) {
  const type = FULFILLMENT_NOTIFICATION_TYPE_FOR[result.toStatus];
  if (!type) return;

  const order = result.previous;
  await notificationService.publish(
    {
      eventKey: `order:${order._id}:v:${order.__v + 1}:${result.toStatus}:${type}`,
      type,
      occurredAt: result.at,
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
}

async function actionWasCommitted({ actor, orderNumber, input, requestId }) {
  const committed = await Order.exists({
    orderNumber,
    statusHistory: {
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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function adminFilter({ status, paymentStatus }) {
  const filter = {};
  if (status) filter.fulfillmentStatus = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  return filter;
}

async function searchAdminOrders({ page, limit, status, paymentStatus, q }) {
  const pattern = new RegExp(escapeRegex(q), "i");
  const [result] = await Order.aggregate([
    { $match: adminFilter({ status, paymentStatus }) },
    {
      $lookup: {
        from: User.collection.name,
        let: { customerId: "$user" },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$customerId"] } } },
          { $project: { name: 1, email: 1, phone: 1 } },
        ],
        as: "matchedCustomer",
      },
    },
    {
      $set: {
        user: { $arrayElemAt: ["$matchedCustomer", 0] },
      },
    },
    {
      $match: {
        $or: [
          { orderNumber: pattern },
          { "items.productName": pattern },
          { "items.sku": pattern },
          { "user.name": pattern },
          { "user.email": pattern },
          { "user.phone": pattern },
        ],
      },
    },
    {
      $project: {
        orderNumber: 1,
        __v: 1,
        user: {
          _id: "$user._id",
          name: "$user.name",
          email: "$user.email",
        },
        paymentMethod: 1,
        paymentStatus: 1,
        fulfillmentStatus: 1,
        itemCount: 1,
        "items.productName": 1,
        "items.sku": 1,
        "pricing.finalTotalPaise": 1,
        createdAt: 1,
        updatedAt: 1,
      },
    },
    {
      $facet: {
        rows: [
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ],
        totals: [{ $count: "value" }],
      },
    },
  ]).allowDiskUse(true);

  const rows = result?.rows ?? [];
  return {
    orders: rows.map(adminOrderListItem),
    page,
    limit,
    total: result?.totals?.[0]?.value ?? 0,
  };
}

async function populateSequentially(model, document, populations, session) {
  if (!document) return;
  for (const population of populations) {
    await model.populate(document, {
      ...population,
      options: { session },
    });
  }
}

async function loadAdminOrder(orderNumber, { session = null } = {}) {
  const attempts = session ? 1 : MAX_DETAIL_READ_ATTEMPTS;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let orderQuery = Order.findOne({ orderNumber }).select(ADMIN_DETAIL_FIELDS);
    if (session) {
      orderQuery = orderQuery.session(session);
    } else {
      orderQuery = orderQuery.populate(ORDER_POPULATIONS);
    }
    const order = await orderQuery.lean();
    if (!order) throw orderNotFound();
    if (session) {
      await populateSequentially(Order, order, ORDER_POPULATIONS, session);
    }

    let shipmentQuery = Shipment.findOne({
      order: order._id,
      direction: ShipmentDirection.FORWARD,
    });
    if (!session) shipmentQuery = shipmentQuery.populate(SHIPMENT_POPULATIONS);
    let exchangesQuery = Exchange.find({ order: order._id })
      .select("exchangeNumber status createdAt")
      .sort({ createdAt: -1, _id: -1 });
    if (session) {
      shipmentQuery = shipmentQuery.session(session);
      exchangesQuery = exchangesQuery.session(session);
    }

    let shipment;
    let exchanges;
    if (session) {
      shipment = await shipmentQuery.lean();
      await populateSequentially(
        Shipment,
        shipment,
        SHIPMENT_POPULATIONS,
        session,
      );
      exchanges = await exchangesQuery.lean();
    } else {
      [shipment, exchanges] = await Promise.all([
        shipmentQuery.lean(),
        exchangesQuery.lean(),
      ]);
    }

    if (session) return adminOrderDetail(order, shipment, exchanges);

    const unchanged = await Order.exists({
      _id: order._id,
      orderNumber,
      __v: order.__v,
    });
    if (unchanged) return adminOrderDetail(order, shipment, exchanges);
  }

  throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
    message:
      "The order changed while it was being loaded. Refresh and try again.",
  });
}

export const orderFulfillmentService = {
  async list(query) {
    if (query.q) return searchAdminOrders(query);

    const filter = adminFilter(query);
    const { page, limit } = query;
    const [rows, total] = await Promise.all([
      Order.find(filter)
        .select(ADMIN_LIST_FIELDS)
        .populate({ path: "user", select: "name email" })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);
    return {
      orders: rows.map(adminOrderListItem),
      page,
      limit,
      total,
    };
  },

  async get(orderNumber) {
    return loadAdminOrder(orderNumber);
  },

  async performAction(actor, orderNumber, input, req) {
    if (!(await supportsTransactions())) throw transactionUnavailable();

    const requestId = internalRequestId(req);
    try {
      return await runTransaction(
        async (session) => {
          const result = await applyAction(
            actor,
            orderNumber,
            input,
            requestId,
            session,
          );
          await auditAccepted({ actor, input, result, req, session });
          await publishFulfillmentNotification(result, session);
          return loadAdminOrder(orderNumber, { session });
        },
        () => actionWasCommitted({ actor, orderNumber, input, requestId }),
      );
    } catch (error) {
      if (transactionSupportError(error)) {
        throw transactionUnavailable({ cause: error });
      }
      throw error;
    }
  },
};
