import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { composeCartDto } from "../cart/cart.service.js";
import { Category, CategoryStatus } from "../categories/category.model.js";
import { Product, ProductStatus } from "../products/product.model.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import { User } from "../users/user.model.js";
import { Coupon, CouponDiscountType, CouponStatus } from "./coupon.model.js";
import { evaluateCoupon } from "./coupon.evaluation.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function adminCoupon(coupon) {
  const value = coupon.toObject ? coupon.toObject() : coupon;
  return {
    id: value._id.toString(),
    code: value.code,
    discountType: value.discountType,
    percentageBasisPoints: value.percentageBasisPoints ?? null,
    flatDiscountPaise: value.flatDiscountPaise ?? null,
    minimumOrderPaise: value.minimumOrderPaise,
    startsAt: value.startsAt ?? null,
    expiresAt: value.expiresAt,
    usageLimit: value.usageLimit ?? null,
    usageCount: value.usageCount,
    perCustomerUsageLimit:
      value.perCustomerUsageLimit === undefined
        ? 1
        : value.perCustomerUsageLimit,
    firstOrderOnly: value.firstOrderOnly,
    eligibleUserIds: (value.eligibleUserIds ?? []).map(String),
    applicableProductIds: (value.applicableProductIds ?? []).map(String),
    applicableCategoryIds: (value.applicableCategoryIds ?? []).map(String),
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function invalidConfiguration(message, details) {
  throw new AppError(ErrorCode.VALIDATION_ERROR, { message, details });
}

async function validateReferences(input) {
  const userIds = input.eligibleUserIds ?? [];
  const productIds = input.applicableProductIds ?? [];
  const categoryIds = input.applicableCategoryIds ?? [];
  const [users, products, categories] = await Promise.all([
    User.countDocuments({ _id: { $in: userIds } }),
    Product.countDocuments({
      _id: { $in: productIds },
      status: { $ne: ProductStatus.ARCHIVED },
    }),
    Category.countDocuments({
      _id: { $in: categoryIds },
      status: { $ne: CategoryStatus.ARCHIVED },
    }),
  ]);
  if (users !== userIds.length) {
    invalidConfiguration("One or more eligible users are unavailable.", {
      eligibleUserIds: "Choose existing users.",
    });
  }
  if (products !== productIds.length) {
    invalidConfiguration("One or more applicable products are unavailable.", {
      applicableProductIds: "Choose products that are not archived.",
    });
  }
  if (categories !== categoryIds.length) {
    invalidConfiguration("One or more applicable categories are unavailable.", {
      applicableCategoryIds: "Choose categories that are not archived.",
    });
  }
}

function validateLifecycle(
  value,
  { creating = false, changedExpiry = false } = {},
) {
  if (value.startsAt && value.expiresAt <= value.startsAt) {
    invalidConfiguration("Coupon expiry must be later than its start date.", {
      expiresAt: "Choose a date later than startsAt.",
    });
  }
  const now = new Date();
  if (
    (creating || changedExpiry || value.status === CouponStatus.ACTIVE) &&
    value.expiresAt <= now
  ) {
    invalidConfiguration("Coupon expiry must be in the future.", {
      expiresAt: "Choose a future date.",
    });
  }
}

function duplicateCodeError(error) {
  if (error?.code !== 11000) return error;
  return new AppError(ErrorCode.VALIDATION_ERROR, {
    status: 409,
    message: "That coupon code is already in use.",
    details: { code: "Choose a unique coupon code." },
  });
}

export const couponService = {
  async validateCart(code, items, user) {
    const cart = await composeCartDto(items);
    const coupon = await Coupon.findOne({ code });
    const { discountPaise } = evaluateCoupon(coupon, cart, {
      userId: user?.id,
    });
    return {
      ...cart,
      coupon: { status: "APPLIED", code: coupon.code, discountPaise },
      merchandiseAfterCouponPaise:
        cart.merchandiseSubtotalPaise - discountPaise,
    };
  },

  async listAdmin({ page = 1, limit = 24, status, q } = {}) {
    const query = {};
    if (status) query.status = status;
    if (q) query.code = { $regex: escapeRegex(q), $options: "i" };
    const [coupons, total] = await Promise.all([
      Coupon.find(query)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Coupon.countDocuments(query),
    ]);
    return { coupons: coupons.map(adminCoupon), total, page, limit };
  },

  async getAdminById(id) {
    const coupon = await Coupon.findById(id).lean();
    if (!coupon) throw AppError.notFound("Coupon");
    return adminCoupon(coupon);
  },

  async create(input, actor, req) {
    await validateReferences(input);
    validateLifecycle(input, { creating: true });
    let coupon;
    try {
      coupon = await Coupon.create(input);
    } catch (error) {
      throw duplicateCodeError(error);
    }
    await auditService.record({
      action: AuditAction.COUPON_CREATED,
      actor,
      targetType: AuditTargetType.COUPON,
      targetId: coupon._id,
      targetLabel: coupon.code,
      req,
    });
    return adminCoupon(coupon);
  },

  async update(id, input, actor, req) {
    const coupon = await Coupon.findById(id);
    if (!coupon) throw AppError.notFound("Coupon");
    if (coupon.status === CouponStatus.ARCHIVED) {
      invalidConfiguration("Archived coupons cannot be changed.");
    }

    const mergedReferences = {
      eligibleUserIds:
        input.eligibleUserIds ?? coupon.eligibleUserIds.map(String),
      applicableProductIds:
        input.applicableProductIds ?? coupon.applicableProductIds.map(String),
      applicableCategoryIds:
        input.applicableCategoryIds ?? coupon.applicableCategoryIds.map(String),
    };
    await validateReferences(mergedReferences);

    for (const [field, value] of Object.entries(input))
      coupon.set(field, value);
    if (input.discountType === CouponDiscountType.PERCENTAGE) {
      coupon.set("flatDiscountPaise", undefined);
    }
    if (input.discountType === CouponDiscountType.FLAT) {
      coupon.set("percentageBasisPoints", undefined);
    }
    validateLifecycle(coupon, {
      changedExpiry: Object.hasOwn(input, "expiresAt"),
    });

    try {
      await coupon.save();
    } catch (error) {
      throw duplicateCodeError(error);
    }
    await auditService.record({
      action: AuditAction.COUPON_UPDATED,
      actor,
      targetType: AuditTargetType.COUPON,
      targetId: coupon._id,
      targetLabel: coupon.code,
      metadata: { changedFields: Object.keys(input) },
      req,
    });
    return adminCoupon(coupon);
  },
};
