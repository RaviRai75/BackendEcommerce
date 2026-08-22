import mongoose from "mongoose";
import {
  createSchema,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";

export const ShipmentDirection = Object.freeze({ FORWARD: "FORWARD" });
export const ShipmentTargetType = Object.freeze({
  ORDER: "ORDER",
  CUSTOM_ORDER: "CUSTOM_ORDER",
});
export const ShipmentAdapter = Object.freeze({ MANUAL: "MANUAL" });
export const ShipmentStatus = Object.freeze({
  SHIPPED: "SHIPPED",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
});

export function normalizeCourierKey(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-IN");
}

const milestoneSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
      enum: Object.values(ShipmentStatus),
    },
    at: { type: Date, required: true },
    actor: { ...ref("User", { required: true }), immutable: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const shipmentSchema = createSchema(
  {
    targetType: {
      type: String,
      enum: Object.values(ShipmentTargetType),
      immutable: true,
    },
    order: { ...ref("Order"), immutable: true },
    orderNumber: shortText({ max: 48, immutable: true }),
    customOrder: { ...ref("CustomOrder"), immutable: true },
    customOrderNumber: shortText({ max: 48, immutable: true }),
    direction: {
      type: String,
      required: true,
      enum: Object.values(ShipmentDirection),
      immutable: true,
    },
    adapter: {
      type: String,
      required: true,
      enum: Object.values(ShipmentAdapter),
      immutable: true,
    },
    courier: shortText({ required: true, max: 100, immutable: true }),
    courierKey: shortText({ required: true, max: 200, immutable: true }),
    awb: shortText({ required: true, max: 200, immutable: true }),
    trackingId: shortText({ required: true, max: 200, immutable: true }),
    shipmentId: shortText({ required: true, max: 200, immutable: true }),
    status: {
      type: String,
      required: true,
      enum: Object.values(ShipmentStatus),
    },
    recordedAt: { type: Date, required: true, immutable: true },
    recordedBy: { ...ref("User", { required: true }), immutable: true },
    shippedAt: { type: Date, required: true, immutable: true },
    outForDeliveryAt: Date,
    deliveredAt: Date,
    milestones: { type: [milestoneSchema], required: true },
  },
  {
    collection: "shipments",
    privateFields: ["shipmentId", "courierKey"],
  },
);

shipmentSchema.pre("validate", function validateTargetReference(next) {
  const custom = this.targetType === ShipmentTargetType.CUSTOM_ORDER;
  if (custom) {
    if (!this.customOrder)
      this.invalidate(
        "customOrder",
        "CUSTOM_ORDER shipments require a custom order.",
      );
    if (this.order)
      this.invalidate(
        "order",
        "CUSTOM_ORDER shipments cannot reference an order.",
      );
  } else {
    if (!this.order)
      this.invalidate("order", "ORDER shipments require an order.");
    if (this.customOrder)
      this.invalidate(
        "customOrder",
        "ORDER shipments cannot reference a custom order.",
      );
  }
  next();
});

shipmentSchema.index(
  { order: 1, direction: 1 },
  {
    unique: true,
    partialFilterExpression: { order: { $type: "objectId" } },
  },
);
shipmentSchema.index(
  { customOrder: 1, direction: 1 },
  {
    unique: true,
    partialFilterExpression: { customOrder: { $type: "objectId" } },
  },
);
shipmentSchema.index({ courierKey: 1, awb: 1 }, { unique: true });
shipmentSchema.index({ courierKey: 1, trackingId: 1 }, { unique: true });
shipmentSchema.index({ courierKey: 1, shipmentId: 1 }, { unique: true });
shipmentSchema.index({ status: 1, updatedAt: -1, _id: -1 });

export const Shipment = registerModel("Shipment", shipmentSchema);
