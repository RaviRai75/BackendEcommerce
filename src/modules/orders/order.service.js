import crypto from "node:crypto";
import mongoose from "mongoose";
import { supportsTransactions } from "../../config/database.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { abandonedCartEventService } from "../cart/abandonedCartEvent.service.js";
import { Cart } from "../cart/cart.model.js";
import { Coupon } from "../coupons/coupon.model.js";
import {
  Product,
  ProductStatus,
  ProductVariantStatus,
} from "../products/product.model.js";
import { notificationService } from "../notifications/notification.service.js";
import {
  NotificationTargetKind,
  NotificationType,
} from "../notifications/notification.model.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import { getPaymentCapabilities } from "../../services/payment/index.js";
import { CouponCustomerUsage } from "./couponCustomerUsage.model.js";
import {
  CouponRedemption,
  CouponRedemptionStatus,
} from "./couponRedemption.model.js";
import { CustomerCommerceState } from "./customerCommerceState.model.js";
import {
  InventoryReason,
  InventoryTransaction,
} from "./inventoryTransaction.model.js";
import {
  customerOrderDetail,
  customerOrderListItem,
  orderQuote,
  orderReceipt,
} from "./order.dto.js";
import {
  composeAuthoritativeCheckout,
  pricingForPaymentMethod,
} from "./order.composition.js";
import {
  Order,
  OrderFulfillmentStatus,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderPlacementStatus,
} from "./order.model.js";
import { assertPlacementReleasable } from "./order.stateMachine.js";
import { releaseOrderResources } from "./orderRelease.service.js";
import { Shipment, ShipmentDirection } from "../shipping/shipment.model.js";
import {
  EXCHANGE_POLICY_KEY,
  ExchangePolicy,
  ExchangeReason,
} from "../exchanges/exchangePolicy.model.js";

const MAX_TRANSACTION_ATTEMPTS = 5;
const MAX_DETAIL_READ_ATTEMPTS = 3;
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function idempotencyConflict() {
  return new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, { status: 409 });
}

function settingsUnavailable() {
  return new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
    message: "Order placement is temporarily unavailable. Please try again.",
  });
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
      await wait(25 * attempt);
    } finally {
      await session.endSession();
    }
  }
  throw lastError;
}

function replayResult(order, fingerprint) {
  if (order.requestFingerprint !== fingerprint) throw idempotencyConflict();
  return { replayed: true, receipt: orderReceipt(order) };
}

function capturedLines(cart) {
  return (cart?.lines ?? []).map((line) => ({
    product: line.product,
    variant: line.variant,
    quantity: line.quantity,
  }));
}

function validExchangePolicy(policy) {
  if (
    !policy?.enabled ||
    policy.key !== EXCHANGE_POLICY_KEY ||
    !Number.isInteger(policy.version) ||
    policy.version < 1 ||
    !Number.isInteger(policy.windowDays) ||
    policy.windowDays < 0 ||
    policy.windowDays > 365 ||
    !Array.isArray(policy.reasons) ||
    policy.reasons.length === 0
  )
    return false;
  const codes = new Set();
  return policy.reasons.every((reason) => {
    const valid =
      Object.values(ExchangeReason).includes(reason?.code) &&
      typeof reason.label === "string" &&
      reason.label.trim().length > 0 &&
      reason.label.length <= 80 &&
      Number.isInteger(reason.minPhotos) &&
      reason.minPhotos >= 0 &&
      reason.minPhotos <= 5 &&
      !codes.has(reason.code);
    codes.add(reason?.code);
    return valid;
  });
}

async function exchangeEntitlements(lines, session) {
  const policy = await ExchangePolicy.findOne({ key: EXCHANGE_POLICY_KEY })
    .session(session)
    .lean();
  const policyAvailable = validExchangePolicy(policy);
  return lines.map((line) => {
    const productEligible = line.exchangeEligibleAtCheckout === true;
    return {
      lineToken: crypto.randomBytes(24).toString("base64url"),
      exchangeEntitlement: {
        eligible: productEligible && policyAvailable,
        productEligible,
        policyAvailable,
        ...(policyAvailable
          ? {
              policyKey: policy.key,
              policyVersion: policy.version,
              windowDays: policy.windowDays,
              reasons: policy.reasons.map((reason) => ({
                code: reason.code,
                label: reason.label,
                minPhotos: reason.minPhotos,
              })),
            }
          : { reasons: [] }),
      },
    };
  });
}

async function allocateSequence(userId, session) {
  const state = await CustomerCommerceState.findOneAndUpdate(
    { user: userId },
    { $inc: { orderSequence: 1 }, $setOnInsert: { user: userId } },
    { new: true, upsert: true, session, runValidators: true },
  );
  return state.orderSequence;
}

