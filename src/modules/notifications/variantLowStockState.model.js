import { createSchema, registerModel, shortText } from "../../utils/schema.js";

const variantLowStockStateSchema = createSchema(
  {
    productId: { type: String, required: true, immutable: true, maxlength: 80 },
    variantId: { type: String, required: true, immutable: true, maxlength: 80 },
    isLow: { type: Boolean, required: true, default: false },
    episode: { type: Number, required: true, default: 0, min: 0 },
    observedStock: { type: Number, required: true, min: 0 },
    observedThreshold: { type: Number, required: true, min: 0 },
    observedAt: { type: Date, required: true },
    sourceType: shortText({ required: true, max: 80 }),
    sourceId: shortText({ required: true, max: 160 }),
  },
  { collection: "variantLowStockStates" },
);

variantLowStockStateSchema.index({ productId: 1, variantId: 1 }, { unique: true });
variantLowStockStateSchema.index({ isLow: 1, observedAt: -1 });

export const VariantLowStockState = registerModel(
  "VariantLowStockState",
  variantLowStockStateSchema,
);
