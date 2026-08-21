/**
 * Shared Mongoose conventions.
 *
 * Every model is built with `createSchema` so the whole database behaves
 * consistently:
 *
 *   - `createdAt` / `updatedAt` on everything, for auditability and analytics.
 *   - `toJSON` exposes `id` and removes `_id`, `__v` and anything the schema
 *     declares private, so an internal field cannot leak through a controller
 *     that returns a document directly (security §27).
 *   - Money is stored as an integer number of paise, never a float.
 */
import mongoose from "mongoose";

/**
 * Money decision (documented in docs/DECISIONS.md).
 *
 * All monetary values are stored as an integer count of paise — ₹1,499.00 is
 * 149900. Floating point cannot represent decimal currency exactly, and an
 * e-commerce ledger that is off by a paisa is a real problem when it reaches an
 * invoice. Fields using this convention carry a `Paise` suffix so no call site
 * can mistake the unit. Conversion to and from rupees happens only at the API
 * boundary and in the UI.
 */
export const PAISE_PER_RUPEE = 100;

/** ₹ 1,00,00,000 — an upper bound that catches a misplaced decimal point. */
const MAX_PAISE = 1_000_000_000;

/**
 * A monetary field.
 *
 * @param {object} [options]
 * @param {boolean} [options.required=false]
 * @param {number} [options.default]
 * @returns {object} Mongoose path definition
 */
export function paise({ required = false, default: defaultValue } = {}) {
  return {
    type: Number,
    required,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    min: [0, "Amount cannot be negative."],
    max: [MAX_PAISE, "Amount is implausibly large."],
    validate: {
      validator: Number.isInteger,
      message: "Amount must be a whole number of paise.",
    },
  };
}

/** Rupees -> paise. Rounds, because the input may be a float from a form or CSV. */
export function rupeesToPaise(rupees) {
  return Math.round(Number(rupees) * PAISE_PER_RUPEE);
}

/** Paise -> rupees as a number, for display and export only. */
export function paiseToRupees(value) {
  return Number(value) / PAISE_PER_RUPEE;
}

/**
 * Formats paise as Indian currency, e.g. 149900 -> "₹1,499".
 * Whole rupees are shown without decimals, which is how Indian retail prices
 * are normally written.
 *
 * @param {number} value paise
 * @returns {string}
 */
export function formatPaise(value) {
  const rupees = paiseToRupees(value);
  return rupees.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** A trimmed string path with a length cap, so a hostile payload cannot bloat a document. */
export function shortText({ required = false, max = 200, ...rest } = {}) {
  return {
    type: String,
    required,
    trim: true,
    maxlength: [max, `Must be ${max} characters or fewer.`],
    ...rest,
  };
}

/** A longer free-text path (descriptions, comments). */
export function longText({ required = false, max = 5000, ...rest } = {}) {
  return {
    type: String,
    required,
    trim: true,
    maxlength: [max, `Must be ${max} characters or fewer.`],
    ...rest,
  };
}

/** A URL-safe slug. Uniqueness and indexing are declared by the owning model. */
export function slug({ required = true } = {}) {
  return {
    type: String,
    required,
    trim: true,
    lowercase: true,
    maxlength: [140, "Slug must be 140 characters or fewer."],
    match: [
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug may contain lowercase letters, numbers and single hyphens only.",
    ],
  };
}

/** A reference to another collection. */
export function ref(modelName, { required = false, index = false } = {}) {
  return {
    type: mongoose.Schema.Types.ObjectId,
    ref: modelName,
    required,
    index,
  };
}

/**
 * Marks a document as development demo data.
 *
 * structure.md §69 forbids inventing business data and requires that any
 * placeholder used during development is clearly marked. Every collection that
 * a seeder can populate carries this flag, which also lets `npm run seed --fresh`
 * remove demo records without touching anything real.
 */
export function demoFlag() {
  return { type: Boolean, default: false };
}

/**
 * Creates a schema with the project's conventions applied.
 *
 * @param {Record<string, unknown>} definition
 * @param {object} [options]
 * @param {string[]} [options.privateFields] paths removed from `toJSON` output
 * @param {string} [options.collection] explicit collection name
 * @param {boolean} [options.timestamps=true]
 * @param {Record<string, Function>} [options.methods]
 * @param {Record<string, Function>} [options.statics]
 * @param {Record<string, unknown>} [options.schemaOptions] passed through to Mongoose
 * @returns {import('mongoose').Schema}
 */
export function createSchema(
  definition,
  {
    privateFields = [],
    collection,
    timestamps = true,
    methods = {},
    statics = {},
    schemaOptions = {},
  } = {},
) {
  const schema = new mongoose.Schema(definition, {
    timestamps,
    collection,
    // Keep `__v`: it enables optimistic concurrency where we need it. It is
    // removed from API output by the transform below.
    versionKey: "__v",
    // Reject documents containing paths the schema does not declare, rather than
    // silently dropping them — an explicit failure is easier to debug and blocks
    // mass assignment at the persistence layer too (security §5).
    strict: "throw",
    minimize: false,
    ...schemaOptions,
    toJSON: {
      virtuals: true,
      transform(_doc, plain) {
        plain.id = plain._id?.toString?.() ?? plain._id;
        delete plain._id;
        delete plain.__v;
        for (const field of privateFields) delete plain[field];
        return plain;
      },
    },
    toObject: { virtuals: true },
  });

  for (const [name, fn] of Object.entries(methods)) schema.methods[name] = fn;
  for (const [name, fn] of Object.entries(statics)) schema.statics[name] = fn;

  return schema;
}

/**
 * Registers a model idempotently.
 *
 * Vitest re-imports modules between test files in the same worker; calling
 * `mongoose.model()` twice with the same name throws `OverwriteModelError`, which
 * would turn a harmless re-import into a failing suite.
 *
 * @param {string} name
 * @param {import('mongoose').Schema} schema
 * @returns {import('mongoose').Model}
 */
export function registerModel(name, schema) {
  return mongoose.models[name] ?? mongoose.model(name, schema);
}