async function consumeCoupon({ coupon, userId, orderId, session }) {
  const global = await Coupon.updateOne(
    {
      _id: coupon._id,
      status: coupon.status,
      $or: [
        { usageLimit: null },
        { $expr: { $lt: ["$usageCount", "$usageLimit"] } },
      ],
    },
    { $inc: { usageCount: 1 } },
    { session },
  );
  if (global.modifiedCount !== 1)
    throw new AppError(ErrorCode.COUPON_LIMIT_REACHED);

  const perCustomerUsageLimit =
    coupon.perCustomerUsageLimit === undefined
      ? 1
      : coupon.perCustomerUsageLimit;
  const limited = perCustomerUsageLimit !== null;
  if (limited) {
    const usage = await CouponCustomerUsage.findOneAndUpdate(
      {
        coupon: coupon._id,
        user: userId,
        usageCount: { $lt: perCustomerUsageLimit },
      },
      { $inc: { usageCount: 1 } },
      { new: true, session },
    );
    if (!usage) {
      try {
        await CouponCustomerUsage.create(
          [{ coupon: coupon._id, user: userId, usageCount: 1 }],
          { session },
        );
      } catch (error) {
        if (error?.code === 11000)
          throw new AppError(ErrorCode.COUPON_NOT_ELIGIBLE);
        throw error;
      }
    }
  }
  await CouponRedemption.create(
    [
      {
        order: orderId,
        coupon: coupon._id,
        user: userId,
        status: CouponRedemptionStatus.CONSUMED,
        countedPerCustomer: limited,
        perCustomerUsageLimitSnapshot: limited
          ? perCustomerUsageLimit
          : undefined,
        history: [{ status: CouponRedemptionStatus.CONSUMED, at: new Date() }],
      },
    ],
    { session },
  );
}

async function deductStockAndLedger(lines, orderId, session) {
  for (const line of lines) {
    const product = await Product.findOneAndUpdate(
      {
        _id: line.productId,
        status: ProductStatus.PUBLISHED,
        variants: {
          $elemMatch: {
            _id: line.variantId,
            status: { $ne: ProductVariantStatus.RETIRED },
            stock: { $gte: line.quantity },
          },
        },
      },
      {
        $inc: {
          "variants.$[selected].stock": -line.quantity,
          __v: 1,
        },
      },
      {
        new: false,
        session,
        arrayFilters: [
          {
            "selected._id": line.variantId,
            "selected.status": { $ne: ProductVariantStatus.RETIRED },
            "selected.stock": { $gte: line.quantity },
          },
        ],
      },
    ).select("name status variants");
    if (!product) throw new AppError(ErrorCode.STOCK_CHANGED);
    const variant = product.variants.id(line.variantId);
    if (!variant) throw new AppError(ErrorCode.STOCK_CHANGED);

    const [transaction] = await InventoryTransaction.create(
      [
        {
          order: orderId,
          product: line.productId,
          variant: line.variantId,
          reason: InventoryReason.ORDER_PLACED,
          quantityDelta: -line.quantity,
        },
      ],
      { session },
    );
    await notificationService.observeLowStockTransition(
      {
        productId: product._id,
        variantId: variant._id,
        productName: product.name,
        sku: variant.sku,
        beforeStock: variant.stock,
        afterStock: variant.stock - line.quantity,
        threshold: variant.lowStockThreshold,
        productStatus: product.status,
        variantStatus: variant.status,
        sourceType: InventoryReason.ORDER_PLACED,
        sourceId: transaction._id,
        occurredAt: transaction.createdAt,
      },
      { session },
    );
  }
}

