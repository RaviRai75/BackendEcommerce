import mongoose from "mongoose";
import { z } from "zod";
import { strictObject } from "../../validators/common.js";

export const CustomizationMode = Object.freeze({
  INHERIT: "INHERIT",
  DISABLED: "DISABLED",
  OVERRIDE: "OVERRIDE",
});

export const MeasurementUnit = Object.freeze({ CM: "CM", IN: "IN" });
const KEY_PATTERN = /^[a-z][a-z0-9_-]{1,39}$/;

const choiceSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, maxlength: 40, match: KEY_PATTERN },
    label: { type: String, required: true, trim: true, maxlength: 80 },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const optionGroupSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, maxlength: 40, match: KEY_PATTERN },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    choices: {
      type: [choiceSchema],
      required: true,
      validate: {
        validator: (values) => values.length > 0 && values.length <= 30,
        message: "Each option group needs 1 to 30 choices.",
      },
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const measurementFieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, maxlength: 40, match: KEY_PATTERN },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    unit: {
      type: String,
      required: true,
      enum: Object.values(MeasurementUnit),
    },
    min: { type: Number, required: true, min: 0, max: 1000 },
    max: { type: Number, required: true, min: 0, max: 1000 },
    required: { type: Boolean, required: true, default: false },
  },
  { strict: "throw", _id: false, versionKey: false },
);
measurementFieldSchema.path("max").validate(function maxExceedsMin(value) {
  return Number.isFinite(value) && value > this.min;
}, "Measurement maximum must exceed its minimum.");

function uniqueKeys(values = []) {
  const keys = values.map((value) => value.key);
  return keys.length === new Set(keys).size;
}

export const customizationDefinitionSchema = new mongoose.Schema(
  {
    existingProductEnabled: { type: Boolean, required: true, default: false },
    ownDesignEnabled: { type: Boolean, required: true, default: false },
    optionGroups: {
      type: [optionGroupSchema],
      default: [],
      validate: [
        {
          validator: (values) => values.length <= 30,
          message: "Keep at most 30 option groups.",
        },
        { validator: uniqueKeys, message: "Option group keys must be unique." },
        {
          validator: (values) =>
            values.every((group) => uniqueKeys(group.choices)),
          message: "Choice keys must be unique within an option group.",
        },
      ],
    },
    ageGroups: {
      type: [choiceSchema],
      default: [],
      validate: [
        {
          validator: (values) => values.length <= 30,
          message: "Keep at most 30 age groups.",
        },
        { validator: uniqueKeys, message: "Age-group keys must be unique." },
      ],
    },
    sizes: {
      type: [choiceSchema],
      default: [],
      validate: [
        {
          validator: (values) => values.length <= 60,
          message: "Keep at most 60 sizes.",
        },
        { validator: uniqueKeys, message: "Size keys must be unique." },
      ],
    },
    measurementFields: {
      type: [measurementFieldSchema],
      default: [],
      validate: [
        {
          validator: (values) => values.length <= 30,
          message: "Keep at most 30 measurement fields.",
        },
        { validator: uniqueKeys, message: "Measurement keys must be unique." },
      ],
    },
    referenceImageLimit: {
      type: Number,
      required: true,
      min: 0,
      max: 10,
      default: 0,
      validate: Number.isInteger,
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

const key = z.string().trim().toLowerCase().regex(KEY_PATTERN);
const label = z.string().trim().min(1).max(80);
const choiceValidator = strictObject({ key, label });
const uniqueByKey = (values) =>
  values.length === new Set(values.map((value) => value.key)).size;
const choices = (max, min = 0) =>
  z
    .array(choiceValidator)
    .min(min)
    .max(max)
    .refine(uniqueByKey, "Keys must be unique.");

export const customizationDefinitionValidator = strictObject({
  existingProductEnabled: z.boolean().default(false),
  ownDesignEnabled: z.boolean().default(false),
  optionGroups: z
    .array(strictObject({ key, label, choices: choices(30, 1) }))
    .max(30)
    .refine(uniqueByKey, "Option-group keys must be unique.")
    .default([]),
  ageGroups: choices(30).default([]),
  sizes: choices(60).default([]),
  measurementFields: z
    .array(
      strictObject({
        key,
        label,
        unit: z.enum(Object.values(MeasurementUnit)),
        min: z.coerce.number().nonnegative().max(1000),
        max: z.coerce.number().positive().max(1000),
        required: z.boolean().default(false),
      }).refine((field) => field.max > field.min, {
        path: ["max"],
        message: "Maximum must exceed minimum.",
      }),
    )
    .max(30)
    .refine(uniqueByKey, "Measurement keys must be unique.")
    .default([]),
  referenceImageLimit: z.coerce.number().int().min(0).max(10).default(0),
});

export const DISABLED_CUSTOMIZATION = Object.freeze({
  existingProductEnabled: false,
  ownDesignEnabled: false,
  optionGroups: Object.freeze([]),
  ageGroups: Object.freeze([]),
  sizes: Object.freeze([]),
  measurementFields: Object.freeze([]),
  referenceImageLimit: 0,
});

export function plainCustomization(value) {
  if (!value) return { ...DISABLED_CUSTOMIZATION };
  const source =
    typeof value.toObject === "function" ? value.toObject() : value;
  const parsed = customizationDefinitionValidator.safeParse(source);
  return parsed.success ? parsed.data : { ...DISABLED_CUSTOMIZATION };
}

export function resolveEffectiveCustomization(product, category) {
  const rawMode = product?.customizationMode;
  const mode =
    rawMode === undefined || Object.values(CustomizationMode).includes(rawMode)
      ? (rawMode ?? CustomizationMode.INHERIT)
      : CustomizationMode.DISABLED;
  let definition;
  if (mode === CustomizationMode.DISABLED) definition = DISABLED_CUSTOMIZATION;
  else if (mode === CustomizationMode.OVERRIDE)
    definition = plainCustomization(product?.customizationOverride);
  else definition = plainCustomization(category?.customization);
  return {
    mode,
    enabled:
      definition.existingProductEnabled === true ||
      definition.ownDesignEnabled === true,
    definition: structuredClone(definition),
  };
}

export function safeCustomizationDto(resolved) {
  return {
    mode: resolved.mode,
    enabled: resolved.enabled,
    definition: structuredClone(resolved.definition),
  };
}
