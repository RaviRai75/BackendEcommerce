import { supportsTransactions } from "../../config/database.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { composeCartDto } from "../cart/cart.service.js";
import { inSession, withCatalogueWrite } from "../catalogue/catalogueWrite.js";
import { Category, CategoryStatus } from "../categories/category.model.js";
import { Product, ProductStatus } from "../products/product.model.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import { User, UserRole } from "../users/user.model.js";
import { Coupon, CouponDiscountType, CouponStatus } from "./coupon.model.js";
import { evaluateCoupon } from "./coupon.evaluation.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CONFIGURATION_FIELDS = [
  "code",
  "discountType",
  "percentageBasisPoints",
  "flatDiscountPaise",
  "minimumOrderPaise",
  "startsAt",
  "expiresAt",
  "usageLimit",
  "perCustomerUsageLimit",
  "firstOrderOnly",
  "eligibleUserIds",
  "applicableProductIds",
  "applicableCategoryIds",
  "status",
];

const idOf = (value) => value?._id ?? value;
const isPopulated = (value) =>
  Boolean(value && typeof value === "object" && value._id);

function populatedOptions(values, map) {
  return (values ?? []).filter(isPopulated).map(map);
}

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
    eligibleUserIds: (value.eligibleUserIds ?? []).map((entry) =>
      String(idOf(entry)),
    ),
    applicableProductIds: (value.applicableProductIds ?? []).map((entry) =>
      String(idOf(entry)),
    ),
    applicableCategoryIds: (value.applicableCategoryIds ?? []).map((entry) =>
      String(idOf(entry)),
    ),
    referenceOptions: {
      users: populatedOptions(value.eligibleUserIds, (user) => ({
        id: String(user._id),
        name: user.name,
        email: user.email,
      })),
      products: populatedOptions(value.applicableProductIds, (product) => ({
        id: String(product._id),
        name: product.name,
        status: product.status,
      })),
      categories: populatedOptions(value.applicableCategoryIds, (category) => ({
        id: String(category._id),
        name: category.name,
        status: category.status,
      })),
    },
    status: value.status,
    revision: value.__v ?? 0,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function invalidConfiguration(message, details) {
  throw new AppError(ErrorCode.VALIDATION_ERROR, { message, details });
}

function couponChanged() {
  return new AppError(ErrorCode.COUPON_CHANGED, {
    message:
      "This coupon changed after you loaded it. Reload and review the latest values.",
  });
}

async function requiredCouponWrite(work) {
  if (!(await supportsTransactions())) {
    throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
      message:
        "Coupon administration requires a transaction-capable database deployment.",
    });
  }
  return withCatalogueWrite(work, { transactional: true });
}

