import mongoose from "mongoose";
import { createSchema, registerModel, shortText } from "../../utils/schema.js";
import { isStructuredPlainText } from "./contentText.js";

export const BUSINESS_PROFILE_KEY = "BUSINESS_PROFILE";

function safeText(max, { required = false } = {}) {
  return shortText({
    required,
    max,
    validate: {
      validator: isStructuredPlainText,
      message: "Use plain text without markup or control characters.",
    },
  });
}

const postalAddressSchema = new mongoose.Schema(
  {
    addressLine1: safeText(160, { required: true }),
    addressLine2: safeText(160),
    city: safeText(80, { required: true }),
    district: safeText(80, { required: true }),
    state: safeText(80, { required: true }),
    pincode: {
      type: String,
      required: true,
      match: /^[1-9]\d{5}$/,
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

export const businessProfileSnapshotSchema = new mongoose.Schema(
  {
    displayName: safeText(160),
    legalName: safeText(200),
    supportEmail: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    supportPhone: { type: String, match: /^[6-9]\d{9}$/ },
    whatsappNumber: { type: String, match: /^\+[1-9]\d{7,14}$/ },
    instagramUrl: {
      type: String,
      maxlength: 500,
      validate: {
        validator(value) {
          if (value === undefined) return true;
          try {
            const url = new URL(value);
            return (
              url.protocol === "https:" &&
              url.hostname === "www.instagram.com" &&
              !url.username &&
              !url.password &&
              !url.search &&
              !url.hash
            );
          } catch {
            return false;
          }
        },
        message: "Use a secure Instagram URL.",
      },
    },
    postalAddress: { type: postalAddressSchema, default: undefined },
    supportHours: safeText(500),
  },
  { strict: "throw", _id: false, versionKey: false },
);

function hasProfileFact(profile) {
  if (!profile) return false;
  return [
    "displayName",
    "legalName",
    "supportEmail",
    "supportPhone",
    "whatsappNumber",
    "instagramUrl",
    "postalAddress",
    "supportHours",
  ].some((field) => profile[field] !== undefined && profile[field] !== null);
}

const businessProfileSchema = createSchema(
  {
    key: {
      type: String,
      required: true,
      enum: [BUSINESS_PROFILE_KEY],
      default: BUSINESS_PROFILE_KEY,
      immutable: true,
      unique: true,
    },
    draft: {
      type: businessProfileSnapshotSchema,
      default: null,
      validate: {
        validator: (profile) => profile === null || hasProfileFact(profile),
        message: "Add at least one business profile fact.",
      },
    },
    published: {
      type: businessProfileSnapshotSchema,
      default: null,
      validate: {
        validator: (profile) => profile === null || hasProfileFact(profile),
        message: "Published business profiles need at least one fact.",
      },
    },
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
  { collection: "businessProfiles" },
);

export const BusinessProfile = registerModel(
  "BusinessProfile",
  businessProfileSchema,
);
