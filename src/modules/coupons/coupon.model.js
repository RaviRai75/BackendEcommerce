import mongoose from "mongoose";
import {
  createSchema,
  paise,
  registerModel,
  shortText,
} from "../../utils/schema.js";

export const CouponDiscountType = {
  PERCENTAGE: "PERCENTAGE",
  FLAT: "FLAT",
};

export const CouponStatus = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  ARCHIVED: "ARCHIVED",
};

export const COUPON_MAX_REFERENCES = 500;

const percentageBasisPoints = {
  type: Number,
  min: 1,
  max: 10_000,
  validate: {
    validator: Number.isInteger,
    message: "Percentage basis points must be a whole number.",
  },
};

const positivePaise = {
  ...paise(),
  min: [1, "Discount must be greater than zero."],
};

function uniqueObjectIdArray(modelName) {
  return {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: modelName }],
    default: [],
    set(values = []) {
      const seen = new Set();
      return values.filter((value) => {
        const key = value.toString();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
    validate: {
      validator(values) {
        return values.length <= COUPON_MAX_REFERENCES;
      },
      message: `Keep at most ${COUPON_MAX_REFERENCES} references.`,
    },
  };
}

const couponSchema = createSchema(
  {
    code: shortText({
      required: true,
      max: 32,
      uppercase: true,
      match: [/^[A-Z0-9_-]{3,32}$/, "Coupon code is not valid."],
    }),
    discountType: {
      type: String,
      required: true,
      enum: Object.values(CouponDiscountType),
    },
    percentageBasisPoints,
    flatDiscountPaise: positivePaise,
    minimumOrderPaise: paise({ required: true, default: 0 }),
    startsAt: Date,
    expiresAt: { type: Date, required: true },
    usageLimit: {
      type: Number,
      min: 1,
      validate: {
        validator(value) {
          return (
            value === null || value === undefined || Number.isInteger(value)
          );
        },
        message: "Usage limit must be a positive whole number.",
      },
      default: null,
    },
    usageCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: "Usage count must be a whole number.",
      },
    },
    perCustomerUsageLimit: {
      type: Number,
      min: 1,
      default: 1,
      validate: {
        validator(value) {
          return (
            value === null || value === undefined || Number.isInteger(value)
          );
        },
        message:
          "Per-customer usage limit must be a positive whole number or null.",
      },
    },
    firstOrderOnly: { type: Boolean, required: true, default: false },
    eligibleUserIds: uniqueObjectIdArray("User"),
    applicableProductIds: uniqueObjectIdArray("Product"),
    applicableCategoryIds: uniqueObjectIdArray("Category"),
    status: {
      type: String,
      required: true,
      enum: Object.values(CouponStatus),
      default: CouponStatus.DRAFT,
    },
  },
  { collection: "coupons" },
);

couponSchema.pre("validate", function validateCouponConfiguration() {
  const percentage =
    this.percentageBasisPoints !== null &&
    this.percentageBasisPoints !== undefined;
  const flat =
    this.flatDiscountPaise !== null && this.flatDiscountPaise !== undefined;

  if (
    this.discountType === CouponDiscountType.PERCENTAGE &&
    (!percentage || flat)
  ) {
    this.invalidate(
      "discountType",
      "Percentage coupons require percentageBasisPoints and cannot have flatDiscountPaise.",
    );
  }
  if (this.discountType === CouponDiscountType.FLAT && (!flat || percentage)) {
    this.invalidate(
      "discountType",
      "Flat coupons require flatDiscountPaise and cannot have percentageBasisPoints.",
    );
  }
  if (this.startsAt && this.expiresAt && this.expiresAt <= this.startsAt) {
    this.invalidate("expiresAt", "Expiry must be later than the start date.");
  }
  if (this.usageLimit !== null && this.usageCount > this.usageLimit) {
    this.invalidate("usageCount", "Usage count cannot exceed the usage limit.");
  }
});

couponSchema.index({ code: 1 }, { unique: true });
couponSchema.index({ status: 1, expiresAt: 1, updatedAt: -1, _id: -1 });

export const Coupon = registerModel("Coupon", couponSchema);
