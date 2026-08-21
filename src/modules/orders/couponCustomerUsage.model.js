import { createSchema, ref, registerModel } from "../../utils/schema.js";

const schema = createSchema({
  coupon: { ...ref("Coupon", { required: true }), immutable: true },
  user: { ...ref("User", { required: true }), immutable: true },
  usageCount: { type: Number, required: true, min: 0, default: 0, validate: { validator: Number.isInteger, message: "Usage count must be a whole number." } },
}, { collection: "couponCustomerUsages" });

schema.index({ coupon: 1, user: 1 }, { unique: true });
export const CouponCustomerUsage = registerModel("CouponCustomerUsage", schema);
