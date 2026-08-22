import mongoose from "mongoose";
import { createSchema, ref, registerModel, shortText } from "../../utils/schema.js";
import { MeasurementUnit } from "./customizationConfig.js";

const measurementSchema = new mongoose.Schema(
  {
    key: shortText({ required: true, max: 40, immutable: true }),
    label: shortText({ required: true, max: 80, immutable: true }),
    value: { type: Number, required: true, min: 0, max: 1000 },
    unit: { type: String, required: true, enum: Object.values(MeasurementUnit) },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const schema = createSchema(
  {
    owner: { ...ref("User", { required: true }), immutable: true },
    name: shortText({ required: true, max: 80 }),
    ageGroup: shortText({ max: 80 }),
    size: shortText({ max: 80 }),
    measurements: {
      type: [measurementSchema],
      default: [],
      validate: {
        validator(values) {
          const keys = values.map((value) => value.key);
          return values.length <= 30 && keys.length === new Set(keys).size;
        },
        message: "Measurement keys must be unique and bounded.",
      },
    },
  },
  { collection: "measurementProfiles" },
);

schema.index({ owner: 1, name: 1 }, { unique: true });
schema.index({ owner: 1, updatedAt: -1, _id: -1 });
export const MeasurementProfile = registerModel("MeasurementProfile", schema);
