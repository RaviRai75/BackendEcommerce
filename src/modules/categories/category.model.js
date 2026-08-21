import {
  createSchema,
  demoFlag,
  longText,
  registerModel,
  shortText,
  slug,
} from "../../utils/schema.js";

export const CategoryStatus = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  ARCHIVED: "ARCHIVED",
};

const categorySchema = createSchema(
  {
    name: shortText({ required: true, max: 100 }),
    slug: { ...slug(), unique: true },
    description: longText({ max: 2000 }),
    seo: {
      title: shortText({ max: 70 }),
      description: shortText({ max: 180 }),
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(CategoryStatus),
      default: CategoryStatus.DRAFT,
    },
    sortOrder: {
      type: Number,
      required: true,
      min: 0,
      max: 100_000,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: "Sort order must be a whole number.",
      },
    },
    publishedAt: Date,
    archivedAt: Date,
    isDemoData: demoFlag(),
  },
  { collection: "categories" },
);

categorySchema.index({ status: 1, sortOrder: 1, name: 1 });

export const Category = registerModel("Category", categorySchema);
