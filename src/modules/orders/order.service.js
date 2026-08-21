import crypto from "node:crypto";
import mongoose from "mongoose";
import { supportsTransactions } from "../../config/database.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { Cart } from "../cart/cart.model.js";
import { Coupon } from "../coupons/coupon.model.js";
import { Product, ProductStatus } from "../products/product.model.js";
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
import {
  EXCHANGE_POLICY_KEY,
  ExchangePolicy,
  ExchangeReason,
} from "../exchanges/exchangePolicy.model.js";

const MAX_TRANSACTION_ATTEMPTS = 5;
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
    const result = await Product.updateOne(
      {
        _id: line.productId,
        status: ProductStatus.PUBLISHED,
        variants: {
          $elemMatch: { _id: line.variantId, stock: { $gte: line.quantity } },
        },
      },
      { $inc: { "variants.$[selected].stock": -line.quantity } },
      {
        session,
        arrayFilters: [
          {
            "selected._id": line.variantId,
            "selected.stock": { $gte: line.quantity },
          },
        ],
      },
    );
    if (result.modifiedCount !== 1) throw new AppError(ErrorCode.STOCK_CHANGED);
    await InventoryTransaction.create(
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
  }
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
    const order = await Order.findOne({
      user: actor._id,
      orderNumber,
    })
      .select(CUSTOMER_ORDER_DETAIL_FIELDS)
      .lean();
    if (!order) throw new AppError(ErrorCode.ORDER_NOT_FOUND);
    return customerOrderDetail(order);
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

    const cart = await Cart.findOne({ user: userId }).select("lines").lean();
    const snapshot = capturedLines(cart);
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
          { _id: cart._id, user: userId, lines: snapshot },
          { $set: { lines: [] } },
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
      for (const line of order.items) {
        const restored = await Product.updateOne(
          { _id: line.productId, "variants._id": line.variantId },
          { $inc: { "variants.$[selected].stock": line.quantity } },
          { session, arrayFilters: [{ "selected._id": line.variantId }] },
        );
        if (restored.modifiedCount !== 1) throw settingsUnavailable();
        await InventoryTransaction.create(
          [
            {
              order: order._id,
              product: line.productId,
              variant: line.variantId,
              reason: InventoryReason.ORDER_RELEASED,
              quantityDelta: line.quantity,
              note: normalizedReason,
            },
          ],
          { session },
        );
      }
      const redemption = await CouponRedemption.findOne({
        order: order._id,
        status: CouponRedemptionStatus.CONSUMED,
      }).session(session);
      if (redemption) {
        const global = await Coupon.updateOne(
          { _id: redemption.coupon, usageCount: { $gt: 0 } },
          { $inc: { usageCount: -1 } },
          { session },
        );
        if (global.modifiedCount !== 1) throw settingsUnavailable();
        if (redemption.countedPerCustomer) {
          const customer = await CouponCustomerUsage.updateOne(
            {
              coupon: redemption.coupon,
              user: redemption.user,
              usageCount: { $gt: 0 },
            },
            { $inc: { usageCount: -1 } },
            { session },
          );
          if (customer.modifiedCount !== 1) throw settingsUnavailable();
        }
        redemption.status = CouponRedemptionStatus.RELEASED;
        redemption.releasedAt = new Date();
        redemption.releaseReason = normalizedReason;
        redemption.history.push({
          status: CouponRedemptionStatus.RELEASED,
          at: redemption.releasedAt,
          reason: normalizedReason,
        });
        await redemption.save({ session });
      }
      order.placementStatus = OrderPlacementStatus.RELEASED;
      order.paymentStatus = OrderPaymentStatus.CANCELLED;
      order.fulfillmentStatus = OrderFulfillmentStatus.CANCELLED;
      order.releasedAt = new Date();
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
