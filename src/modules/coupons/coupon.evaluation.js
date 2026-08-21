import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { CartLineStatus } from "../cart/cart.service.js";
import { CouponDiscountType, CouponStatus } from "./coupon.model.js";

export function assertCartAvailable(cart) {
  if (cart.lines.length === 0) throw new AppError(ErrorCode.CART_EMPTY);
  const blocked = cart.lines.find(
    (line) => line.status !== CartLineStatus.AVAILABLE,
  );
  if (!blocked) return;
  if (blocked.status === CartLineStatus.PRODUCT_UNAVAILABLE)
    throw new AppError(ErrorCode.PRODUCT_UNAVAILABLE);
  if (blocked.status === CartLineStatus.VARIANT_UNAVAILABLE)
    throw new AppError(ErrorCode.SIZE_UNAVAILABLE);
  throw new AppError(ErrorCode.INSUFFICIENT_STOCK);
}

export function calculateCouponDiscount(coupon, basePaise) {
  if (coupon.discountType === CouponDiscountType.PERCENTAGE) {
    return Number(
      (BigInt(basePaise) * BigInt(coupon.percentageBasisPoints)) / 10_000n,
    );
  }
  return Math.min(coupon.flatDiscountPaise, basePaise);
}

export function evaluateCoupon(
  coupon,
  cart,
  {
    userId,
    now = new Date(),
    orderSequence = null,
    priorUsageCount = 0,
    enforceOrderRules = false,
  } = {},
) {
  assertCartAvailable(cart);
  if (
    !coupon ||
    coupon.status !== CouponStatus.ACTIVE ||
    (coupon.startsAt && coupon.startsAt > now)
  )
    throw new AppError(ErrorCode.COUPON_INVALID);
  if (coupon.expiresAt <= now) throw new AppError(ErrorCode.COUPON_EXPIRED);
  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit)
    throw new AppError(ErrorCode.COUPON_LIMIT_REACHED);
  const normalizedUserId = userId ? String(userId) : null;
  const eligibleUsers = new Set((coupon.eligibleUserIds ?? []).map(String));
  if (
    (coupon.firstOrderOnly && !normalizedUserId) ||
    (eligibleUsers.size > 0 &&
      (!normalizedUserId || !eligibleUsers.has(normalizedUserId)))
  )
    throw new AppError(ErrorCode.COUPON_NOT_ELIGIBLE);
  if (enforceOrderRules && coupon.firstOrderOnly && orderSequence !== 1)
    throw new AppError(ErrorCode.COUPON_NOT_ELIGIBLE);
  const perCustomerUsageLimit =
    coupon.perCustomerUsageLimit === undefined
      ? 1
      : coupon.perCustomerUsageLimit;
  if (
    enforceOrderRules &&
    perCustomerUsageLimit !== null &&
    priorUsageCount >= perCustomerUsageLimit
  )
    throw new AppError(ErrorCode.COUPON_NOT_ELIGIBLE);
  if (cart.merchandiseSubtotalPaise < coupon.minimumOrderPaise)
    throw new AppError(ErrorCode.COUPON_NOT_ELIGIBLE);
  const products = new Set((coupon.applicableProductIds ?? []).map(String));
  const categories = new Set((coupon.applicableCategoryIds ?? []).map(String));
  const catalogueWide = products.size === 0 && categories.size === 0;
  const qualifyingBasePaise = cart.lines.reduce(
    (total, line) =>
      total +
      (catalogueWide ||
      products.has(String(line.productId)) ||
      categories.has(String(line.categoryId ?? line.product?.category?.id))
        ? line.lineMerchandiseSubtotalPaise
        : 0),
    0,
  );
  if (qualifyingBasePaise === 0)
    throw new AppError(ErrorCode.COUPON_NOT_ELIGIBLE);
  return {
    discountPaise: calculateCouponDiscount(coupon, qualifyingBasePaise),
    qualifyingBasePaise,
  };
}
