import { createSchema, ref, registerModel } from "../../utils/schema.js";

const schema = createSchema({
  user: { ...ref("User", { required: true }), immutable: true },
  orderSequence: { type: Number, required: true, min: 0, default: 0, validate: { validator: Number.isInteger, message: "Order sequence must be a whole number." } },
}, { collection: "customerCommerceStates" });

schema.index({ user: 1 }, { unique: true });
export const CustomerCommerceState = registerModel("CustomerCommerceState", schema);
