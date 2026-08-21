import { createSchema, ref, registerModel, shortText } from "../../utils/schema.js";

export const CouponRedemptionStatus = Object.freeze({ CONSUMED: "CONSUMED", RELEASED: "RELEASED" });
const schema = createSchema({
  order: { ...ref("Order", { required: true }), immutable: true },
  coupon: { ...ref("Coupon", { required: true }), immutable: true },
  user: { ...ref("User", { required: true }), immutable: true },
  status: { type: String, required: true, enum: Object.values(CouponRedemptionStatus), default: CouponRedemptionStatus.CONSUMED },
  countedPerCustomer: { type: Boolean, required: true, immutable: true },
  perCustomerUsageLimitSnapshot: { type: Number, min: 1, immutable: true },
  releasedAt: Date,
  releaseReason: shortText({ max: 160 }),
  history: { type: [{ status: { type: String, required: true, enum: Object.values(CouponRedemptionStatus) }, at: { type: Date, required: true, default: Date.now }, reason: shortText({ max: 160 }) }], default: [] },
}, { collection: "couponRedemptions" });

schema.index({ order: 1, coupon: 1 }, { unique: true });
schema.index({ coupon: 1, user: 1, status: 1, createdAt: -1 });
export const CouponRedemption = registerModel("CouponRedemption", schema);
