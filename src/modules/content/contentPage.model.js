import mongoose from "mongoose";
import { createSchema, registerModel, shortText } from "../../utils/schema.js";
import {
  CONTENT_LIMITS,
  contentCharacterCount,
  isStructuredPlainText,
} from "./contentText.js";

export const ContentPageKey = Object.freeze({
  ABOUT: "ABOUT",
  CONTACT: "CONTACT",
  PRIVACY: "PRIVACY",
  TERMS: "TERMS",
  FAQ: "FAQ",
  HELP_CENTER: "HELP_CENTER",
  CUSTOMIZATION_POLICY: "CUSTOMIZATION_POLICY",
});

export const CONTENT_PAGE_DEFINITIONS = Object.freeze([
  Object.freeze({ key: ContentPageKey.ABOUT, slug: "about" }),
  Object.freeze({ key: ContentPageKey.CONTACT, slug: "contact" }),
  Object.freeze({ key: ContentPageKey.PRIVACY, slug: "privacy" }),
  Object.freeze({ key: ContentPageKey.TERMS, slug: "terms" }),
  Object.freeze({ key: ContentPageKey.FAQ, slug: "faq" }),
  Object.freeze({ key: ContentPageKey.HELP_CENTER, slug: "help" }),
  Object.freeze({
    key: ContentPageKey.CUSTOMIZATION_POLICY,
    slug: "customization-policy",
  }),
]);

export const CONTENT_PAGE_BY_KEY = new Map(
  CONTENT_PAGE_DEFINITIONS.map((definition) => [definition.key, definition]),
);
export const CONTENT_PAGE_BY_SLUG = new Map(
  CONTENT_PAGE_DEFINITIONS.map((definition) => [definition.slug, definition]),
);

function plainTextPath(max, { required = false } = {}) {
  return shortText({
    required,
    max,
    validate: {
      validator: isStructuredPlainText,
      message:
        "Use structured plain text without markup or control characters.",
    },
  });
}

function boundedPlainTextArray(maxItems, maxLength) {
  return {
    type: [String],
    default: [],
    validate: [
      {
        validator: (values) => values.length <= maxItems,
        message: `Keep at most ${maxItems} items.`,
      },
      {
        validator: (values) =>
          values.every(
            (value) =>
              typeof value === "string" &&
              value.trim().length > 0 &&
              value.length <= maxLength &&
              isStructuredPlainText(value),
          ),
        message: "Use bounded structured plain text without markup.",
      },
    ],
  };
}

const sectionSchema = new mongoose.Schema(
  {
    heading: plainTextPath(CONTENT_LIMITS.heading),
    paragraphs: boundedPlainTextArray(
      CONTENT_LIMITS.paragraphsPerSection,
      CONTENT_LIMITS.paragraph,
    ),
    bullets: boundedPlainTextArray(
      CONTENT_LIMITS.bulletsPerSection,
      CONTENT_LIMITS.bullet,
    ),
  },
  { strict: "throw", _id: false, versionKey: false },
);

sectionSchema.pre("validate", function validateUsefulSection() {
  if (this.paragraphs.length === 0 && this.bullets.length === 0) {
    this.invalidate(
      "paragraphs",
      "Each section needs at least one paragraph or bullet.",
    );
  }
});

export const editorialSnapshotSchema = new mongoose.Schema(
  {
    title: plainTextPath(CONTENT_LIMITS.title, { required: true }),
    summary: plainTextPath(CONTENT_LIMITS.summary),
    sections: {
      type: [sectionSchema],
      required: true,
      validate: [
        {
          validator: (sections) => sections.length > 0,
          message: "Add at least one useful section.",
        },
        {
          validator: (sections) => sections.length <= CONTENT_LIMITS.sections,
          message: `Keep at most ${CONTENT_LIMITS.sections} sections.`,
        },
      ],
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

editorialSnapshotSchema.pre("validate", function validateSnapshotSize() {
  if (contentCharacterCount(this) > CONTENT_LIMITS.totalCharacters) {
    this.invalidate(
      "sections",
      `Content must be ${CONTENT_LIMITS.totalCharacters} characters or fewer.`,
    );
  }
});

const contentPageSchema = createSchema(
  {
    key: {
      type: String,
      required: true,
      enum: Object.values(ContentPageKey),
      immutable: true,
      unique: true,
    },
    slug: {
      type: String,
      required: true,
      enum: CONTENT_PAGE_DEFINITIONS.map(({ slug }) => slug),
      immutable: true,
      unique: true,
    },
    draft: { type: editorialSnapshotSchema, default: null },
    published: { type: editorialSnapshotSchema, default: null },
    draftRevision: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: Number.isInteger,
    },
    publishedRevision: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: Number.isInteger,
    },
    draftUpdatedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
  },
  { collection: "contentPages" },
);

export const ContentPage = registerModel("ContentPage", contentPageSchema);
