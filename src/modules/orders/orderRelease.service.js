import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { Coupon } from "../coupons/coupon.model.js";
import { notificationService } from "../notifications/notification.service.js";
import { Product } from "../products/product.model.js";
import { CouponCustomerUsage } from "./couponCustomerUsage.model.js";
import {
  CouponRedemption,
  CouponRedemptionStatus,
} from "./couponRedemption.model.js";
import {
  InventoryReason,
  InventoryTransaction,
} from "./inventoryTransaction.model.js";

function releaseUnavailable(cause) {
  return new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
    message: "Order release is temporarily unavailable. Please try again.",
    cause,
  });
}

function invalidTransition(cause) {
  return new AppError(ErrorCode.INVALID_STATUS_TRANSITION, { cause });
}

/**
 * Restores inventory and coupon usage for a caller-owned Order transaction.
 * The caller remains responsible for atomically changing Order state/history.
 */
export async function releaseOrderResources({ order, reason, at, session }) {
  if (!session) throw releaseUnavailable();

  for (const line of order.items) {
    const product = await Product.findOneAndUpdate(
      { _id: line.productId, "variants._id": line.variantId },
      {
        $inc: {
          "variants.$[selected].stock": line.quantity,
          __v: 1,
        },
      },
      {
        new: false,
        session,
        arrayFilters: [{ "selected._id": line.variantId }],
      },
    ).select("name status variants");
    if (!product) throw releaseUnavailable();
    const variant = product.variants.id(line.variantId);
    if (!variant) throw releaseUnavailable();

    let transaction;
    try {
      [transaction] = await InventoryTransaction.create(
        [
          {
            order: order._id,
            product: line.productId,
            variant: line.variantId,
            reason: InventoryReason.ORDER_RELEASED,
            quantityDelta: line.quantity,
            note: reason,
          },
        ],
        { session },
      );
    } catch (error) {
      if (error?.code === 11000) throw invalidTransition(error);
      throw error;
    }
    await notificationService.observeLowStockTransition(
      {
        productId: product._id,
        variantId: variant._id,
        productName: product.name,
        sku: variant.sku,
        beforeStock: variant.stock,
        afterStock: variant.stock + line.quantity,
        threshold: variant.lowStockThreshold,
        productStatus: product.status,
        variantStatus: variant.status,
        sourceType: InventoryReason.ORDER_RELEASED,
        sourceId: transaction._id,
        occurredAt: transaction.createdAt,
      },
      { session },
    );
  }

  const redemption = await CouponRedemption.findOne({
    order: order._id,
    status: CouponRedemptionStatus.CONSUMED,
  }).session(session);
  if (!redemption) return;

  const global = await Coupon.updateOne(
    { _id: redemption.coupon, usageCount: { $gt: 0 } },
    { $inc: { usageCount: -1 } },
    { session },
  );
  if (global.modifiedCount !== 1) throw releaseUnavailable();

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
    if (customer.modifiedCount !== 1) throw releaseUnavailable();
  }

  redemption.status = CouponRedemptionStatus.RELEASED;
  redemption.releasedAt = at;
  redemption.releaseReason = reason;
  redemption.history.push({
    status: CouponRedemptionStatus.RELEASED,
    at,
    reason,
  });
  await redemption.save({ session });
}