async function validateReferences(input, session) {
  const userIds = input.eligibleUserIds ?? [];
  const productIds = input.applicableProductIds ?? [];
  const categoryIds = input.applicableCategoryIds ?? [];

  const users = await inSession(
    User.countDocuments({
      _id: { $in: userIds },
      role: UserRole.USER,
    }),
    session,
  );
  const products = await inSession(
    Product.countDocuments({
      _id: { $in: productIds },
      status: { $ne: ProductStatus.ARCHIVED },
    }),
    session,
  );
  const categories = await inSession(
    Category.countDocuments({
      _id: { $in: categoryIds },
      status: { $ne: CategoryStatus.ARCHIVED },
    }),
    session,
  );

  if (users !== userIds.length) {
    invalidConfiguration("One or more eligible users are unavailable.", {
      eligibleUserIds: "Choose existing customer accounts.",
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

function configurationInput(input) {
  return Object.fromEntries(
    CONFIGURATION_FIELDS.filter((field) => Object.hasOwn(input, field)).map(
      (field) => [field, input[field]],
    ),
  );
}

function comparable(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => String(idOf(entry)));
  if (value && typeof value === "object" && value._bsontype) {
    return String(value);
  }
  return value ?? null;
}

function configurationSnapshot(coupon) {
  return Object.fromEntries(
    CONFIGURATION_FIELDS.map((field) => [field, comparable(coupon[field])]),
  );
}

function changedConfigurationFields(before, coupon) {
  const after = configurationSnapshot(coupon);
  return CONFIGURATION_FIELDS.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}

function updateOperators(coupon, changedFields) {
  const $set = {};
  const $unset = {};
  for (const field of changedFields) {
    const value = coupon[field];
    if (value === undefined) $unset[field] = 1;
    else $set[field] = value;
  }
  const update = { $inc: { __v: 1 } };
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  return update;
}

function mergedReferences(input, coupon) {
  return {
    eligibleUserIds:
      input.eligibleUserIds ?? coupon.eligibleUserIds.map(String),
    applicableProductIds:
      input.applicableProductIds ?? coupon.applicableProductIds.map(String),
    applicableCategoryIds:
      input.applicableCategoryIds ?? coupon.applicableCategoryIds.map(String),
  };
}

async function populatedAdminCoupon(id) {
  const coupon = await Coupon.findById(id)
    .populate({ path: "eligibleUserIds", select: "name email" })
    .populate({ path: "applicableProductIds", select: "name status" })
    .populate({ path: "applicableCategoryIds", select: "name status" });
  if (!coupon) throw AppError.notFound("Coupon");
  return adminCoupon(coupon);
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
    return populatedAdminCoupon(id);
  },

  async searchCustomerOptions({ q, ids, limit }) {
    const query = { role: UserRole.USER };
    if (ids?.length) query._id = { $in: ids };
    else {
      const pattern = new RegExp(escapeRegex(q), "i");
      query.$or = [{ name: pattern }, { email: pattern }];
    }
    const customers = await User.find(query)
      .select("name email")
      .sort({ createdAt: -1, _id: -1 })
      .limit(ids?.length ?? limit)
      .lean();
    return customers.map((customer) => ({
      id: String(customer._id),
      name: customer.name,
      email: customer.email,
    }));
  },

  async create(input, actor, req) {
    let id;
    try {
      id = await requiredCouponWrite(async (session) => {
        const fields = configurationInput(input);
        await validateReferences(fields, session);
        validateLifecycle(fields, { creating: true });
        const [coupon] = await Coupon.create([{ ...fields, usageCount: 0 }], {
          session,
        });
        await auditService.recordStrict(
          {
            action: AuditAction.COUPON_CREATED,
            actor,
            targetType: AuditTargetType.COUPON,
            targetId: coupon._id,
            targetLabel: coupon.code,
            metadata: { revision: coupon.__v ?? 0 },
            req,
          },
          session,
        );
        return coupon._id;
      });
    } catch (error) {
      throw duplicateCodeError(error);
    }
    return populatedAdminCoupon(id);
  },

  async update(id, input, actor, req) {
    try {
      await requiredCouponWrite(async (session) => {
        const coupon = await inSession(Coupon.findById(id), session);
        if (!coupon) throw AppError.notFound("Coupon");
        if (coupon.__v !== input.expectedRevision) throw couponChanged();
        if (coupon.status === CouponStatus.ARCHIVED) {
          invalidConfiguration("Archived coupons cannot be changed.");
        }

        const before = configurationSnapshot(coupon);
        const fields = configurationInput(input);
        for (const [field, value] of Object.entries(fields)) {
          coupon.set(field, value);
        }
        if (input.discountType === CouponDiscountType.PERCENTAGE) {
          coupon.set("flatDiscountPaise", undefined);
        }
        if (input.discountType === CouponDiscountType.FLAT) {
          coupon.set("percentageBasisPoints", undefined);
        }

        await validateReferences(mergedReferences(input, coupon), session);
        validateLifecycle(coupon, {
          changedExpiry: Object.hasOwn(input, "expiresAt"),
        });
        await coupon.validate();

        const changedFields = changedConfigurationFields(before, coupon);
        if (!changedFields.length) return;

        const updated = await Coupon.findOneAndUpdate(
          {
            _id: id,
            __v: input.expectedRevision,
            status: { $ne: CouponStatus.ARCHIVED },
          },
          updateOperators(coupon, changedFields),
          { new: true, runValidators: true, session },
        );
        if (!updated) throw couponChanged();

        await auditService.recordStrict(
          {
            action: AuditAction.COUPON_UPDATED,
            actor,
            targetType: AuditTargetType.COUPON,
            targetId: updated._id,
            targetLabel: updated.code,
            metadata: {
              changedFields,
              fromRevision: input.expectedRevision,
              toRevision: updated.__v,
            },
            req,
          },
          session,
        );
      });
    } catch (error) {
      throw duplicateCodeError(error);
    }
    return populatedAdminCoupon(id);
  },
};