async function publishOrderPlacedNotifications(order, occurredAt, session) {
  const customerTarget = {
    kind: NotificationTargetKind.ORDER,
    reference: order.orderNumber,
  };
  await notificationService.publish(
    {
      eventKey: `order:${order._id}:v:0:${NotificationType.ORDER_CONFIRMATION}`,
      type: NotificationType.ORDER_CONFIRMATION,
      occurredAt,
      payload: {},
      customer: {
        userId: order.user,
        email: order.shippingAddress.email,
        name: order.shippingAddress.recipientName,
      },
      customerTarget,
    },
    { session },
  );
  await notificationService.publish(
    {
      eventKey: `order:${order._id}:v:0:${NotificationType.ADMIN_NEW_ORDER}`,
      type: NotificationType.ADMIN_NEW_ORDER,
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

async function auditCreated(order, actor, req) {
  await auditService.record({
    action: AuditAction.ORDER_CREATED,
    actor,
    targetType: AuditTargetType.ORDER,
    targetId: order._id,
    targetLabel: order.orderNumber,
    metadata: {
      orderNumber: order.orderNumber,
      placementStatus: order.placementStatus,
      paymentStatus: order.paymentStatus,
      itemCount: order.itemCount,
      totals: orderReceipt(order).pricing,
    },
    req,
  });
}

function customerOrderFilter(userId, status) {
  const owner = { user: userId };
  if (!status) return owner;
  if (status === "PAYMENT_PENDING") {
    return {
      ...owner,
      placementStatus: OrderPlacementStatus.PLACED,
      paymentStatus: OrderPaymentStatus.PREPAID_PENDING,
      fulfillmentStatus: { $ne: OrderFulfillmentStatus.CANCELLED },
    };
  }
  if (status === "CONFIRMED") {
    return {
      ...owner,
      placementStatus: OrderPlacementStatus.PLACED,
      paymentStatus: {
        $in: [OrderPaymentStatus.COD_DUE, OrderPaymentStatus.PREPAID_CONFIRMED],
      },
      fulfillmentStatus: { $ne: OrderFulfillmentStatus.CANCELLED },
    };
  }
  return {
    ...owner,
    $or: [
      { placementStatus: OrderPlacementStatus.RELEASED },
      { paymentStatus: OrderPaymentStatus.CANCELLED },
      { fulfillmentStatus: OrderFulfillmentStatus.CANCELLED },
    ],
  };
}

const CUSTOMER_ORDER_LIST_FIELDS = [
  "orderNumber",
  "paymentMethod",
  "placementStatus",
  "paymentStatus",
  "fulfillmentStatus",
  "itemCount",
  "items.productName",
  "items.size",
  "items.colour",
  "items.quantity",
  "pricing.finalTotalPaise",
  "createdAt",
  "updatedAt",
].join(" ");

const CUSTOMER_ORDER_DETAIL_FIELDS = [
  "_id",
  "__v",
  "orderNumber",
  "paymentMethod",
  "placementStatus",
  "paymentStatus",
  "fulfillmentStatus",
  "itemCount",
  "items.productName",
  "items.sku",
  "items.size",
  "items.colour",
  "items.quantity",
  "items.unitPricePaise",
  "items.compareAtUnitPricePaise",
  "items.lineMerchandiseSubtotalPaise",
  "items.lineCompareAtSubtotalPaise",
  "items.lineProductDiscountPaise",
  "shippingAddress.recipientName",
  "shippingAddress.phone",
  "shippingAddress.email",
  "shippingAddress.addressLine1",
  "shippingAddress.addressLine2",
  "shippingAddress.landmark",
  "shippingAddress.city",
  "shippingAddress.district",
  "shippingAddress.state",
  "shippingAddress.pincode",
  "pricing.merchandiseSubtotalPaise",
  "pricing.compareAtSubtotalPaise",
  "pricing.productDiscountPaise",
  "pricing.couponDiscountPaise",
  "pricing.merchandiseAfterCouponPaise",
  "pricing.deliveryChargePaise",
  "pricing.codSurchargePaise",
  "pricing.finalTotalPaise",
  "coupon.code",
  "coupon.discountPaise",
  "statusHistory.domain",
  "statusHistory.status",
  "statusHistory.at",
  "paidAt",
  "deliveredAt",
  "createdAt",
  "updatedAt",
].join(" ");

export const orderService = {
  async listMine(actor, { page, limit, status }) {
    const filter = customerOrderFilter(actor._id, status);
    const [rows, total] = await Promise.all([
      Order.find(filter)
        .select(CUSTOMER_ORDER_LIST_FIELDS)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);
    return {
      orders: rows.map(customerOrderListItem),
      page,
      limit,
      total,
    };
  },

  async getMineByNumber(actor, orderNumber) {
    for (let attempt = 1; attempt <= MAX_DETAIL_READ_ATTEMPTS; attempt += 1) {
      const order = await Order.findOne({
        user: actor._id,
        orderNumber,
      })
        .select(CUSTOMER_ORDER_DETAIL_FIELDS)
        .lean();
      if (!order) throw new AppError(ErrorCode.ORDER_NOT_FOUND);

      const shipment = await Shipment.findOne({
        order: order._id,
        direction: ShipmentDirection.FORWARD,
      })
        .select(
          "courier trackingId status milestones.status milestones.at shippedAt outForDeliveryAt deliveredAt",
        )
        .lean();
      const unchanged = await Order.exists({
        _id: order._id,
        user: actor._id,
        orderNumber,
        __v: order.__v,
      });
      if (unchanged) return customerOrderDetail(order, shipment);
    }

    throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
      message:
        "The order changed while it was being loaded. Refresh and try again.",
    });
  },

  async quote(actor, input) {
    const cart = await Cart.findOne({ user: actor._id }).select("lines").lean();
    const snapshot = capturedLines(cart);
    if (snapshot.length === 0) throw new AppError(ErrorCode.CART_EMPTY);
    const commerceState = await CustomerCommerceState.findOne({
      user: actor._id,
    })
      .select("orderSequence")
      .lean();
    const composition = await composeAuthoritativeCheckout({
      userId: actor._id,
      cartLines: snapshot,
      shippingAddress: input.shippingAddress,
      couponCode: input.couponCode,
      orderSequence: (commerceState?.orderSequence ?? 0) + 1,
    });
    const capabilities = getPaymentCapabilities();
    const methods = [OrderPaymentMethod.COD, OrderPaymentMethod.PREPAID];
    const paymentOptions = methods.map((paymentMethod) => {
      const policyEnabled =
        paymentMethod === OrderPaymentMethod.COD
          ? composition.settings.cod.enabled
          : composition.settings.prepaid.enabled;
      const enabled =
        policyEnabled &&
        (paymentMethod !== OrderPaymentMethod.PREPAID ||
          capabilities.prepaidReady);
      return {
        paymentMethod,
        enabled,
        ...(enabled
          ? { pricing: pricingForPaymentMethod(composition, paymentMethod) }
          : {}),
      };
    });
    return orderQuote({ ...composition, paymentOptions });
  },

  async place(actor, input, rawIdempotencyKey, req) {
    const userId = actor._id;
    const keyHash = sha256(rawIdempotencyKey);
    const fingerprint = sha256(canonicalJson(input));
    const existing = await Order.findOne({
      user: userId,
      idempotencyKeyHash: keyHash,
    }).lean();
    if (existing) return replayResult(existing, fingerprint);
    if (
      input.paymentMethod === OrderPaymentMethod.PREPAID &&
      !getPaymentCapabilities().prepaidReady
    )
      throw new AppError(ErrorCode.PAYMENT_METHOD_UNAVAILABLE);
    if (!(await supportsTransactions())) throw settingsUnavailable();

    const cart = await Cart.findOne({ user: userId })
      .select("lines activityRevision updatedAt")
      .lean();
    const snapshot = capturedLines(cart);
    const snapshotRevision = cart?.activityRevision ?? 0;
    if (snapshot.length === 0) throw new AppError(ErrorCode.CART_EMPTY);
    const orderId = new mongoose.Types.ObjectId();
    const orderNumber = `ORD_${crypto.randomBytes(16).toString("base64url")}`;

    let committed;
    try {
      committed = await runTransaction(async (session) => {
        if (
          input.paymentMethod === OrderPaymentMethod.PREPAID &&
          !getPaymentCapabilities().prepaidReady
        )
          throw new AppError(ErrorCode.PAYMENT_METHOD_UNAVAILABLE);
        const composition = await composeAuthoritativeCheckout({
          userId,
          cartLines: snapshot,
          shippingAddress: input.shippingAddress,
          couponCode: input.couponCode,
          resolveOrderSequence: () => allocateSequence(userId, session),
          session,
        });
        const {
          settings,
          shippingAddress,
          cartPricing,
          coupon,
          couponSnapshot,
          orderSequence: sequence,
        } = composition;
        const pricing = pricingForPaymentMethod(
          composition,
          input.paymentMethod,
        );
        const entitlementSnapshots = await exchangeEntitlements(
          cartPricing.lines,
          session,
        );

        await deductStockAndLedger(cartPricing.lines, orderId, session);
        if (coupon) await consumeCoupon({ coupon, userId, orderId, session });
        const clear = await Cart.updateOne(
          {
            _id: cart._id,
            user: userId,
            lines: snapshot,
            ...(snapshotRevision === 0
              ? {
                  $or: [
                    { activityRevision: 0 },
                    { activityRevision: { $exists: false } },
                  ],
                }
              : { activityRevision: snapshotRevision }),
          },
          {
            $set: { lines: [] },
            $inc: { activityRevision: 1 },
          },
          { session },
        );
        const cartCleared = clear.modifiedCount === 1;
        const now = new Date();
        const [order] = await Order.create(
          [
            {
              _id: orderId,
              orderNumber,
              user: userId,
              idempotencyKeyHash: keyHash,
              requestFingerprint: fingerprint,
              customerOrderSequence: sequence,
              settingsVersion: settings.version,
              paymentMethod: input.paymentMethod,
              items: cartPricing.lines.map(
                (
                  {
                    status,
                    product,
                    categoryId,
                    exchangeEligibleAtCheckout,
                    ...line
                  },
                  index,
                ) => ({
                  ...line,
                  ...entitlementSnapshots[index],
                }),
              ),
              shippingAddress,
              pricing,
              coupon: couponSnapshot,
              placementStatus: OrderPlacementStatus.PLACED,
              paymentStatus:
                input.paymentMethod === OrderPaymentMethod.COD
                  ? OrderPaymentStatus.COD_DUE
                  : OrderPaymentStatus.PREPAID_PENDING,
              fulfillmentStatus: OrderFulfillmentStatus.UNFULFILLED,
              statusHistory: [
                {
                  domain: "PLACEMENT",
                  status: OrderPlacementStatus.PLACED,
                  at: now,
                },
                {
                  domain: "PAYMENT",
                  status:
                    input.paymentMethod === OrderPaymentMethod.COD
                      ? OrderPaymentStatus.COD_DUE
                      : OrderPaymentStatus.PREPAID_PENDING,
                  at: now,
                },
                {
                  domain: "FULFILLMENT",
                  status: OrderFulfillmentStatus.UNFULFILLED,
                  at: now,
                },
              ],
              itemCount: cartPricing.itemCount,
              cartCleared,
            },
          ],
          { session },
        );
        await publishOrderPlacedNotifications(order, now, session);
        return order;
      });
    } catch (error) {
      const replay = await Order.findOne({
        user: userId,
        idempotencyKeyHash: keyHash,
      }).lean();
      if (replay) return replayResult(replay, fingerprint);
      throw error;
    }

    if (committed.cartCleared && snapshotRevision > 0) {
      const placedAt =
        committed.statusHistory.find(
          (entry) =>
            entry.domain === "PLACEMENT" &&
            entry.status === OrderPlacementStatus.PLACED,
        )?.at ?? committed.createdAt;
      await abandonedCartEventService.recordConversion({
        ownerId: userId,
        orderId: committed._id,
        cartRevision: snapshotRevision,
        cart: {
          lines: committed.items.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            quantity: line.quantity,
            unitPricePaise: line.unitPricePaise,
          })),
          merchandiseSubtotalPaise: committed.pricing.merchandiseSubtotalPaise,
        },
        activityAt: cart.updatedAt,
        placedAt,
      });
    }
    await auditCreated(committed, actor, req);
    return { replayed: false, receipt: orderReceipt(committed) };
  },

  async releasePlacement(orderId, reason = "Placement released") {
    if (!(await supportsTransactions())) throw settingsUnavailable();
    const normalizedReason =
      String(reason).trim().slice(0, 160) || "Placement released";
    const result = await runTransaction(async (session) => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new AppError(ErrorCode.ORDER_NOT_FOUND);
      if (!assertPlacementReleasable(order))
        return { replayed: true, receipt: orderReceipt(order) };
      const releasedAt = new Date();
      await releaseOrderResources({
        order,
        reason: normalizedReason,
        at: releasedAt,
        session,
      });
      order.placementStatus = OrderPlacementStatus.RELEASED;
      order.paymentStatus = OrderPaymentStatus.CANCELLED;
      order.fulfillmentStatus = OrderFulfillmentStatus.CANCELLED;
      order.releasedAt = releasedAt;
      order.releaseReason = normalizedReason;
      order.statusHistory.push(
        {
          domain: "PLACEMENT",
          status: OrderPlacementStatus.RELEASED,
          reason: normalizedReason,
          at: order.releasedAt,
        },
        {
          domain: "PAYMENT",
          status: OrderPaymentStatus.CANCELLED,
          reason: normalizedReason,
          at: order.releasedAt,
        },
        {
          domain: "FULFILLMENT",
          status: OrderFulfillmentStatus.CANCELLED,
          reason: normalizedReason,
          at: order.releasedAt,
        },
      );
      await order.save({ session });
      return { replayed: false, receipt: orderReceipt(order), order };
    });
    if (!result.replayed)
      await auditService.record({
        action: AuditAction.ORDER_RELEASED,
        targetType: AuditTargetType.ORDER,
        targetId: result.order._id,
        targetLabel: result.order.orderNumber,
        metadata: {
          orderNumber: result.order.orderNumber,
          placementStatus: result.order.placementStatus,
          itemCount: result.order.itemCount,
          totals: orderReceipt(result.order).pricing,
        },
      });
    return { replayed: result.replayed, receipt: result.receipt };
  },
};

export const releasePlacement =
  orderService.releasePlacement.bind(orderService);
