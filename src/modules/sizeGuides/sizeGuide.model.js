import mongoose from "mongoose";
import {
  createSchema,
  registerModel,
  shortText,
  slug,
} from "../../utils/schema.js";
import { isStructuredPlainText } from "../content/contentText.js";

export const SizeGuideMode = Object.freeze({
  INHERIT: "INHERIT",
  DISABLED: "DISABLED",
  OVERRIDE: "OVERRIDE",
});

export const SIZE_GUIDE_LIMITS = Object.freeze({
  title: 160,
  summary: 500,
  notes: 2_000,
  columns: 12,
  rows: 50,
  key: 40,
  label: 100,
  cell: 120,
  totalCharacters: 20_000,
});

function plainTextPath(max, { required = false } = {}) {
  return shortText({
    required,
    max,
    validate: {
      validator: isStructuredPlainText,
      message: "Use plain text without markup or control characters.",
    },
  });
}

const stableKeyPath = {
  type: String,
  required: true,
  trim: true,
  lowercase: true,
  maxlength: SIZE_GUIDE_LIMITS.key,
  match: [
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Keys may contain lowercase letters, numbers, and single hyphens only.",
  ],
};

const columnSchema = new mongoose.Schema(
  {
    key: stableKeyPath,
    label: plainTextPath(SIZE_GUIDE_LIMITS.label, { required: true }),
  },
  { strict: "throw", _id: false, versionKey: false },
);

const cellPath = {
  type: String,
  trim: true,
  maxlength: SIZE_GUIDE_LIMITS.cell,
  validate: {
    validator: isStructuredPlainText,
    message: "Use plain text without markup or control characters.",
  },
};

const rowSchema = new mongoose.Schema(
  {
    sizeKey: stableKeyPath,
    label: plainTextPath(SIZE_GUIDE_LIMITS.label, { required: true }),
    cells: {
      type: [cellPath],
      required: true,
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

export const sizeGuideSnapshotSchema = new mongoose.Schema(
  {
    title: plainTextPath(SIZE_GUIDE_LIMITS.title, { required: true }),
    summary: plainTextPath(SIZE_GUIDE_LIMITS.summary),
    notes: plainTextPath(SIZE_GUIDE_LIMITS.notes),
    showOnStandalone: { type: Boolean, required: true, default: false },
    columns: {
      type: [columnSchema],
      required: true,
      validate: {
        validator: (columns) =>
          columns.length > 0 && columns.length <= SIZE_GUIDE_LIMITS.columns,
        message: `Use between 1 and ${SIZE_GUIDE_LIMITS.columns} columns.`,
      },
    },
    rows: {
      type: [rowSchema],
      required: true,
      validate: {
        validator: (rows) =>
          rows.length > 0 && rows.length <= SIZE_GUIDE_LIMITS.rows,
        message: `Use between 1 and ${SIZE_GUIDE_LIMITS.rows} rows.`,
      },
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

sizeGuideSnapshotSchema.pre("validate", function validateChart() {
  const columnKeys = this.columns.map((column) => column.key);
  if (columnKeys.length !== new Set(columnKeys).size) {
    this.invalidate("columns", "Column keys must be unique.");
  }

  const rowKeys = this.rows.map((row) => row.sizeKey);
  if (rowKeys.length !== new Set(rowKeys).size) {
    this.invalidate("rows", "Row size keys must be unique.");
  }

  if (this.rows.some((row) => row.cells.length !== this.columns.length)) {
    this.invalidate("rows", "Every row must contain one cell per column.");
  }

  const characterCount = [
    this.title,
    this.summary,
    this.notes,
    ...this.columns.flatMap((column) => [column.key, column.label]),
    ...this.rows.flatMap((row) => [row.sizeKey, row.label, ...row.cells]),
  ].reduce(
    (total, value) => total + (typeof value === "string" ? value.length : 0),
    0,
  );
  if (characterCount > SIZE_GUIDE_LIMITS.totalCharacters) {
    this.invalidate(
      "rows",
      `A size guide must be ${SIZE_GUIDE_LIMITS.totalCharacters} characters or fewer.`,
    );
  }
});

const sizeGuideSchema = createSchema(
  {
    slug: { ...slug(), immutable: true, unique: true },
    draft: { type: sizeGuideSnapshotSchema, default: null },
    published: { type: sizeGuideSnapshotSchema, default: null },
    draftRevision: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
      validate: Number.isInteger,
    },
    publishedRevision: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
      validate: Number.isInteger,
    },
    draftUpdatedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
  },
  { collection: "sizeGuides" },
);

sizeGuideSchema.index({
  "published.showOnStandalone": 1,
  publishedAt: -1,
  _id: -1,
});
sizeGuideSchema.index({ updatedAt: -1, _id: -1 });

export const SizeGuide = registerModel("SizeGuide", sizeGuideSchema);
