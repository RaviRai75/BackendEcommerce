import { createSchema, ref, registerModel, shortText } from "../../utils/schema.js";

export const ADDRESS_LIMIT = 10;

const schema = createSchema(
  {
    user: { ...ref("User", { required: true }), immutable: true },
    slot: {
      type: Number,
      required: true,
      min: 1,
      max: ADDRESS_LIMIT,
      immutable: true,
      validate: {
        validator: Number.isInteger,
        message: "Address slot must be a whole number.",
      },
    },
    recipientName: shortText({ required: true, max: 80 }),
    phone: {
      ...shortText({ required: true, max: 10 }),
      match: [/^[6-9]\d{9}$/, "Not a valid Indian mobile number."],
    },
    email: {
      ...shortText({ required: true, max: 254, lowercase: true }),
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Not a valid email address."],
    },
    addressLine1: shortText({ required: true, max: 180 }),
    addressLine2: shortText({ max: 180 }),
    landmark: shortText({ max: 120 }),
    city: shortText({ required: true, max: 80 }),
    district: shortText({ required: true, max: 80 }),
    state: shortText({ required: true, max: 80 }),
    pincode: {
      ...shortText({ required: true, max: 6 }),
      match: [/^[1-9]\d{5}$/, "Not a valid 6-digit pincode."],
    },
    isDefault: { type: Boolean, required: true, default: false },
  },
  { collection: "addresses" },
);

schema.index({ user: 1, slot: 1 }, { unique: true });
schema.index(
  { user: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } },
);
schema.index({ user: 1, updatedAt: -1, _id: -1 });

export const Address = registerModel("Address", schema);
